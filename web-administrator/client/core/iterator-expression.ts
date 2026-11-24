/* Source boundaries for iterator editing. Each editable operand is a complete
 * member chain. Computed selectors and call arguments own their nested brackets.
 * The reader keeps their source and never evaluates or prints JavaScript.
 */
import { isJavaBlank } from './oie.js';

type ExpressionPart = { value: string; propertyName: string; numberLiteral?: boolean };
type MemberBoundary = { end: number; key?: string; numeric?: boolean; call?: boolean; regexArgument?: boolean; signedArgument?: boolean };
type Leaf = ExpressionPart & { name?: boolean };
type Token = { value: string; start: number; end: number };

const identifier = /^[\p{L}\p{Nl}\p{Sc}\p{Pc}][\p{L}\p{Nl}\p{Sc}\p{Pc}\p{Mn}\p{Mc}\p{Nd}]*$/u;
const keywords = new Set(('break case catch const continue debugger default delete do else finally for function if in instanceof '
    + 'new return switch throw try typeof var void while with true false null this '
    + 'await class enum export extends import let super yield').split(' '));
const integer = /^(?:0|[1-9]\d*)$/;
const quoted = /^['"`]/;
// Scan a regex only in argument position. Brackets, commas and parentheses
// inside it belong to the pattern, even when they resemble member boundaries.
const regexArgument = /\/((?:\\[^\r\n\u2028\u2029]|\[(?:\\[^\r\n\u2028\u2029]|[^\\\]\r\n\u2028\u2029])*\]|[^/\\[\r\n\u2028\u2029])+)\/([a-zA-Z]*)/y;
const lexeme = /\/\/[^\r\n\u2028\u2029]*|\/\*[\s\S]*?\*\/|\s+|[$_\p{ID_Start}][$\p{ID_Continue}]*|[0-9]+|'(?:\\[^\r\n\u2028\u2029]|[^'\\\r\n\u2028\u2029])*'|"(?:\\[^\r\n\u2028\u2029]|[^"\\\r\n\u2028\u2029])*"|`(?:\\[^\r\n\u2028\u2029]|[^`\\\r\n\u2028\u2029])*`|::|\|\||\.\.\.|\.\.|[.()[\]*@,;{}=+!%|&^~:>?-]/uy;

function tokensOf(text: string, skipComments = false, allowRegexArguments = false): Token[] | null {
    // Rhino can ignore format controls in token spellings and in string escapes.
    if (/[\p{Cf}\u0000-\u0008\u000e-\u001b\u007f-\u009f]/u.test(text)) return null;
    const tokens: Token[] = [];
    for (let start = 0; start < text.length;) {
        lexeme.lastIndex = start;
        const match = lexeme.exec(text);
        if (!match) {
            const previous = tokens.at(-1)?.value;
            if (!allowRegexArguments || text[start] !== '/' || (previous !== '(' && previous !== ',')) return null;
            regexArgument.lastIndex = start;
            const literal = regexArgument.exec(text);
            if (!literal || !/^[gim]*$/.test(literal[2])) return null;
            try { new RegExp(literal[1], literal[2]); } catch { return null; }
            const end = regexArgument.lastIndex;
            tokens.push({ value: literal[0], start, end });
            start = end;
            continue;
        }
        const value = match[0];
        const end = lexeme.lastIndex;
        if (value.startsWith('`') && value.includes('${')) return null;
        if (value.startsWith('/')) {
            if (!skipComments) return null;
        } else if (value.trim()) tokens.push({ value, start, end });
        start = end;
    }
    return tokens;
}

function isName(value: string): boolean {
    return identifier.test(value) && !keywords.has(value) && !/[\uD800-\uDFFF]/.test(value);
}

// Rhino ES6 accepts radix prefixes and legacy octal. A leading-zero integer
// containing 8 or 9 is decimal; an octal integer cannot take a fraction or exponent.
const fallbackNumber = /^(?:0x[\da-f]+|0b[01]+|0o[0-7]+|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)$/i;

function isFallbackConstant(source: string): boolean {
    let signed = false;
    for (;;) {
        if (source.startsWith('(') && source.endsWith(')')) source = source.slice(1, -1).trim();
        else if (/^(?!\+\+|--)[+-]/.test(source)) {
            signed = true;
            source = source.slice(1).trimStart();
        } else break;
    }
    if (!signed && ['true', 'false', 'null'].includes(source)) return true;
    return fallbackNumber.test(source) && !/^0[0-7]+[.e]/i.test(source);
}

