/* Rhino member-chain parsing and XmlElemRef key source rendering. The outer
 * visitor follows member parts; a computed XML key is printed as a whole:
 * an index in fields[0] is part of the key, not a repetition to remove.
 * Comments are tokens: statement nodes retain standalone/inline comments,
 * while expression productions skip them just as Rhino's recording parser
 * does. Source line positions control attachment and automatic semicolons.
 * This reader never evaluates expressions or resolves user identifiers.
 */

type SourceComment = { source: string; style: 'block' | 'line' | 'jsdoc' | 'html' };
type Token = {
    value: string; end: number; line: number; literal?: boolean; lineBreakBefore?: boolean;
    word?: boolean; keyword?: boolean;
    comment?: SourceComment;
    skippedComment?: { lineBreakBefore: boolean };
};
type LiteralSource = (literal: string) => string | null;
type MemberPart = { kind: 'property'; source: string; ordinary: boolean }
    | { kind: 'element'; source: string }
    | { kind: 'child'; expression: string; source: string };
type MemberChain = { root?: string; members: MemberPart[] };
type Block = { kind: 'block'; body: Statement[] };
type FunctionSource = { kind: 'function'; head: string; body: Block; statement?: boolean };
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
    + 'new return switch throw try typeof var void while with true false null this').split(' '));
// Default Rhino permits these reserved words as names. An escaped spelling
// of any keyword is also a NAME, whose last character toSource re-escapes.
const reserved = new Set([...keywords, ...('let yield class enum export extends import super implements interface package private '
    + 'protected public static abstract boolean byte char double final float goto int long native short synchronized throws transient volatile').split(' ')]);
