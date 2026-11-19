/* Rhino member-chain parsing and XmlElemRef key source rendering. The outer
 * visitor follows member parts; a computed XML key is printed as a whole:
 * an index in fields[0] is part of the key, not a repetition to remove.
 * Comments are tokens: statement nodes retain standalone/inline comments,
 * while expression productions skip them just as Rhino's recording parser
 * does. Source line positions control attachment and automatic semicolons.
 * This reader never evaluates expressions or resolves user identifiers.
 */

import { isJavaBlank } from './oie.js';

type SourceComment = { source: string; style: 'block' | 'line' | 'jsdoc' | 'html' };
type Token = {
    value: string; end: number; line: number; literal?: boolean; lineBreakBefore?: boolean;
    word?: boolean; keyword?: boolean;
    comment?: SourceComment;
    skippedComment?: { lineBreakBefore: boolean };
};
type PathMode = 'substitution' | 'messageBuilder';
// Message Builder uses Rhino's visitor with numeric literals included. The
// substitution wizard uses the same visitor with those literals removed.
type PathLeaf = { kind: 'name' | 'property' | 'string' | 'xml' | 'number' | 'callTail'; source: string; propertyName?: string; unprintable?: boolean };
type ExpressionPart = { value: string; propertyName: string; numberLiteral?: boolean };
type ParameterList = { items: string[]; names: string[]; parenthesized?: boolean };
type Operand = { source: string; reference?: boolean; parameters?: ParameterList };
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
// Swing's Rhino parser uses the default language version, which also accepts
// backticks as ordinary string delimiters when reading iterator expressions.
const stringQuote = /^['"`]/;
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

const escapes: Record<string, string> = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };
const escapeByCharacter = new Map(Object.entries(escapes).map(([key, value]) => [value, key]));

// Rhino StringLiteral.toSource decodes JavaScript escapes, then prints the
// original quote style with ASCII escapes. Keep this limited to literal keys;
// no user expression is evaluated.
function stringLiteralValue(literal: string): string | null {
    let value = '';
    for (let index = 1; index < literal.length - 1; index++) {
        let ch = literal[index];
        if (ch === '\\') {
            while (literal[index + 1] && literal[index + 1] !== '\ufeff' && /\p{Cf}/u.test(literal[index + 1])) index++;
            ch = literal[++index];
            if (Object.hasOwn(escapes, ch)) value += escapes[ch];
            else if (ch === 'u' || ch === 'x') {
                const size = ch === 'u' ? 4 : 2;
                let hex = '', end = index + 1;
                while (hex.length < size) {
                    while (formatCharacter(literal[end])) end++;
                    if (!/[\da-f]/i.test(literal[end] || '')) break;
                    hex += literal[end++];
                }
                // Rhino treats an incomplete hex escape as literal text after the backslash.
                value += hex.length === size ? String.fromCharCode(parseInt(hex, 16)) : ch + hex;
                index = end - 1;
            } else if (/[0-7]/.test(ch)) {
                let octal = ch;
                while (octal.length < 3 && /[0-7]/.test(literal[index + 1] || '')
                    && parseInt(octal + literal[index + 1], 8) <= 255) octal += literal[++index];
                value += String.fromCharCode(parseInt(octal, 8));
            } else if (/[\n\r\u2028\u2029]/.test(ch)) {
                if (ch === '\r' && literal[index + 1] === '\n') index++;
            } else value += ch;
        } else {
            if (/[\n\r\u2028\u2029]/.test(ch)) return null;
            value += ch;
        }
    }
    return value;
}

function stringLiteralSource(literal: string): string | null {
    const value = stringLiteralValue(literal);
    if (value == null) return null;
    const quote = literal[0];
    let source = quote;
    for (let index = 0; index < value.length; index++) {
        const ch = value[index];
        const code = value.charCodeAt(index);
        const escape = escapeByCharacter.get(ch);
        if (escape) source += '\\' + escape;
        else if (ch === quote || ch === '\\') source += '\\' + ch;
        else if (code >= 0x20 && code <= 0x7e) source += ch;
        else source += code < 0x100 ? '\\x' + code.toString(16).padStart(2, '0') : '\\u' + code.toString(16).padStart(4, '0');
    }
    return source + quote;
}

