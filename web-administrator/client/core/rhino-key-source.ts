/* Source rendering for the expression inside a Rhino XmlElemRef. Unlike the
 * outer member-chain visitor, Rhino prints this expression as a whole: an
 * index in fields[0] is part of the key, not a repetition to remove.
 * Comments are tokens: statement nodes retain standalone/inline comments,
 * while expression productions skip them just as Rhino's recording parser
 * does. Source line positions control attachment and automatic semicolons.
 * This reader never evaluates expressions or resolves user identifiers.
 */

type SourceComment = { source: string; style: 'block' | 'line' | 'jsdoc' | 'html' };
type Token = {
    value: string; end: number; line: number; literal?: boolean; lineBreakBefore?: boolean;
    comment?: SourceComment;
    skippedComment?: { lineBreakBefore: boolean };
};
type LiteralSource = (literal: string) => string | null;
type Block = { kind: 'block'; body: Statement[] };
type FunctionSource = { kind: 'function'; head: string; body: Block };
type SwitchBranch = { test?: string; body: Statement[]; inlineComment?: SourceComment };
type Statement = (Block | FunctionSource
    | { kind: 'comment'; comment: SourceComment }
    | { kind: 'simple'; source: string; showInlineComment?: boolean }
    | { kind: 'if'; test: string; consequent: Statement; alternate?: Statement; alternateComment?: SourceComment }
    | { kind: 'loop'; head: string; keyword: 'for' | 'while' | 'with'; body: Statement }
    | { kind: 'do'; test: string; body: Statement }
    | { kind: 'label'; label: string; body: Statement }
    | { kind: 'switch'; test: string; cases: SwitchBranch[] }
    | { kind: 'try'; body: Block; catches: { binding: string; body: Block }[]; finalizer?: Block })
    & { inlineComment?: SourceComment };