const encodedName = /^(?:[\p{L}\p{Nl}\p{Sc}\p{Pc}]|\\u[\da-fA-F]{4})(?:[\p{L}\p{Nl}\p{Sc}\p{Pc}\p{Mn}\p{Mc}\p{Nd}\u0000-\u0008\u000e-\u001b\u007f-\u009f]|\\u[\da-fA-F]{4})*/u;
const number = /^(?:0[xX][\da-fA-F]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/;
const formatCharacter = (ch: string) => ch?.length === 1 && ch !== '\ufeff' && /\p{Cf}/u.test(ch);
const withoutFormatCharacters = (source: string) => source.replace(/\p{Cf}/gu, ch => formatCharacter(ch) ? '' : ch);
const precedence: Record<string, number> = {
    ',': 1, '=': 2, '+=': 2, '-=': 2, '*=': 2, '/=': 2, '%=': 2,
    '|=': 2, '^=': 2, '&=': 2, '<<=': 2, '>>=': 2, '>>>=': 2,
    '||': 4, '&&': 5, '|': 6, '^': 7, '&': 8,
    '==': 9, '!=': 9, '===': 9, '!==': 9,
    '<': 10, '>': 10, '<=': 10, '>=': 10, in: 10, instanceof: 10,
    '<<': 11, '>>': 11, '>>>': 11, '+': 12, '-': 12, '*': 13, '/': 13, '%': 13
};

class RhinoSourceReader {
    private position = 0;
    private linePosition = 0;
    private line = 1;
    private xmlLiteralDepth = 0;
    private functionDepth = 0;
    private loopDepth = 0;
    private switchDepth = 0;
    private labels: { name: string; loop: boolean }[] = [];
    private pendingLabels?: { name: string; loop: boolean }[];
    private consecutiveLabel = false;
    token: Token = { value: '', end: 0, line: 1 };

    constructor(private text: string, private literalSource: LiteralSource) { this.next(); }

    private advanceCharacters(start: number, length: number): number {
        let end = start;
        while (length) { if (!formatCharacter(this.text[end])) length--; end++; }
        return end;
    }

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
        while (this.position < text.length && (/\s/.test(text[this.position]) || formatCharacter(text[this.position]))) this.position++;
        const start = this.position;
        const lineBreakBefore = /[\n\r\u2028\u2029]/.test(text.slice(triviaStart, start));
        this.line += text.slice(this.linePosition, start).match(/\r\n|[\n\r\u2028\u2029]/g)?.length || 0;
        this.linePosition = start;
        const line = this.line;
        const ch = text[start];
        if (!ch) { this.token = { value: '', end: start, line, lineBreakBefore }; return; }
        // TokenStream ignores raw BMP format characters while reading tokens,
        // but string text and escaped identifier code units retain them.
        const tail = withoutFormatCharacters(text.slice(start));
        const tokenEnd = (length: number) => this.advanceCharacters(start, length);
        if (lineBreakBefore && text.startsWith('-->', start)) {
            while (this.position < text.length && !/[\n\r\u2028\u2029]/.test(text[this.position])) this.position++;
            const source = text.slice(start, this.position);
            this.token = { value: source, end: this.position, line, lineBreakBefore, comment: { source, style: 'html' } };
            return;
        }
        if (tail.startsWith('/*') || tail.startsWith('//')) {
            const style = tail[1] === '/' ? 'line' : tail[2] === '*' ? 'jsdoc' : 'block';
            if (style === 'line') {
                while (this.position < text.length && !/[\n\r\u2028\u2029]/.test(text[this.position])) this.position++;
            } else {
                const end = tail.indexOf('*/', 2);
                if (end < 0) throw new Error('Unterminated comment');
                this.position = tokenEnd(end + 2);
            }
            // The recording parser's Reader comment length starts after its
            // two-character opener, even when ignored format chars split it.
            const source = text.slice(start, this.position - (tokenEnd(2) - start - 2));
            this.token = { value: source, end: this.position, line, lineBreakBefore, comment: { source, style } };
            return;
        }
        if (ch === '"' || ch === "'") {
            this.position++;
            while (this.position < text.length) {
                if (text[this.position] === '\\') {
                    this.position++;
                    while (formatCharacter(text[this.position])) this.position++;
                    this.position++;
                }
                else if (text[this.position++] === ch) break;
            }
            const raw = text.slice(start, this.position);
            if (raw.length < 2 || raw.at(-1) !== ch) throw new Error('Unterminated string');
            const value = this.literalSource(raw);
            if (value == null) throw new Error('Invalid string');
            this.token = { value, end: this.position, line, literal: true, lineBreakBefore }; return;
        }
        const word = encodedName.exec(tail);
        const numeric = number.exec(tail);
        if (word || numeric) {
            // Default Rhino Parser rejects ES6 binary/octal numeric literals.
            if (/^0[bBoO]/.test(tail)) throw new Error('Unsupported numeric literal');
            const raw = (word || numeric)![0];
            if (numeric && /^0[0-7]+(?:\.|[eE])/.test(raw)) throw new Error('Invalid octal literal');
            if (word && /[\ud800-\udfff]/.test(raw)) throw new Error('Unsupported identifier code point');
            let value = word ? raw.replace(/\\u([\da-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))) : raw.replace(/^0X/, '0x');
            const escaped = !!word && raw.includes('\\');
            if (escaped && reserved.has(value)) value = value.slice(0, -1) + '\\u' + value.charCodeAt(value.length - 1).toString(16).padStart(4, '0');
            this.position = tokenEnd(raw.length);
            this.token = { value, end: this.position, line, literal: !!numeric, word: !!word, keyword: !!word && !escaped && keywords.has(value), lineBreakBefore }; return;
        }
        const operator = /^(?:>>>=|===|!==|>>>|<<=|>>=|\+\+|--|&&|\|\||==|!=|<=|>=|<<|>>|[+*/%&|^-]=|::|\.\.|\.\()/.exec(tail);
        const value = operator?.[0] || ch;
        this.position = tokenEnd(value.length);
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
            } else if (this.at('.(')) {
                const predicate = this.group('.(');
                source += `.(${predicate.source})`; this.next();
            } else if (['.', '..', '::'].includes(this.token.value)) {
                const separator = this.token.value;
                this.next(false); source += separator;
                let computed = separator === '::';
                if (this.token.value === '@') { source += '@'; this.next(false); computed = true; }
                if (this.token.value === '[' && !computed) throw new Error('Invalid member');
                if (this.token.value !== '[') {
                    if ((!this.token.word && this.token.value !== '*') || (computed && this.token.keyword)) throw new Error('Invalid member');
                    source += this.token.value; this.next();
                    if (!computed) this.token.skippedComment = undefined;
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
                if (!key.literal && !key.word) throw new Error('Invalid object key');
                this.next();
                if (!key.literal && ['get', 'set'].includes(key.value) && this.token.value !== ':') {
                    const property = this.token;
                    if (!property.literal && !property.word) throw new Error('Invalid accessor key');
                    this.next();
                    const parameters = this.parameters();
                    if (parameters.length !== (key.value === 'get' ? 0 : 1)) throw new Error('Invalid accessor parameters');
                    properties.push(`${key.value} ${property.value}(${parameters.join(', ')}) ${statementSource(this.functionBody(), 1).trimStart()}`);
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
                if (formatCharacter(ch)) continue;
                if (ch === '\\') {
                    index++;
                    while (formatCharacter(this.text[index])) index++;
                }
                else if (ch === '[') inClass = true;
                else if (ch === ']') inClass = false;
                else if (ch === '/' && !inClass) break;
                else if (/[\n\r]/.test(ch)) throw new Error('Invalid regexp');
            }
            if (index >= this.text.length) throw new Error('Unterminated regexp');
            while (/[a-z]/i.test(this.text[index + 1] || '') || formatCharacter(this.text[index + 1])) index++;
            const source = withoutFormatCharacters(this.text.slice(begin, index + 1));
            this.position = index + 1; this.next(); return source;
        }
        if (token.value === 'function') {
            const fn = this.functionSource();
            return `${fn.head} ${statementSource(fn.body).trimEnd()}`;
        }
        if (token.value === '@') {
            this.next(false);
            if (this.token.value === '[') {
                this.next(); const source = `@[${this.expression()}]`; this.take(']'); return source;
            }
            if ((!this.token.word || this.token.keyword) && this.token.value !== '*') throw new Error('Invalid attribute name');
            const source = '@' + this.token.value; this.next();
            this.token.skippedComment = undefined;
            return source;
        }
        if (!token.literal && (!token.word || (token.keyword && !['true', 'false', 'null', 'this'].includes(token.value)))) throw new Error('Expected expression');
        this.next();
        // Rhino's Name/property reader probes for a namespace separator with
        // comment skipping, before the general member-chain lookahead.
        if (token.word && !token.keyword) this.token.skippedComment = undefined;
        return token.value;
    }

    private identifier(): string {
        const value = this.token.value;
        if (!this.token.word || this.token.keyword) throw new Error('Expected identifier');
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
                if (!key.literal && !key.word) throw new Error('Invalid binding key');
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

    group(open: '[' | '(' | '.('): { source: string; end: number } {
        this.take(open);
        let source = this.expression();
        if (open === '(' && this.at('for')) source += this.comprehension(false);
        if (!this.at(open === '[' ? ']' : ')')) throw new Error('Unterminated expression group');
        return { source, end: this.token.end };
    }

    // Follow the same token boundaries as Rhino's outer ExpressionVisitor.
    // Whitespace separates tokens, but '..', '::' and '.(' stay indivisible.
    // Its recording parser skips comments during member lookahead, but not
    // when consuming the name immediately after '.', '@' or '::'.
    memberChain(nested: boolean): MemberChain {
        if (!nested && this.token.skippedComment) throw new Error('Leading comment precedes expression');
        const root = this.token.value;
        let rootName: string | undefined;
        if (root === '(') { this.group('('); this.next(); }
        else if (this.token.word && (!this.token.keyword || ['true', 'false', 'null', 'this'].includes(root))) {
            rootName = ['true', 'false', 'null', 'this'].includes(root) ? undefined : root;
            this.next();
            this.token.skippedComment = undefined;
        } else throw new Error('Unsupported member root');
        const members: MemberPart[] = [];
        while (['[', '.', '..', '.('].includes(this.token.value)) {
            if (this.at('[')) {
                const begin = this.token.end;
                const key = this.group('[');
                members.push({ kind: 'child', expression: this.text.slice(begin, key.end - 1), source: key.source });
                this.next();
                continue;
            }
            if (this.at('.(')) {
                const begin = this.token.end;
                const predicate = this.group('.(');
                members.push({ kind: 'child', expression: this.text.slice(begin, predicate.end - 1), source: predicate.source });
                this.next();
                continue;
            }
            const dot = this.token;
            this.next(false);
            let prefix = '';
            if (this.at('@')) { prefix = '@'; this.next(false); }
            if (prefix && this.at('[')) {
                const key = this.group('[');
                members.push({ kind: 'element', source: `@[${key.source}]` });
                this.next();
                continue;
            }
            const property = this.token;
            if ((!property.word && property.value !== '*') || (prefix && property.keyword)) {
                throw new Error('Expected member name');
            }
            this.next();
            let source = prefix + property.value;
            let qualified = false;
            if (this.at('::')) {
                qualified = true;
                source += '::';
                this.next(false);
                if (this.at('[')) {
                    const key = this.group('[');
                    members.push({ kind: 'element', source: `${source}[${key.source}]` });
                    this.next();
                    continue;
                }
                const local = this.token;
                if ((!local.word && local.value !== '*') || local.keyword) {
                    throw new Error('Expected namespace member');
                }
                source += local.value;
                this.next();
            }
            members.push({ kind: 'property', source, ordinary: dot.value === '.' && !prefix && !qualified && property.value !== '*' });
            if (!qualified) this.token.skippedComment = undefined;
        }
        // The native helper parses a program and visits its first expression.
        // A semicolon ends that expression; later statements still must parse.
        if (nested) {
            if (this.token.value) throw new Error('Unsupported child expression');
        } else {
            this.semicolon();
            while (this.token.value) this.statement();
        }
        return { root: rootName, members };
    }

    // XML text is not JavaScript trivia: quotes, brackets, comments and CDATA
    // stay literal. Only {...} substitutions re-enter the expression grammar.
    // Track tag nesting rather than treating '<...>' as an ordinary operator.
    private xmlLiteral(): string {
        // The bundled Rhino token stream cannot nest a second XML scanner
        // inside an XML {...} substitution. Match its parse failure rather
        // than accepting a dialect that Swing would leave untouched.
        if (this.xmlLiteralDepth || withoutFormatCharacters(this.text.slice(this.token.end - 1)).startsWith('<!--')) throw new Error('Unsupported nested XML literal');
        this.xmlLiteralDepth++;
        try { return this.readXmlLiteral(); }
        finally { this.xmlLiteralDepth--; }
    }

    private readXmlLiteral(): string {
        const text = this.text;
        let index = this.token.end - 1, chunk = index, source = '';
        let depth = 0, inTag = false, closing = false, quote = '';
        const finish = () => {
            source += withoutFormatCharacters(text.slice(chunk, index));
            this.position = index; this.next(); return source;
        };
        while (index < text.length) {
            const ch = text[index];
            if (formatCharacter(ch)) { index++; continue; }
            if (quote) {
                if (ch === quote) quote = '';
                index++; continue;
            }
            if (inTag && (ch === '"' || ch === "'")) { quote = ch; index++; continue; }
            const tail = withoutFormatCharacters(text.slice(index));
            const terminator = tail.startsWith('<!--') ? '-->'
                : tail.startsWith('<![CDATA[') ? ']]>' : tail.startsWith('<?') ? '?>' : null;
            if (terminator) {
                const end = tail.indexOf(terminator, terminator === '-->' ? 4 : terminator === ']]>' ? 9 : 2);
                if (end < 0) throw new Error('Unterminated XML markup');
                index = this.advanceCharacters(index, end + terminator.length);
                if (!depth) return finish();
                continue;
            }
            if (tail.startsWith('<!')) {
                // Declarations may contain a quoted '>' or an internal subset.
                let subset = 0, declarationQuote = '';
                index = this.advanceCharacters(index, 2);
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
                source += withoutFormatCharacters(text.slice(chunk, index)) + '{';
                this.position = index + 1; this.next();
                if (!this.at('}')) source += this.expression();
                if (!this.at('}')) throw new Error('Unterminated XML substitution');
                source += '}'; index = this.token.end; chunk = index;
                continue;
            }
            if (ch === '<') {
                if (inTag) throw new Error('Invalid XML tag');
                closing = tail.startsWith('</');
                if (!closing) depth++;
                inTag = true; index = this.advanceCharacters(index, closing ? 2 : 1); continue;
            }
            if (inTag && ch === '>') {
                let previous = index - 1;
                while (formatCharacter(text[previous])) previous--;
                if (closing || text[previous] === '/') depth--;
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
        return { kind: 'function', head: `function${functionName}(${parameters.join(', ')})`, body: this.functionBody() };
    }

    private functionBody(): Block {
        const { loopDepth, switchDepth, labels } = this;
        this.loopDepth = this.switchDepth = 0;
        this.labels = [];
        this.functionDepth++;
        try { return this.block(true); }
        finally {
            this.functionDepth--;
            this.loopDepth = loopDepth;
            this.switchDepth = switchDepth;
            this.labels = labels;
        }
    }

    private block(functionBody = false): Block {
        this.take('{', false); const body: Statement[] = [];
        while (this.token.value !== '}') {
            body.push(functionBody && this.at('function') ? { ...this.functionSource(), statement: true } : this.statement());
        }
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

    private iterationBody(): { body: Statement; inlineComment?: SourceComment } {
        // Rhino assigns a pending label bundle when it enters the first loop,
        // even when a block or conditional surrounds that loop.
        if (this.pendingLabels) for (const scope of this.pendingLabels) scope.loop = true;
        this.pendingLabels = undefined;
        this.loopDepth++;
        try { return this.statementBody(); }
        finally { this.loopDepth--; }
    }

    private labelledStatement(label: string, consecutive: boolean): Statement {
        if (this.labels.some(scope => scope.name === label)) throw new Error('Duplicate label');
        const scope = { name: label, loop: false };
        if (consecutive && this.pendingLabels) this.pendingLabels.push(scope);
        else this.pendingLabels = [scope];
        this.labels.push(scope);
        this.consecutiveLabel = true;
        try {
            const body = this.statement();
            return { kind: 'label', label, body };
        } finally {
            this.labels.pop();
            this.pendingLabels = undefined;
            this.consecutiveLabel = false;
        }
    }

    private statementCore(): Statement {
        const start = this.token.value;
        const consecutiveLabel = this.consecutiveLabel;
        this.consecutiveLabel = false;
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
            return { kind: 'loop', keyword: start, head: `${start} (${test})`,
                ...(start === 'while' ? this.iterationBody() : this.statementBody()) };
        }
        if (start === 'do') {
            this.next(false); const { body, inlineComment } = this.iterationBody();
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
                : ['var', 'const'].includes(this.token.value) ? this.declaration(false) : this.expression(1, false);
            let head = `for${each ? ' each' : ''} (${initializer}`;
            if (this.token.value === 'in') {
                this.next(); head += ` in ${this.expression()})`;
            } else {
                if (each) throw new Error('Expected in');
                this.take(';'); head += `; ${this.token.value === ';' ? '' : this.expression()}`;
                this.take(';'); head += `; ${this.token.value === ')' ? '' : this.expression()})`;
            }
            this.take(')', false);
            return { kind: 'loop', keyword: 'for', head, ...this.iterationBody() };
        }
        if (start === 'try') {
            this.next(); const body = this.block();
            const catches: { binding: string; body: Block }[] = [];
            let unguardedCatch = false;
            this.skipComments();
            while (this.at('catch')) {
                if (unguardedCatch) throw new Error('Unreachable catch');
                this.next(); this.take('(');
                let binding = this.identifier();
                // Rhino permits guarded catches before an unconditional one.
                if (this.at('if')) { this.next(); binding += ` if ${this.expression()}`; }
                else unguardedCatch = true;
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
            let hasDefault = false;
            this.switchDepth++;
            try {
                while (this.token.value !== '}') {
                    this.skipComments();
                    const line = this.token.line;
                    let caseTest: string | undefined;
                    if (this.token.value === 'case') { this.next(); caseTest = this.expression(); }
                    else {
                        this.take('default');
                        if (hasDefault) throw new Error('Duplicate default');
                        hasDefault = true;
                    }
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
            } finally { this.switchDepth--; }
        }
        if (['var', 'const'].includes(start)) {
            const source = this.declaration(); this.semicolon(); return { kind: 'simple', source: source + ';', showInlineComment: true };
        }
        if (['return', 'throw', 'break', 'continue', 'debugger'].includes(start)) {
            if (start === 'return' && !this.functionDepth) throw new Error('Return outside function');
            const jump = start === 'break' || start === 'continue';
            this.next(!jump);
            const lineBreak = this.token.skippedComment?.lineBreakBefore ?? this.token.lineBreakBefore;
            if (start === 'throw' && lineBreak) throw new Error('Line break after throw');
            const noValue = [';', '}', ''].includes(this.token.value) || lineBreak || start === 'debugger' || (jump && !!this.token.comment);
            const value = noValue ? '' : ' ' + (start === 'break' || start === 'continue' ? this.identifier() : this.expression());
            if (start === 'throw' && !value) throw new Error('Expected throw expression');
            if (start === 'break' || start === 'continue') {
                if (value) {
                    const label = this.labels.find(scope => scope.name === value.slice(1));
                    if (!label) throw new Error('Unknown label');
                    if (start === 'continue' && !label.loop) throw new Error('Continue target is not a loop');
                } else if (!this.loopDepth && (start === 'continue' || !this.switchDepth)) {
                    throw new Error(`${start} outside its target`);
                }
            }
            this.semicolon(); return { kind: 'simple', source: start + value + ';' };
        }
        if (start === ';') { this.next(false); return { kind: 'simple', source: ';' }; }
        const label = this.token.word && !this.token.keyword ? this.token.value : undefined;
        const expression = this.expression();
        if (this.token.value === ':' && expression === label) {
            this.next(false); return this.labelledStatement(expression, consecutiveLabel);
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
        case 'function': {
            const source = pad + statement.head + ' ' + bodySource(statement.body);
            return statement.statement ? source : source.trimEnd();
        }
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

/** Parse the member chain visited by Swing, retaining raw ordinary child keys. */
export function readMemberChain(text: string, literalSource: LiteralSource, nested = false): MemberChain | null {
    try { return new RhinoSourceReader(text, literalSource).memberChain(nested); }
    catch { return null; }
}