function readChain(text: string, preview: boolean, allowFallback = false) {
    const scanned = tokensOf(text, false, !preview);
    if (!scanned?.length || !isName(scanned[0].value)) return null;
    const tokens = scanned;
    let at = 0;
    const peek = () => tokens[at]?.value ?? '';
    const end = () => tokens[at - 1].end;
    const source = (first: number) => text.slice(tokens[first].start, end());
    const take = (value: string) => {
        if (peek() !== value) return false;
        at++;
        return true;
    };
    const expect = (...values: string[]) => {
        for (const value of values) if (!take(value)) throw new Error('Incomplete selector');
    };
    function nameOrWildcard(allowKeyword = false): string {
        if (peek() !== '*' && !isName(peek()) && !(allowKeyword && keywords.has(peek()))) throw new Error('Expected property');
        return tokens[at++].value;
    }

    function argumentsList() {
        if (take(')')) return;
        do {
            if (peek().startsWith('/')) at++;
            else if (!preview && ['-', '+'].includes(peek())) {
                const start = tokens[at++].end;
                while (at < tokens.length && ![',', ')'].includes(peek())) at++;
                const literal = text.slice(start, end()).trim();
                if (!fallbackNumber.test(literal) || /^0[0-7]+[.e]/i.test(literal)) throw new Error('Invalid signed number');
            }
            else operand();
        } while (take(','));
        expect(')');
    }

    // A call, parenthesized expression or constructor is opaque to Swing's
    // NodeVisitor. Accesses on its result can still contribute later leaves.
    function operand(): Leaf[] {
        const leaves: Leaf[] = [];
        if (take('new')) {
            expect('QName', '(');
            argumentsList();
            return leaves;
        }
        if (take('(')) {
            if (take('function')) {
                // Saved multiline constant selectors use this literal-return form.
                expect('(', ')', '{', 'return');
                if (!quoted.test(peek()) || /[\r\n\u2028\u2029]/.test(text.slice(end(), tokens[at].start))) {
                    throw new Error('Expected literal return value');
                }
                at++;
                take(';');
                expect('}');
            } else operand();
            expect(')');
        } else if (quoted.test(peek()) || integer.test(peek())) {
            const key = tokens[at++].value;
            // Swing quotes the spelling of a backtick key again in createSegment.
            if (preview && key.startsWith('`') && /[^ -~]|\\/.test(key)) throw new Error('Opaque backtick key');
            return [{ value: '[' + key + ']', propertyName: key, numberLiteral: integer.test(key) }];
        } else if (isName(peek())) {
            const key = tokens[at++].value;
            leaves.push({ value: '[' + key + ']', propertyName: key, name: true });
        } else throw new Error('Unsupported computed key');
        members(leaves);
        return leaves;
    }

    function members(leaves: Leaf[], boundaries?: MemberBoundary[]) {
        let receiver: Leaf | undefined = leaves[0];
        for (;;) {
            if (take('(')) {
                const first = at;
                argumentsList();
                leaves.length = 0;
                const call: MemberBoundary = { end: end(), call: true };
                if (boundaries) {
                    const args = tokens.slice(first, at);
                    if (args.some(token => token.value.startsWith('/'))) call.regexArgument = true;
                    if (args.some(token => token.value === '-' || token.value === '+')) call.signedArgument = true;
                }
                boundaries?.push(call);
            } else if (take('[')) {
                const first = at;
                let keyLeaves = operand();
                // A binary expression in a regular bracket has no visited
                // leaves. Recognize simple operators for the preview only.
                while (preview && ['+', '-', '*', '%', '&', '|', '^', '>'].includes(peek())) {
                    at++;
                    operand();
                    keyLeaves = [];
                }
                const simple = at === first + 1;
                const key = tokens[first].value;
                expect(']');
                leaves.push(...keyLeaves);
                boundaries?.push({ end: end(), key: simple && isName(key) ? key : undefined, numeric: simple && integer.test(key) });
            } else if (peek() === '.' || peek() === '..') {
                const descendant = tokens[at++].value === '..';
                const refStart = at;
                const attribute = take('@');
                let property = '';
                if (!attribute || peek() !== '[') property = nameOrWildcard(!attribute);
                const qualified = take('::');
                if (qualified || (attribute && !property)) {
                    if (take('[')) {
                        const first = at;
                        operand();
                        property = source(first);
                        // In createSegment this text can become a literal XML name.
                        // Only use compound keys whose Rhino toSource spelling is known.
                        if (preview && at > first + 1 && !canonicalXmlKey(property)) {
                            throw new Error('Opaque computed XML name');
                        }
                        expect(']');
                    } else property = nameOrWildcard();
                }
                const plain = !descendant && !attribute && !qualified;
                if (plain && receiver?.name) receiver.value = '.' + receiver.propertyName;
                leaves.push({ value: '.' + source(refStart), propertyName: property, name: plain });
                boundaries?.push({ end: end() });
            } else return;
            receiver = undefined;
        }
    }

    const root = tokens[at++].value;
    const boundaries: MemberBoundary[] = [{ end: end() }];
    const leaves: Leaf[] = [{ value: root, propertyName: root, name: true }];
    try {
        members(leaves, boundaries);
        // Stock Swing retains the sample selector when the member chain has
        // a fallback. Only its leading operand supplies Iterator boundaries.
        while (allowFallback && take('||')) {
            if (at === tokens.length) return null;
            let stop = at + 1;
            while (stop < tokens.length && tokens[stop].value !== '||') stop++;
            // Use the original spelling to distinguish 1e3 from a malformed
            // "1 e3". Numeric selectors and Message Builder still use integer.
            if (isFallbackConstant(text.slice(tokens[at].start, tokens[stop - 1].end))) at = stop;
            else operand();
        }
        return at === tokens.length ? { boundaries, leaves } : null;
    } catch {
        return null;
    }
}

