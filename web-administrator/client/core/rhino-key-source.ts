/* Source rendering for the expression inside a Rhino XmlElemRef. Unlike the
 * outer member-chain visitor, Rhino prints this expression as a whole: an
 * index in fields[0] is part of the key, not a repetition to remove.
 * This reader never evaluates expressions or resolves user identifiers.
 */

type Token = { value: string; end: number; literal?: boolean; lineBreakBefore?: boolean };
type LiteralSource = (literal: string) => string | null;
const name = /^[\p{L}\p{Nl}\p{Sc}\p{Pc}][\p{L}\p{Nl}\p{Sc}\p{Pc}\p{Mn}\p{Mc}\p{Nd}\p{Cf}]*/u;
const encodedName = /^(?:[\p{L}\p{Nl}\p{Sc}\p{Pc}]|\\u[\da-fA-F]{4})(?:[\p{L}\p{Nl}\p{Sc}\p{Pc}\p{Mn}\p{Mc}\p{Nd}\p{Cf}]|\\u[\da-fA-F]{4})*/u;
const number = /^(?:0[xX][\da-fA-F]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/;
const precedence: Record<string, number> = {
    ',': 1, '=': 2, '+=': 2, '-=': 2, '*=': 2, '/=': 2, '%=': 2,
    '|=': 2, '^=': 2, '&=': 2, '<<=': 2, '>>=': 2, '>>>=': 2,
    '||': 4, '&&': 5, '|': 6, '^': 7, '&': 8,
    '==': 9, '!=': 9, '===': 9, '!==': 9,
    '<': 10, '>': 10, '<=': 10, '>=': 10, in: 10, instanceof: 10,
    '<<': 11, '>>': 11, '>>>': 11, '+': 12, '-': 12, '*': 13, '/': 13, '%': 13
};

class KeySourceReader {
    private position = 0;
    token: Token = { value: '', end: 0 };

    constructor(private text: string, private literalSource: LiteralSource) { this.next(); }

    next(): void {
        const text = this.text;
        const triviaStart = this.position;
        for (;;) {
            while (/\s/.test(text[this.position] || '') && this.position < text.length) this.position++;
            if (text.startsWith('/*', this.position)) {
                const end = text.indexOf('*/', this.position + 2);
                if (end < 0) throw new Error('Unterminated comment');
                this.position = end + 2;
            } else if (text.startsWith('//', this.position)) {
                while (this.position < text.length && !/[\n\r\u2028\u2029]/.test(text[this.position])) this.position++;
            } else break;
        }
        const start = this.position;
        const lineBreakBefore = /[\n\r\u2028\u2029]/.test(text.slice(triviaStart, start));
        const ch = text[start];
        if (!ch) { this.token = { value: '', end: start, lineBreakBefore }; return; }
        if (ch === '"' || ch === "'") {
            this.position++;
            while (this.position < text.length) {
                if (text[this.position] === '\\') this.position += 2;
                else if (text[this.position++] === ch) break;
            }
            const raw = text.slice(start, this.position);
            if (raw.length < 2 || raw.at(-1) !== ch) throw new Error('Unterminated string');
            const value = this.literalSource(raw);
            if (value == null) throw new Error('Invalid string');
            this.token = { value, end: this.position, literal: true, lineBreakBefore }; return;
        }
        const word = encodedName.exec(text.slice(start));
        const numeric = number.exec(text.slice(start));
        if (word || numeric) {
            // Default Rhino Parser rejects ES6 binary/octal numeric literals.
            if (/^0[bBoO]/.test(text.slice(start))) throw new Error('Unsupported numeric literal');
            const raw = (word || numeric)![0];
            const value = word ? raw.replace(/\\u([\da-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))) : raw;
            if (word && name.exec(value)?.[0] !== value) throw new Error('Invalid identifier');
            this.position += raw.length;
            this.token = { value, end: this.position, literal: !!numeric, lineBreakBefore }; return;
        }
        const operator = /^(?:>>>=|===|!==|>>>|<<=|>>=|\+\+|--|&&|\|\||==|!=|<=|>=|<<|>>|[+*/%&|^-]=|::|\.\.)/.exec(text.slice(start));
        const value = operator?.[0] || ch;
        this.position += value.length;
        this.token = { value, end: this.position, lineBreakBefore };
    }

    take(value: string): void {
        if (this.token.value !== value) throw new Error(`Expected ${value}`);
        this.next();
    }

    expression(min = 1): string {
        let source = this.unary();
        for (;;) {
            const op = this.token.value;
            if (op === '?' && min <= 3) {
                this.next();
                const yes = this.expression(2);
                this.take(':');
                source += ` ? ${yes} : ${this.expression(2)}`;
            } else {
                const priority = precedence[op];
                if (priority == null || priority < min) break;
                this.next();
                source += ` ${op} ${this.expression(priority === 2 ? priority : priority + 1)}`;
            }
        }
        return source;
    }

    private unary(): string {
        const op = this.token.value;
        if (['+', '-', '!', '~', '++', '--', 'typeof', 'void', 'delete'].includes(op)) {
            this.next();
            return op + (/^[a-z]/.test(op) ? ' ' : '') + this.unary();
        }
        if (op === 'new') {
            this.next();
            const target = this.member(this.primary(), false);
            const args = this.token.value === '(' ? this.arguments() : '()';
            return this.member(`new ${target}${args}`, true);
        }
        let source = this.member(this.primary(), true);
        if (!this.token.lineBreakBefore && ['++', '--'].includes(this.token.value)) { source += this.token.value; this.next(); }
        return source;
    }

    private arguments(): string {
        this.take('(');
        const args: string[] = [];
        while (this.token.value !== ')') {
            args.push(this.expression(2));
            if (this.token.value !== ',') break;
            this.next();
        }
        this.take(')');
        return `(${args.join(', ')})`;
    }

    private member(source: string, calls: boolean): string {
        for (;;) {
            if (this.token.value === '(' && calls) source += this.arguments();
            else if (this.token.value === '[') {
                this.next(); source += `[${this.expression()}]`; this.take(']');
            } else if (['.', '..', '::'].includes(this.token.value)) {
                const separator = this.token.value; this.next(); source += separator;
                if (this.token.value === '(') {
                    this.next(); source += `(${this.expression()})`; this.take(')');
                } else {
                    let computed = separator === '::';
                    if (this.token.value === '@') { source += '@'; this.next(); computed = true; }
                    if (this.token.value === '[' && !computed) throw new Error('Invalid member');
                    if (this.token.value !== '[') {
                        if (!name.test(this.token.value) && this.token.value !== '*') throw new Error('Invalid member');
                        source += this.token.value; this.next();
                    }
                }
            } else break;
        }
        return source;
    }

    private primary(): string {
        const token = this.token;
        if (token.value === '(') {
            this.next(); const source = `(${this.expression()})`; this.take(')'); return source;
        }
        if (token.value === '[') {
            this.next(); const values: string[] = [];
            let trailingHole = false;
            while (this.token.value !== ']') {
                trailingHole = this.token.value === ',';
                values.push(trailingHole ? '' : this.expression(2));
                if (this.token.value !== ',') break;
                this.next();
            }
            this.take(']'); return `[${values.join(', ')}${trailingHole ? ',' : ''}]`;
        }
        if (token.value === '{') {
            this.next(); const properties: string[] = [];
            while (this.token.value !== '}') {
                const key = this.token;
                if (!key.literal && !name.test(key.value)) throw new Error('Invalid object key');
                this.next(); this.take(':');
                properties.push(`${key.value}: ${this.expression(2)}`);
                if (this.token.value !== ',') break;
                this.next();
            }
            this.take('}');
            return properties.length ? `{\n  ${properties.join(', \n  ')}}` : '{}';
        }
        if (token.value === '/' || token.value === '/=') {
            // A slash in operand position starts a RegExpLiteral. Brackets and
            // escaped slashes inside it must not close the enclosing E4X key.
            const begin = token.end - token.value.length;
            let index = begin + 1, inClass = false;
            for (; index < this.text.length; index++) {
                const ch = this.text[index];
                if (ch === '\\') index++;
                else if (ch === '[') inClass = true;
                else if (ch === ']') inClass = false;
                else if (ch === '/' && !inClass) break;
                else if (/[\n\r]/.test(ch)) throw new Error('Invalid regexp');
            }
            if (index >= this.text.length) throw new Error('Unterminated regexp');
            while (/[a-z]/i.test(this.text[index + 1] || '')) index++;
            const source = this.text.slice(begin, index + 1);
            this.position = index + 1; this.next(); return source;
        }
        if (token.value === 'function') {
            this.next(); let functionName = '';
            if (this.token.value !== '(') { functionName = ` ${this.token.value}`; this.next(); }
            const parameters = this.arguments();
            return `function${functionName}${parameters} ${this.block()}`;
        }
        if (token.value === '@') {
            this.next();
            if (this.token.value === '[') {
                this.next(); const source = `@[${this.expression()}]`; this.take(']'); return source;
            }
            const source = '@' + this.token.value; this.next(); return source;
        }
        if (!token.literal && (!name.test(token.value) || ['return', 'throw', 'var', 'if', 'else'].includes(token.value))) throw new Error('Expected expression');
        this.next(); return token.value;
    }

    private block(): string {
        this.take('{'); const statements: string[] = [];
        while (this.token.value !== '}') statements.push(this.statement());
        this.take('}');
        return statements.length
            ? `{\n${statements.map(statement => statement.split('\n').map(line => `  ${line}`).join('\n')).join('\n')}\n}`
            : '{\n}';
    }

    private statement(): string {
        const start = this.token.value;
        if (start === '{') return this.block();
        if (start === 'return' || start === 'throw' || start === 'var' || start === 'let' || start === 'const') {
            this.next();
            if (start === 'throw' && this.token.lineBreakBefore) throw new Error('Line break after throw');
            // Rhino applies automatic semicolon insertion after a return's
            // line break. Joining it to the next expression changes its value.
            const value = [';', '}'].includes(this.token.value) || (start === 'return' && this.token.lineBreakBefore)
                ? '' : ' ' + this.expression();
            if (this.token.value === ';') this.next();
            return start + value + ';';
        }
        if (start === ';') { this.next(); return ';'; }
        const expression = this.expression();
        if (this.token.value === ';') this.next();
        return expression + ';';
    }
}

/** Read one bracketed XmlElemRef key, preserving all nested member indices. */
export function readComputedKey(text: string, literalSource: LiteralSource): { source: string; end: number } | null {
    try {
        const reader = new KeySourceReader(text, literalSource);
        reader.take('[');
        const source = reader.expression();
        if (reader.token.value !== ']') return null;
        return { source, end: reader.token.end };
    } catch { return null; }
}