class RhinoSourceReader {
    private position = 0;
    private previousEnd = 0;
    private readonly rootPath: PathLeaf[] = [];
    private linePosition = 0;
    private line = 1;
    private xmlLiteralDepth = 0;
    private namespaceStatements = 0;
    private readonly hasFormatCharacters: boolean;
    private destructuring = false;
    private strict = false;
    private symbols = new Map<string, 'variable' | 'const'>();
    private functionDepth = 0;
    private loopDepth = 0;
    private switchDepth = 0;
    private labels: { name: string; loop: boolean }[] = [];
    private pendingLabels?: { name: string; loop: boolean }[];
    private consecutiveLabel = false;
    token: Token = { value: '', end: 0, line: 1 };

    constructor(private text: string, private mode: PathMode) {
        this.hasFormatCharacters = /\p{Cf}/u.test(text);
        this.next();
    }

    private advanceCharacters(start: number, length: number): number {
        let end = start;
        while (length) { if (!formatCharacter(this.text[end])) length--; end++; }
        return end;
    }

    next(ignoreComments = true): void {
        this.previousEnd = this.token.end;
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
        const tail = this.hasFormatCharacters ? withoutFormatCharacters(text.slice(start)) : text.slice(start);
        const tokenEnd = (length: number) => this.hasFormatCharacters ? this.advanceCharacters(start, length) : start + length;
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
        if (stringQuote.test(ch)) {
            this.position++;
            while (this.position < text.length) {
                const next = text[this.position++];
                if (next === ch) {
                    const value = stringLiteralSource(text.slice(start, this.position));
                    if (value == null) throw new Error('Invalid string');
                    this.token = { value, end: this.position, line, literal: true, lineBreakBefore };
                    return;
                }
                if (next === '\\') {
                    while (formatCharacter(text[this.position])) this.position++;
                    this.position++;
                }
            }
            throw new Error('Unterminated string');
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
        const operator = /^(?:>>>=|===|!==|>>>|<<=|>>=|\+\+|--|&&|\|\||=>|==|!=|<=|>=|<<|>>|[+*/%&|^-]=|::|\.\.|\.\()/.exec(tail);
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

    private expression(min = 1, allowIn = true, path?: PathLeaf[]): string {
        return this.expressionNode(min, allowIn, path).source;
    }

    private expressionNode(min = 1, allowIn = true, path?: PathLeaf[]): Operand {
        this.skipComments();
        let node = this.unary(path);
        for (;;) {
            const op = this.token.value;
            if (op === '?' && min <= 3) {
                if (path) path.length = 0;
                this.next();
                const yes = this.expression(2);
                this.take(':');
                node = { source: `${node.source} ? ${yes} : ${this.expression(2, allowIn)}` };
            } else if (op === '=>' && min <= 2 && !this.token.lineBreakBefore) {
                const parameters = node.parameters;
                if (!parameters || (!parameters.parenthesized && parameters.items.length !== 1)) throw new Error('Invalid arrow parameters');
                this.checkParameters(parameters.items);
                if (path) path.length = 0;
                this.next();
                const args = parameters.items.join(', ');
                const head = parameters.parenthesized ? `(${args})` : args;
                const body = this.at('{') ? statementSource(this.functionBody(parameters)).trimEnd()
                    : this.inFunction(parameters, () => this.expression(2, allowIn));
                node = { source: `${head} => ${body}` };
            } else {
                const priority = Object.hasOwn(precedence, op) ? precedence[op] : undefined;
                if (op === 'in' && !allowIn) break;
                if (priority == null || priority < min) break;
                if (priority === 2 && this.destructuring) throw new Error('Unsupported destructuring default');
                if (path) path.length = 0;
                this.next();
                const right = this.expressionNode(priority === 2 ? priority : priority + 1, allowIn);
                const parameters = op === ',' && node.parameters && right.parameters
                    && !node.parameters.parenthesized && !right.parameters.parenthesized
                    ? { items: [...node.parameters.items, ...right.parameters.items], names: [...node.parameters.names, ...right.parameters.names] } : undefined;
                node = { source: `${node.source} ${op} ${right.source}`, parameters };
            }
        }
        return node;
    }

    private updateTarget(node: Operand): string {
        if (!node.reference) throw new Error('Invalid increment or decrement target');
        return node.source;
    }

    private unary(path?: PathLeaf[]): Operand {
        const op = this.token.value;
        if (op === '++' || op === '--') {
            this.next();
            return { source: op + this.updateTarget(this.memberExpression(true)) };
        }
        if (['+', '-', '!', '~', 'typeof', 'void', 'delete'].includes(op)) {
            this.next();
            return { source: op + (/^[a-z]/.test(op) ? ' ' : '') + this.unary().source };
        }
        if (op === '<') return this.memberTail({ source: this.xmlLiteral() }, true, path);
        const node = this.memberExpression(true, path);
        if (!this.token.lineBreakBefore && ['++', '--'].includes(this.token.value)) {
            if (path) path.length = 0;
            const source = this.updateTarget(node) + this.token.value;
            this.next();
            return { source };
        }
        return node;
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

    private memberExpression(calls: boolean, path?: PathLeaf[]): Operand {
        let node: Operand;
        if (this.at('new')) {
            this.next();
            const target = this.memberExpression(false);
            const args = this.at('(') ? this.arguments() : '()';
            const initializer = this.at('{') ? ' ' + this.primary().source : '';
            node = { source: `new ${target.source}${args}${initializer}` };
            if (this.mode === 'substitution' && path === this.rootPath) path = undefined;
        } else {
            node = this.primary(path);
        }
        return this.memberTail(node, calls, path);
    }

    private memberTail(node: Operand, calls: boolean, path?: PathLeaf[]): Operand {
        let receiver = path?.[0];
        const messageRoot = receiver?.kind === 'name' && (receiver.source === 'msg' || receiver.source === 'tmp');
        let memberStart = 0, receiverSize = 0;
        let preserveTail = false;
        for (;;) {
            this.skipComments();
            if (path === this.rootPath && !preserveTail && ['[', '.(', '.', '..'].includes(this.token.value)) {
                memberStart = this.previousEnd;
                receiverSize = path?.length ?? 0;
            }
            if (this.at('(') && calls) {
                node = { source: node.source + this.arguments(), reference: true };
                if (this.mode === 'substitution' && path === this.rootPath && ['.', '..', '.(', '[', '('].includes(this.token.value)) {
                    // A property of a call result cannot stand on its own. Keep the
                    // call and its remaining accesses together. Only ordinary message
                    // selectors before the call can have their repetitions normalized.
                    node = this.memberTail(node, calls);
                    path.length = messageRoot ? receiverSize : 0;
                    if (path.length) path.push({ kind: 'callTail', source: this.text.slice(memberStart) });
                    return node;
                }
                // Inside a computed key Swing visits the subsequent property.
                if (path) path.length = 0;
            } else if (this.at('[') || this.at('.(')) {
                const open = this.token.value;
                const close = open === '[' ? ']' : ')';
                this.next();
                const first = this.token;
                const child: PathLeaf[] | undefined = path && [];
                const key = this.expression(1, true, child);
                // Queries and computed keys can change the receiver itself.
                // A later call must keep these selectors as written.
                if (open !== '[' || key !== first.value || !(first.literal || (first.word && !first.keyword))) preserveTail = true;
                node = { source: node.source + open + key + close, reference: open === '[' };
                this.take(close);
                if (path && child) path.push(...child);
            } else if (this.at('.') || this.at('..')) {
                const separator = this.token.value;
                this.next(false);
                const property = this.propertyRef(separator);
                if (separator === '..' || property.kind === 'xml') preserveTail = true;
                if (property.kind === 'name') {
                    property.kind = 'property';
                    if (receiver?.kind === 'name') receiver.kind = 'property';
                }
                path?.push(property);
                node = { source: node.source + separator + property.source, reference: property.kind === 'property' };
            } else break;
            receiver = undefined;
        }
        return node;
    }

    private propertyRef(separator = ''): PathLeaf {
        const attribute = this.at('@');
        if (attribute) this.next(false);
        let prefix = attribute ? '@' : '';
        if (!attribute || !this.at('[')) {
            const name = this.token;
            if ((!name.word && name.value !== '*') || (name.keyword && (!separator || attribute))) throw new Error('Expected property name');
            this.next();
            if (!this.at('::')) {
                this.token.skippedComment = undefined;
                return { kind: attribute || separator === '..' ? 'xml' : 'name', source: prefix + name.value, propertyName: name.value };
            }
            prefix += name.value + '::';
            this.next(false);
            if (!this.at('[')) {
                const local = this.token;
                if ((!local.word && local.value !== '*') || local.keyword) throw new Error('Expected namespace member');
                this.next();
                return { kind: 'xml', source: prefix + local.value, propertyName: local.value };
            }
        }
        this.take('[');
        const beforeKey = this.namespaceStatements;
        const key = this.expression();
        this.take(']');
        return { kind: 'xml', source: `${prefix}[${key}]`, propertyName: key, unprintable: this.namespaceStatements !== beforeKey };
    }

    private objectKey(): string {
        const key = this.token;
        if (!key.literal && !key.word) throw new Error('Expected object key');
        this.next();
        // Rhino uses the scanner's digits for object keys, omitting the
        // hexadecimal or legacy octal prefix retained on numeric expressions.
        return key.literal ? key.value.replace(/^0x|^0(?=\d)/, '') : key.value;
    }

    private primary(path?: PathLeaf[]): Operand {
        const token = this.token;
        if (token.value === '(') {
            this.next();
            if (this.at(')')) {
                this.next();
                if (!this.at('=>') || this.token.lineBreakBefore) throw new Error('Expected expression');
                return { source: '()', parameters: { items: [], names: [], parenthesized: true } };
            }
            let inner = this.expressionNode();
            if (this.at('for')) inner = { source: inner.source + this.comprehension(false) };
            this.take(')');
            const parameters = inner.parameters && !inner.parameters.parenthesized
                ? { ...inner.parameters, parenthesized: true } : undefined;
            return { source: `(${inner.source})`, reference: inner.reference, parameters };
        }
        if (token.value === '[') {
            this.next(); const values: string[] = [], names: string[] = [];
            let trailingHole = false;
            while (this.token.value !== ']') {
                trailingHole = this.token.value === ',';
                values.push(trailingHole ? '' : this.patternValue(names));
                if (values.length === 1 && !trailingHole && this.at('for')) {
                    const source = `[${values[0]}${this.comprehension(true)}]`;
                    this.take(']'); return { source };
                }
                if (this.token.value !== ',') break;
                this.next();
            }
            this.take(']');
            const source = `[${values.join(', ')}${trailingHole ? ',' : ''}]`;
            return { source, parameters: { items: [source], names } };
        }
        if (token.value === '{') {
            this.next(); const properties: string[] = [], names: string[] = [];
            const defined = this.strict ? new Map<string, string>() : null;
            while (this.token.value !== '}') {
                const key = this.objectKey();
                const accessor = ['get', 'set'].includes(key) && !this.at(':') && !this.at('(');
                const name = accessor ? this.objectKey() : key;
                if (defined) {
                    const id = stringQuote.test(name) ? stringLiteralValue(name)! : name;
                    const kind = accessor ? key : 'property';
                    const earlier = defined.get(id);
                    if (earlier && (earlier === kind || earlier === 'property' || kind === 'property')) {
                        throw new Error('Duplicate strict object property');
                    }
                    defined.set(id, earlier ? 'property' : kind);
                }
                if (accessor || this.at('(')) {
                    const property = accessor ? key + ' ' + name : name;
                    const parameters = this.parameters();
                    properties.push(`${property}(${parameters.items.join(', ')}) ${statementSource(this.functionBody(parameters), 1).trimStart()}`);
                } else {
                    this.take(':');
                    properties.push(`${key}: ${this.patternValue(names)}`);
                }
                this.skipComments();
                if (this.token.value !== ',') break;
                this.next();
            }
            this.take('}');
            const source = properties.length ? `{\n  ${properties.join(', \n  ')}}` : '{}';
            return { source, parameters: { items: [source], names } };
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
                if (/[\n\r\u2028\u2029]/.test(this.text[index])) throw new Error('Invalid regexp');
            }
            if (index >= this.text.length) throw new Error('Unterminated regexp');
            while (/[gimy]/.test(this.text[index + 1] || '') || formatCharacter(this.text[index + 1])) index++;
            if (/[a-z]/i.test(this.text[index + 1] || '')) throw new Error('Invalid regexp flag');
            const source = withoutFormatCharacters(this.text.slice(begin, index + 1));
            this.position = index + 1; this.next(); return { source };
        }
        if (token.value === 'function') {
            const fn = this.functionSource();
            return { source: `${fn.head} ${statementSource(fn.body).trimEnd()}` };
        }
        if (token.value === '@' || (token.word && !token.keyword)) {
            const ref = this.propertyRef();
            path?.push(ref);
            return ref.kind === 'name' ? { source: ref.source, reference: true, parameters: { items: [ref.source], names: [ref.source] } }
                : { source: ref.source };
        }
        if (!token.literal && (!token.word || (token.keyword && !['true', 'false', 'null', 'this'].includes(token.value)))) throw new Error('Expected expression');
        if (this.strict && token.literal && /^0\d/.test(token.value)) throw new Error('Legacy octal in strict code');
        if (stringQuote.test(token.value)) path?.push({ kind: 'string', source: token.value });
        else if (token.literal && this.mode === 'messageBuilder') path?.push({ kind: 'number', source: token.value });
        this.next();
        return { source: token.value };
    }

    private identifier(): string {
        const value = this.token.value;
        if (!this.token.word || this.token.keyword) throw new Error('Expected identifier');
        this.next();
        return value;
    }

    private patternValue(names: string[]): string {
        const value = this.expressionNode(2);
        if (value.parameters && !value.parameters.parenthesized) names.push(...value.parameters.names);
        return value.source;
    }

    // Rhino reads array and object binding patterns with its literal grammar,
    // with assignment operators disabled inside the pattern.
    private binding(names?: string[]): string {
        if (!this.at('[') && !this.at('{')) {
            const name = this.bindingName();
            names?.push(name);
            return name;
        }
        const before = this.destructuring;
        this.destructuring = true;
        try {
            const pattern = this.primary();
            if (names && pattern.parameters) names.push(...pattern.parameters.names);
            return pattern.source;
        }
        finally { this.destructuring = before; }
    }

    private comprehension(array: boolean): string {
        let source = '';
        while (this.at('for')) {
            this.next(); const each = this.at('each');
            if (each) {
                if (!array) throw new Error('Generator cannot use for each');
                this.next();
            }
            this.take('(');
            const iterator = this.binding();
            if (this.symbols.get(iterator) === 'const') throw new Error('Iterator redeclares a constant');
            const operator = array && !each && this.at('of') ? 'of' : 'in';
            this.take(operator);
            const iterable = this.expression(); this.take(')');
            source += ` for${each ? ' each' : ''} (${iterator} ${operator} ${iterable})`;
        }
        if (this.at('if')) { this.next(); source += ` if (${this.condition()})`; }
        return source;
    }

    expressionParts(): ExpressionPart[] {
        if (!this.token.value || this.token.skippedComment) return [];
        // Swing visits only the first expression, after parsing the entire program.
        this.statementList('', true, this.rootPath);
        const parts: ExpressionPart[] = [];
        for (const { kind, source, propertyName = source, unprintable } of this.rootPath) {
            let value: string;
            if (!parts.length) {
                if (kind !== 'name' && kind !== 'property') continue;
                value = source;
            } else if (kind === 'callTail') value = source;
            else {
                if (unprintable) throw new Error('Rhino cannot print a default XML namespace in an XML key');
                value = kind === 'property' || kind === 'xml' ? '.' + source : `[${source}]`;
            }
            parts.push(kind === 'number' ? { value, propertyName, numberLiteral: true } : { value, propertyName });
        }
        if (this.rootPath.some(leaf => leaf.kind === 'callTail')) {
            // A method result is one wizard target. Inferring a matching tmp
            // prefix from just its receiver would also rewrite unrelated fields.
            const value = parts.map(part => part.value).join('');
            return [{ value, propertyName: value }];
        }
        return parts;
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
                continue;
            }
            if (ch === '{') {
                source += withoutFormatCharacters(text.slice(chunk, index)) + '{';
                this.position = index + 1; this.next(false);
                if (!this.at('}')) source += this.expression();
                if (!this.at('}')) throw new Error('Unterminated XML substitution');
                source += '}'; index = this.token.end; chunk = index;
                continue;
            }
            if (ch === '<') {
                if (inTag) throw new Error('Invalid XML tag');
                closing = tail.startsWith('</');
                if (closing && !depth) throw new Error('Unexpected XML closing tag');
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

    private parameters(): ParameterList {
        this.take('(');
        const items: string[] = [], names: string[] = [];
        if (this.token.value !== ')') {
            do {
                items.push(this.binding(names));
                if (this.token.value !== ',') break;
                this.next();
            } while (true);
        }
        this.take(')');
        this.checkParameters(items);
        return { items, names };
    }

    private bindingName(): string {
        const name = this.identifier();
        if (this.strict && (name === 'eval' || name === 'arguments')) throw new Error('Invalid strict binding');
        return name;
    }

    private checkParameters(parameters: string[]): void {
        if (!this.strict) return;
        const names = parameters.filter(name => !name.startsWith('[') && !name.startsWith('{'));
        if (new Set(names).size !== names.length || names.includes('eval') || names.includes('arguments')) {
            throw new Error('Invalid strict parameters');
        }
    }

    // Rhino registers var, const and function declarations in the containing
    // function, including declarations in blocks. A const cannot share a name.
    private declare(name: string, kind: 'const' | 'variable'): void {
        const previous = this.symbols.get(name);
        if (previous && (previous === 'const' || kind === 'const')) throw new Error('Constant redeclaration');
        this.symbols.set(name, kind);
    }

    private functionSource(declaration = false): FunctionSource {
        this.take('function');
        const name = this.at('(') ? '' : this.bindingName();
        if (declaration && name) this.declare(name, 'variable');
        const parameters = this.parameters();
        const head = `function${name ? ' ' + name : ''}(${parameters.items.join(', ')})`;
        return { kind: 'function', head, body: this.functionBody(parameters) };
    }

    private functionBody(parameters: ParameterList): Block {
        return this.inFunction(parameters, () => this.block(true));
    }

    private inFunction<T>(parameters: ParameterList, parse: () => T): T {
        // The packaged Rhino parser starts each function body with a new directive prologue.
        const { loopDepth, switchDepth, labels, strict, symbols } = this;
        this.loopDepth = this.switchDepth = 0;
        this.labels = [];
        this.strict = false;
        this.symbols = new Map(parameters.names.map(name => [name, 'variable']));
        this.functionDepth++;
        try { return parse(); }
        finally {
            this.functionDepth--;
            this.loopDepth = loopDepth;
            this.switchDepth = switchDepth;
            this.labels = labels;
            this.strict = strict;
            this.symbols = symbols;
        }
    }

    private block(functionBody = false): Block {
        this.take('{', false);
        const body = this.statementList('}', functionBody);
        this.take('}', false);
        return { kind: 'block', body };
    }

    private statementList(end: string, scriptOrFunction: boolean, path?: PathLeaf[]): Statement[] {
        const body: Statement[] = [];
        let directives = scriptOrFunction;
        while (!this.at(end)) {
            const token = this.token;
            const statement = scriptOrFunction && this.at('function') ? { ...this.functionSource(true), statement: true }
                : this.statement(body.length ? undefined : path);
            body.push(statement);
            if (directives && statement.kind !== 'comment' && statement.kind !== 'function') {
                directives = !!token.literal && stringQuote.test(token.value) && statement.kind === 'simple'
                    && statement.source === token.value + ';';
                if (directives && token.value.slice(1, -1) === 'use strict') this.strict = true;
            }
        }
        return body;
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
            const destructuring = this.at('[') || this.at('{');
            let variable = this.binding();
            if (!destructuring) this.declare(variable, kind === 'const' ? 'const' : 'variable');
            if (this.token.value === '=') { this.next(); variable += ` = ${this.expression(2, allowIn)}`; }
            else if (destructuring && allowIn) throw new Error('Missing initializer in destructuring declaration');
            declarations.push(variable);
            if (this.token.value !== ',') break;
            this.next();
        } while (true);
        if (!allowIn && this.at('in') && declarations.length > 1) throw new Error('Multiple variables in for-in declaration');
        return `${kind} ${declarations.join(', ')}`;
    }

    // Statements form a separate grammar from expressions. Keep their shape
    // until rendering: a block, loop or catch clause cannot acquire a stray
    // semicolon or lose its body through expression formatting.
    private statement(path?: PathLeaf[]): Statement {
        if (this.token.comment) return { kind: 'comment', comment: this.comment() };
        const line = this.token.line;
        const statement = this.statementCore(path);
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

    private statementCore(path?: PathLeaf[]): Statement {
        const start = this.token.value;
        const consecutiveLabel = this.consecutiveLabel;
        this.consecutiveLabel = false;
        if (start === '{') return this.block();
        if (start === 'function') return this.functionSource(true);
        if (start === 'default') {
            // Rhino parses this E4X statement, but its UnaryExpression.toSource
            // cannot print DEFAULTNAMESPACE. Only a visited XmlElemRef asks for it.
            this.next();
            this.take('xml');
            this.take('namespace');
            this.take('=');
            const source = 'default xml namespace = ' + this.expression() + ';';
            this.semicolon();
            this.namespaceStatements++;
            return { kind: 'simple', source };
        }
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
            if (start === 'with' && this.strict) throw new Error('With statement in strict code');
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
                : this.at('var') ? this.declaration(false) : this.expression(1, false);
            let head = `for (${initializer}`;
            if (this.token.value === 'in') {
                this.next(); head = `for${each ? ' each' : ''} (${initializer} in ${this.expression()})`;
            } else {
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
                let binding = this.bindingName();
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
        const expression = this.expression(1, true, path);
        if (this.token.value === ':' && expression === label) {
            if (path) path.length = 0;
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

/** getExpressionParts falls back to the complete source when the visitor has no parts. */
export function readExpressionParts(text: string, mode: PathMode = 'substitution'): ExpressionPart[] {
    try {
        const parts = new RhinoSourceReader(text, mode).expressionParts();
        if (parts.length) return parts;
    } catch { /* Rhino also preserves the original expression on a parse error. */ }
    return isJavaBlank(text) ? [] : [{ value: text, propertyName: text }];
}