function canonicalXmlKey(source: string): boolean {
    if (/^[$\w]+(?:\.[$\w]+|\[[$\w]+\])*$/.test(source)) return true;
    // Tree-generated qualified attributes use exactly this constructor form.
    return /^[ -~]+$/.test(source) && /^new QName\('(?:\\['\\]|[^'\\])*', '(?:\\['\\]|[^'\\])*'\)$/.test(source);
}

/** Shipped Message Builder path components, or null when the initializer cannot be reproduced. */
export function readMessageBuilderParts(text: string): ExpressionPart[] | null {
    if (isJavaBlank(text)) return [];
    const chain = readChain(text, true);
    if (!chain) return null;
    // Swing begins collecting at the first Name, even after an ignored call.
    const first = chain.leaves.findIndex(leaf => leaf.name);
    if (first < 0) return [];
    return chain.leaves.slice(first).map(({ value, propertyName, numberLiteral }, index) => (
        numberLiteral ? { value, propertyName, numberLiteral } : { value: index ? value : propertyName, propertyName }
    ));
}

/** Offsets into the original member chain. An allowed fallback must parse in full. */
export function readMemberBoundaries(text: string, allowFallback = false): MemberBoundary[] {
    return readChain(text, false, allowFallback)?.boundaries ?? [];
}

function isReference(tokens: Token[], index: number): boolean {
    return tokens[index + 1]?.value === '::' || !['.', '..', '::', '@'].includes(tokens[index - 1]?.value);
}

/** Names to reserve when choosing a fresh loop index for authored JavaScript. */
export function iteratorIdentifierNames(source: string): string[] {
    const tokens = tokensOf(source, true);
    if (tokens && !tokens.some(token => token.value === 'eval')) {
        return tokens.filter((token, index) => isName(token.value) && isReference(tokens, index)).map(token => token.value);
    }
    // With opaque syntax (e.g. interpolated templates), reserve even ambiguous spellings.
    const text = source.replace(/\\u([\da-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\p{Cf}/gu, '');
    return text.match(/[$_\p{ID_Start}][$\p{ID_Continue}]*/gu) ?? [];
}

/** Unknown lexical syntax vetoes a rename because it can hide an index reference. */
export function referencesIteratorIdentifier(text: string, name: string): boolean {
    const tokens = tokensOf(text, true);
    if (!tokens || tokens.some(token => token.value === 'eval')) return true;
    return tokens.some(({ value }, index) => value === name && isReference(tokens, index));
}