// A word's lexical spelling does not make it an identifier. In particular,
// statement keywords must never enter the expression-statement fallback.
const keywords = new Set(('break case catch const continue debugger default delete do else finally for function if in instanceof '
    + 'new return switch throw try typeof var void while with let yield class enum export extends import super').split(' '));
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
    private linePosition = 0;
    private line = 1;
    private xmlLiteralDepth = 0;
    token: Token = { value: '', end: 0, line: 1 };

    constructor(private text: string, private literalSource: LiteralSource) { this.next(); }

    next(ignoreComments = true): void {
        this.readToken();
        let skippedComment: Token['skippedComment'];
        while (ignoreComments && this.token.comment) {
            skippedComment ??= { lineBreakBefore: !!this.token.lineBreakBefore };
            this.readToken();
        }
        this.token.skippedComment = skippedComment;
    }

    private readToken(): void {
        const text = this.text;
        const triviaStart = this.position;
        while (/\s/.test(text[this.position] || '') && this.position < text.length) this.position++;
        const start = this.position;
        const lineBreakBefore = /[\n\r\u2028\u2029]/.test(text.slice(triviaStart, start));
        this.line += text.slice(this.linePosition, start).match(/\r\n|[\n\r\u2028\u2029]/g)?.length || 0;
        this.linePosition = start;
        const line = this.line;
        const ch = text[start];
        if (!ch) { this.token = { value: '', end: start, line, lineBreakBefore }; return; }
        if (lineBreakBefore && text.startsWith('-->', start)) {
            while (this.position < text.length && !/[\n\r\u2028\u2029]/.test(text[this.position])) this.position++;
            const source = text.slice(start, this.position);
            this.token = { value: source, end: this.position, line, lineBreakBefore, comment: { source, style: 'html' } };
            return;
        }
        if (text.startsWith('/*', start) || text.startsWith('//', start)) {
            const style = text[start + 1] === '/' ? 'line' : text[start + 2] === '*' ? 'jsdoc' : 'block';
            if (style === 'line') {
                while (this.position < text.length && !/[\n\r\u2028\u2029]/.test(text[this.position])) this.position++;
            } else {
                const end = text.indexOf('*/', start + 2);
                if (end < 0) throw new Error('Unterminated comment');
                this.position = end + 2;
            }
            const source = text.slice(start, this.position);
            this.token = { value: source, end: this.position, line, lineBreakBefore, comment: { source, style } };
            return;
        }
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
            this.token = { value, end: this.position, line, literal: true, lineBreakBefore }; return;
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
            this.token = { value, end: this.position, line, literal: !!numeric, lineBreakBefore }; return;
        }
        const operator = /^(?:>>>=|===|!==|>>>|<<=|>>=|\+\+|--|&&|\|\||==|!=|<=|>=|<<|>>|[+*/%&|^-]=|::|\.\.)/.exec(text.slice(start));
        const value = operator?.[0] || ch;
        this.position += value.length;
        this.token = { value, end: this.position, line, lineBreakBefore };
    }

    private at(value: string): boolean { return this.token.value === value; }

    private skipComments(): void { while (this.token.comment) this.next(false); }

    private comment(): SourceComment {
        const comment = this.token.comment;
        if (!comment) throw new Error('Expected comment');
        this.next(false);
        return comment;
    }

    take(value: string, ignoreComments = true): void {
        this.skipComments();
        if (!this.at(value)) throw new Error(`Expected ${value}`);
        this.next(ignoreComments);
    }

    expression(min = 1, allowIn = true): string {
        this.skipComments();
        let source = this.unary();
        for (;;) {
            const op = this.token.value;
            if (op === '?' && min <= 3) {
                this.next();
                const yes = this.expression(2);
                this.take(':');
                source += ` ? ${yes} : ${this.expression(2, allowIn)}`;
            } else {
                const priority = Object.hasOwn(precedence, op) ? precedence[op] : undefined;
                if (op === 'in' && !allowIn) break;
                if (priority == null || priority < min) break;
                this.next();
                source += ` ${op} ${this.expression(priority === 2 ? priority : priority + 1, allowIn)}`;
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
            let argument = this.expression(2);
            if (this.at('for')) argument = `(${argument}${this.comprehension(false)})`;
            args.push(argument);
            if (this.token.value !== ',') break;
            this.next();
        }
        this.take(')');
        return `(${args.join(', ')})`;
    }

    private member(source: string, calls: boolean): string {
        for (;;) {
            this.skipComments();
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
        if (token.value === '<') return this.xmlLiteral();
        if (token.value === '(') {
            this.next(); let expression = this.expression();
            if (this.at('for')) expression += this.comprehension(false);
            this.take(')'); return `(${expression})`;
        }
        if (token.value === '[') {
            this.next(); const values: string[] = [];
            let trailingHole = false;
            while (this.token.value !== ']') {
                trailingHole = this.token.value === ',';
                values.push(trailingHole ? '' : this.expression(2));
                if (values.length === 1 && !trailingHole && this.at('for')) {
                    const source = `[${values[0]}${this.comprehension(true)}]`;
                    this.take(']'); return source;
                }
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
                this.next();
                if (!key.literal && ['get', 'set'].includes(key.value) && this.token.value !== ':') {
                    const property = this.token;
                    if (!property.literal && !name.test(property.value)) throw new Error('Invalid accessor key');
                    this.next();
                    const parameters = this.parameters();
                    if (parameters.length !== (key.value === 'get' ? 0 : 1)) throw new Error('Invalid accessor parameters');
                    properties.push(`${key.value} ${property.value}(${parameters.join(', ')}) ${statementSource(this.block(), 1).trimStart()}`);
                } else {
                    this.take(':');
                    properties.push(`${key.value}: ${this.expression(2)}`);
                }
                this.skipComments();
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
            const fn = this.functionSource();
            return `${fn.head} ${statementSource(fn.body).trimEnd()}`;
        }
        if (token.value === '@') {
            this.next();
            if (this.token.value === '[') {
                this.next(); const source = `@[${this.expression()}]`; this.take(']'); return source;
            }
            const source = '@' + this.token.value; this.next(); return source;
        }
        if (!token.literal && (!name.test(token.value) || keywords.has(token.value))) throw new Error('Expected expression');
        this.next();
        // Rhino's Name/property reader probes for a namespace separator with
        // comment skipping, before the general member-chain lookahead.
        if (!token.literal && name.test(token.value)) this.token.skippedComment = undefined;
        return token.value;
    }

    private identifier(): string {
        const value = this.token.value;
        if (this.token.literal || name.exec(value)?.[0] !== value || keywords.has(value)) throw new Error('Expected identifier');
        this.next();
        return value;
    }

    // Rhino accepts explicit array/object destructuring in bindings, but its
    // default parser does not accept ES6 shorthand properties or defaults.
    private binding(): string {
        if (this.at('[')) {
            this.next(); const values: string[] = [];
            let trailingHole = false;
            while (!this.at(']')) {
                trailingHole = this.at(',');
                values.push(trailingHole ? '' : this.binding());
                if (!this.at(',')) break;
                this.next();
            }
            this.take(']'); return `[${values.join(', ')}${trailingHole ? ',' : ''}]`;
        }
        if (this.at('{')) {
            this.next(); const properties: string[] = [];
            while (!this.at('}')) {
                const key = this.token;
                if (!key.literal && !name.test(key.value)) throw new Error('Invalid binding key');
                this.next(); this.take(':');
                properties.push(`${key.value}: ${this.binding()}`);
                if (!this.at(',')) break;
                this.next();
            }
            this.take('}'); return properties.length ? `{\n  ${properties.join(', \n  ')}}` : '{}';
        }
        return this.identifier();
    }

    private comprehension(allowEach: boolean): string {
        let source = '';
        while (this.at('for')) {
            this.next(); const each = this.at('each');
            if (each) {
                if (!allowEach) throw new Error('Generator cannot use for each');
                this.next();
            }
            this.take('('); const iterator = this.binding(); this.take('in');
            const iterable = this.expression(); this.take(')');
            source += ` for${each ? ' each' : ''} (${iterator} in ${iterable})`;
        }
        if (this.at('if')) { this.next(); source += ` if (${this.condition()})`; }
        return source;
    }

    group(open: '[' | '('): { source: string; end: number } {
        this.take(open);
        let source = this.expression();
        if (open === '(' && this.at('for')) source += this.comprehension(false);
        if (!this.at(open === '[' ? ']' : ')')) throw new Error('Unterminated expression group');
        return { source, end: this.token.end };
    }

    // XML text is not JavaScript trivia: quotes, brackets, comments and CDATA
    // stay literal. Only {...} substitutions re-enter the expression grammar.
    // Track tag nesting rather than treating '<...>' as an ordinary operator.
    private xmlLiteral(): string {
        // The bundled Rhino token stream cannot nest a second XML scanner
        // inside an XML {...} substitution. Match its parse failure rather
        // than accepting a dialect that Swing would leave untouched.
        if (this.xmlLiteralDepth || this.text.startsWith('<!--', this.token.end - 1)) throw new Error('Unsupported nested XML literal');
        this.xmlLiteralDepth++;
        try { return this.readXmlLiteral(); }
        finally { this.xmlLiteralDepth--; }
    }

    private readXmlLiteral(): string {
        const text = this.text;
        let index = this.token.end - 1, chunk = index, source = '';
        let depth = 0, inTag = false, closing = false, quote = '';
        const finish = () => {
            source += text.slice(chunk, index);
            this.position = index; this.next(); return source;
        };
        while (index < text.length) {
            const ch = text[index];
            if (quote) {
                if (ch === quote) quote = '';
                index++; continue;
            }
            if (inTag && (ch === '"' || ch === "'")) { quote = ch; index++; continue; }
            const terminator = text.startsWith('<!--', index) ? '-->'
                : text.startsWith('<![CDATA[', index) ? ']]>' : text.startsWith('<?', index) ? '?>' : null;
            if (terminator) {
                const end = text.indexOf(terminator, index + (terminator === '-->' ? 4 : terminator === ']]>' ? 9 : 2));
                if (end < 0) throw new Error('Unterminated XML markup');
                index = end + terminator.length;
                if (!depth) return finish();
                continue;
            }
            if (text.startsWith('<!', index)) {
                // Declarations may contain a quoted '>' or an internal subset.
                let subset = 0, declarationQuote = '';
                index += 2;
                for (; index < text.length; index++) {
                    const current = text[index];
                    if (declarationQuote) { if (current === declarationQuote) declarationQuote = ''; }
                    else if (current === '"' || current === "'") declarationQuote = current;
                    else if (current === '[') subset++;
                    else if (current === ']') subset--;
                    else if (current === '>' && !subset) break;
                }
                if (index === text.length) throw new Error('Unterminated XML declaration');
                index++;
                if (!depth) return finish();
                continue;
            }
            if (ch === '{') {
                source += text.slice(chunk, index) + '{';
                this.position = index + 1; this.next();
                if (!this.at('}')) source += this.expression();
                if (!this.at('}')) throw new Error('Unterminated XML substitution');
                source += '}'; index = this.token.end; chunk = index;
                continue;
            }
            if (ch === '<') {
                if (inTag) throw new Error('Invalid XML tag');
                closing = text[index + 1] === '/';
                if (!closing) depth++;
                inTag = true; index += closing ? 2 : 1; continue;
            }
            if (inTag && ch === '>') {
                if (closing || text[index - 1] === '/') depth--;
                inTag = false; index++;
                if (!depth) return finish();
                continue;
            }
            index++;
        }
        throw new Error('Unterminated XML literal');
    }

    private parameters(): string[] {
        this.take('(');
        const parameters: string[] = [];
        if (this.token.value !== ')') {
            do {
                parameters.push(this.binding());
                if (this.token.value !== ',') break;
                this.next();
            } while (true);
        }
        this.take(')');
        return parameters;
    }

    private functionSource(): FunctionSource {
        this.take('function');
        const functionName = this.token.value === '(' ? '' : ` ${this.identifier()}`;
        const parameters = this.parameters();
        return { kind: 'function', head: `function${functionName}(${parameters.join(', ')})`, body: this.block() };
    }

    private block(): Block {
        this.take('{', false); const body: Statement[] = [];
        while (this.token.value !== '}') body.push(this.statement());
        this.take('}', false);
        return { kind: 'block', body };
    }

    private condition(): string {
        this.take('(');
        const test = this.expression();
        this.take(')', false);
        return test;
    }

    private semicolon(): void {
        if (this.token.skippedComment && !this.token.lineBreakBefore) {
            // Rhino retains the comment's flagged-token boundary after member
            // lookahead; automatic semicolon insertion sees that boundary.
            if (!this.token.skippedComment.lineBreakBefore) throw new Error('Expected semicolon');
            return;
        }
        if (this.token.value === ';') this.next(false);
        else if (this.token.value !== '}' && this.token.value !== '' && !this.token.lineBreakBefore) throw new Error('Expected semicolon');
    }

    private declaration(allowIn = true): string {
        const kind = this.token.value;
        // Match the engine's default CompilerEnvirons (ES3); let is not a
        // declaration there, although runtime scripts may enable JS 1.8.
        if (kind === 'let') throw new Error('Unsupported declaration');
        this.next();
        const declarations: string[] = [];
        do {
            let variable = this.binding();
            if (this.token.value === '=') { this.next(); variable += ` = ${this.expression(2, allowIn)}`; }
            declarations.push(variable);
            if (this.token.value !== ',') break;
            this.next();
        } while (true);
        return `${kind} ${declarations.join(', ')}`;
    }

    // Statements form a separate grammar from expressions. Keep their shape
    // until rendering: a block, loop or catch clause cannot acquire a stray
    // semicolon or lose its body through expression formatting.
    private statement(): Statement {
        if (this.token.comment) return { kind: 'comment', comment: this.comment() };
        const line = this.token.line;
        const statement = this.statementCore();
        // Following comments remain sibling nodes after function declarations.
        if (statement.kind !== 'function' && this.token.comment && this.token.line === line) statement.inlineComment = this.comment();
        return statement;
    }

    private statementBody(): { body: Statement; inlineComment?: SourceComment } {
        const first = this.statement();
        return first.kind === 'comment' ? { body: this.statement(), inlineComment: first.comment } : { body: first };
    }

    private statementCore(): Statement {
        const start = this.token.value;
        if (start === '{') return this.block();
        if (start === 'function') return this.functionSource();
        if (start === 'if') {
            this.next(); const test = this.condition();
            const { body: consequent, inlineComment } = this.statementBody();
            let alternate: Statement | undefined;
            let alternateComment: SourceComment | undefined;
            this.skipComments();
            if (this.token.value === 'else') {
                this.next(false);
                if (this.token.comment) alternateComment = this.comment();
                alternate = this.statement();
            }
            return { kind: 'if', test, consequent, alternate, inlineComment, alternateComment };
        }
        if (start === 'while' || start === 'with') {
            this.next(); const test = this.condition();
            return { kind: 'loop', keyword: start, head: `${start} (${test})`, ...this.statementBody() };
        }
        if (start === 'do') {
            this.next(false); const { body, inlineComment } = this.statementBody();
            this.take('while'); const test = this.condition();
            this.skipComments();
            if (this.token.value === ';') this.next(false);
            return { kind: 'do', test, body, inlineComment };
        }
        if (start === 'for') {
            this.next(); const each = this.token.value === 'each';
            if (each) this.next();
            this.take('(');
            const initializer = this.token.value === ';' ? ''
                : ['var', 'const', 'let'].includes(this.token.value) ? this.declaration(false) : this.expression(1, false);
            let head = `for${each ? ' each' : ''} (${initializer}`;
            if (this.token.value === 'in') {
                this.next(); head += ` in ${this.expression()})`;
            } else {
                if (each) throw new Error('Expected in');
                this.take(';'); head += `; ${this.token.value === ';' ? '' : this.expression()}`;
                this.take(';'); head += `; ${this.token.value === ')' ? '' : this.expression()})`;
            }
            this.take(')', false);
            return { kind: 'loop', keyword: 'for', head, ...this.statementBody() };
        }
        if (start === 'try') {
            this.next(); const body = this.block();
            const catches: { binding: string; body: Block }[] = [];
            this.skipComments();
            while (this.at('catch')) {
                this.next(); this.take('(');
                let binding = this.identifier();
                // Rhino permits guarded catches before an unconditional one.
                if (this.at('if')) { this.next(); binding += ` if ${this.expression()}`; }
                this.take(')'); catches.push({ binding, body: this.block() });
                this.skipComments();
            }
            let finalizer: Block | undefined;
            if (this.token.value === 'finally') { this.next(); finalizer = this.block(); }
            if (!catches.length && !finalizer) throw new Error('Expected catch or finally');
            return { kind: 'try', body, catches, finalizer };
        }
        if (start === 'switch') {
            this.next(); const test = this.condition(); this.take('{');
            const cases: SwitchBranch[] = [];
            while (this.token.value !== '}') {
                this.skipComments();
                const line = this.token.line;
                let caseTest: string | undefined;
                if (this.token.value === 'case') { this.next(); caseTest = this.expression(); }
                else this.take('default');
                this.take(':', false); const branch: SwitchBranch = { test: caseTest, body: [] };
                while (!['case', 'default', '}'].includes(this.token.value)) {
                    if (this.token.comment) {
                        const sameLine = this.token.line === line;
                        const comment = this.comment();
                        if (!branch.inlineComment && sameLine) branch.inlineComment = comment;
                        else branch.body.push({ kind: 'comment', comment });
                    } else branch.body.push(this.statement());
                }
                cases.push(branch);
            }
            this.take('}', false); return { kind: 'switch', test, cases };
        }
        if (['var', 'let', 'const'].includes(start)) {
            const source = this.declaration(); this.semicolon(); return { kind: 'simple', source: source + ';', showInlineComment: true };
        }
        if (['return', 'throw', 'break', 'continue', 'debugger'].includes(start)) {
            this.next();
            const lineBreak = this.token.skippedComment?.lineBreakBefore ?? this.token.lineBreakBefore;
            if (start === 'throw' && lineBreak) throw new Error('Line break after throw');
            const noValue = [';', '}', ''].includes(this.token.value) || lineBreak || start === 'debugger';
            const value = noValue ? '' : ' ' + (start === 'break' || start === 'continue' ? this.identifier() : this.expression());
            if (start === 'throw' && !value) throw new Error('Expected throw expression');
            this.semicolon(); return { kind: 'simple', source: start + value + ';' };
        }
        if (start === ';') { this.next(false); return { kind: 'simple', source: ';' }; }
        const expression = this.expression();
        if (this.token.value === ':' && name.exec(expression)?.[0] === expression && !keywords.has(expression)) {
            this.next(false); return { kind: 'label', label: expression, body: this.statement() };
        }
        this.semicolon(); return { kind: 'simple', source: expression + ';', showInlineComment: true };
    }
}

/** Match Rhino's statement toSource layout, including its catch indentation. */
function commentSource(comment: SourceComment, depth = 0): string {
    return '  '.repeat(depth) + comment.source + (comment.style === 'block' ? '\n' : '');
}

function statementSource(statement: Statement, depth = 0): string {
    const pad = '  '.repeat(depth);
    const bodySource = (body: Statement) => body.kind === 'block'
        ? statementSource(body, depth).trimStart() : '\n' + statementSource(body, depth + 1);
    switch (statement.kind) {
        case 'comment': return commentSource(statement.comment, depth) + '\n';
        case 'simple': return pad + statement.source
            + (statement.showInlineComment && statement.inlineComment ? commentSource(statement.inlineComment, depth) : '') + '\n';
        case 'block': return pad + '{\n' + statement.body.map(child => statementSource(child, depth + 1)).join('') + pad + '}\n';
        case 'function': return pad + statement.head + ' ' + bodySource(statement.body);
        case 'loop': {
            let source = pad + statement.head + ' ';
            if (!statement.inlineComment) return source + bodySource(statement.body);
            const commentDepth = statement.keyword === 'for' ? 0 : depth + 1;
            source += commentSource(statement.inlineComment, commentDepth);
            if (statement.keyword !== 'with' || statement.body.kind === 'block') source += '\n';
            if (statement.body.kind === 'block') {
                source += statement.keyword === 'for' ? statementSource(statement.body, depth) + '\n' : bodySource(statement.body);
            } else {
                if (statement.keyword === 'with') source += '\n';
                source += statementSource(statement.body, depth + 1);
            }
            return source;
        }
        case 'do': return pad + 'do '
            + (statement.inlineComment ? commentSource(statement.inlineComment, depth + 1) + '\n' : '')
            + statementSource(statement.body, depth).trim() + ` while (${statement.test});\n`;
        case 'label': {
            let source = '', body: Statement = statement;
            // Consecutive labels belong to one labelled statement in Rhino.
            while (body.kind === 'label') { source += pad + body.label + ':\n'; body = body.body; }
            return source + (body.kind === 'comment' ? commentSource(body.comment, depth + 1) : statementSource(body, depth + 1));
        }
        case 'if': {
            const branchSource = (body: Statement, comment?: SourceComment, elseBranch = false) => {
                const rendered = statementSource(body, depth).trim();
                return (comment ? commentSource(comment, depth + 1) + '\n' : '')
                    + (body.kind === 'block' || (elseBranch && body.kind === 'if') ? '' : (comment ? '' : '\n') + '  '.repeat(depth + 1)) + rendered;
            };
            let source = pad + `if (${statement.test}) ` + branchSource(statement.consequent, statement.inlineComment);
            if (statement.alternate) {
                source += statement.consequent.kind === 'block' ? ' else ' : '\n' + pad + 'else ';
                source += branchSource(statement.alternate, statement.alternateComment, true);
            }
            return source + '\n';
        }
        case 'switch': return pad + `switch (${statement.test}) {\n`
            + statement.cases.map(branch => pad + '  ' + (branch.test == null ? 'default' : `case ${branch.test}`) + ':'
                + (branch.test != null && branch.inlineComment ? commentSource(branch.inlineComment, depth + 2) : '') + '\n'
                + branch.body.map(child => child.kind === 'comment' ? commentSource(child.comment, depth + 2)
                    + (child.comment.style === 'line' ? '\n' : '')
                    : statementSource(child, depth + 2)).join('')).join('') + pad + '}\n';
        case 'try': return pad + 'try ' + statementSource(statement.body, depth).trim()
            + statement.catches.map(clause => pad + `catch (${clause.binding}) ` + statementSource(clause.body)).join('')
            + (statement.finalizer ? ' finally ' + statementSource(statement.finalizer, depth) : statement.catches.length ? '' : '\n');
    }
}

/** Read one bracketed XmlElemRef key, preserving all nested member indices. */
export function readComputedKey(text: string, literalSource: LiteralSource): { source: string; end: number } | null {
    try {
        return new KeySourceReader(text, literalSource).group('[');
    } catch { return null; }
}

/** Locate an E4X predicate without confusing quoted/XML/regexp ')' text. */
export function readParenthesizedExpression(text: string, literalSource: LiteralSource): { source: string; end: number } | null {
    try { return new KeySourceReader(text, literalSource).group('('); }
    catch { return null; }
}
