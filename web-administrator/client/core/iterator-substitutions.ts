/* Swing IteratorUtil / FilterTransformerTypePlugin authoring substitutions.
 * These edit stored expressions; the engine uses them literally at runtime.
 * Only the shipped expression fields participate, never arbitrary script text.
 */

type Element = Record<string, any>;

const ITERATOR_TYPES = new Set(['com.mirth.connect.model.IteratorStep', 'com.mirth.connect.model.IteratorRule']);
// Rhino uses Java identifier character categories, including currency symbols.
const name = '[\\p{L}\\p{Nl}\\p{Sc}\\p{Pc}][\\p{L}\\p{Nl}\\p{Sc}\\p{Pc}\\p{Mn}\\p{Mc}\\p{Nd}\\p{Cf}]*';
const identifier = new RegExp('^' + name, 'u');
const identifierOnly = new RegExp('^' + name + '$', 'u');
const propertyAccess = new RegExp('^(\\.{1,2})(@?(?:(?:' + name + '|\\*)::)?(?:' + name + '|\\*))', 'u');
const keywordLiterals = new Set(['true', 'false', 'null', 'this']);
const numericLiteral = /^(?:0[xX][\da-fA-F]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/;

function elementType(element: Element): string {
    return element.__type || element['@class'] || '';
}

function strings(value: any): string[] {
    const list = value?.string ?? value;
    if (list == null || value === '') return [];
    return (Array.isArray(list) ? list : [list]).map(item => String(item ?? ''));
}

function lexicalText(expression: string): string | null {
    let text = '';
    for (let index = 0; index < expression.length; index++) {
        const ch = expression[index];
        if (ch === '"' || ch === "'") {
            const quote = ch;
            text += ch;
            while (++index < expression.length) {
                text += expression[index];
                if (expression[index] === '\\' && index + 1 < expression.length) text += expression[++index];
                else if (expression[index] === quote) break;
            }
            if (expression[index] !== quote) return null;
        } else if (ch === '/' && expression[index + 1] === '*') {
            const end = expression.indexOf('*/', index + 2);
            if (end < 0) return null;
            text += ' '; index = end + 1;
        } else if (ch === '/' && expression[index + 1] === '/') {
            while (index + 1 < expression.length && !/[\n\r\u2028\u2029]/.test(expression[index + 1])) index++;
            text += ' ';
        } else if (ch === '\\' && expression[index + 1] === 'u') {
            const hex = expression.slice(index + 2, index + 6);
            if (!/^[\da-f]{4}$/i.test(hex)) return null;
            text += String.fromCharCode(parseInt(hex, 16)); index += 5;
        } else text += ch;
    }
    return text;
}

/* A member-expression reader, rather than a global [number] replacement: a
 * quoted key containing "[0]", a binary expression, a call or arbitrary code
 * must not have its source edited as though it were a tree path. Rhino's
 * ExpressionVisitor follows member chains and leaves other roots intact.
 */
function expressionParts(expression: string): { value: string; numeric?: boolean }[] | null {
    const lexical = lexicalText(expression);
    if (lexical == null) return null;
    let text = lexical.trim();
    const start = identifier.exec(text);
    if (!start) return null;
    const parts: { value: string; numeric?: boolean }[] = [{ value: start[0] }];
    text = text.slice(start[0].length);
    while (text.trim()) {
        text = text.trimStart();
        if (text[0] === '.') {
            const property = propertyAccess.exec(text);
            if (!property) return null;
            // Rhino's XmlPropRef.toSource drops the descendant-access dot;
            // JavaScriptSharedUtil prefixes the resulting property with '.'.
            parts.push({ value: '.' + property[2] });
            text = text.slice(property[0].length);
        } else if (text[0] === '[') {
            let index = 1;
            let depth = 1;
            let quote = '';
            for (; index < text.length && depth; index++) {
                const ch = text[index];
                if (quote) {
                    if (ch === '\\') index++;
                    else if (ch === quote) quote = '';
                } else if (ch === '"' || ch === "'") quote = ch;
                else if (ch === '[') depth++;
                else if (ch === ']') depth--;
            }
            if (depth || quote) return null;
            const key = text.slice(1, index - 1).trim();
            // Default Rhino Parser does not accept binary/octal ES6 literal
            // syntax; its parse failure returns the entire original source.
            if (/^0[bBoO][\da-f]/.test(key)) return null;
            const quoted = /^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/.test(key);
            if (quoted || (identifierOnly.test(key) && !keywordLiterals.has(key)) || numericLiteral.test(key)) {
                parts.push({ value: `[${key}]`, numeric: numericLiteral.test(key) });
            }
            // The Rhino visitor ignores unsupported subexpressions in the
            // index while continuing along the member chain.
            text = text.slice(index);
        } else return null;
    }
    return parts;
}

export function removeNumberLiterals(expression: string): string {
    if (typeof expression !== 'string') return expression;
    const suffix = expression.endsWith('.toString()') ? '.toString()' : '';
    const body = suffix ? expression.slice(0, -suffix.length) : expression;
    const parts = expressionParts(body);
    return parts ? parts.filter(part => !part.numeric).map(part => part.value).join('') + suffix : expression;
}

/** Cumulative member prefixes offered by the iterator creation dialog. */
export function iteratorExpressionParts(expression: string): string[] {
    const text = removeNumberLiterals(expression);
    const body = text.endsWith('.toString()') ? text.slice(0, -'.toString()'.length) : text;
    const parts = expressionParts(body);
    if (!parts) return body.trim() ? [body] : [];
    let prefix = '';
    return parts.map(part => (prefix += part.value));
}

function rewriteExpression(expression: any, ancestors: Element[], replace: boolean): any {
    if (typeof expression !== 'string' || !expression.trim()) return expression;
    const iterators = replace ? ancestors : [...ancestors].reverse();
    for (const iterator of iterators) {
        const props = iterator.properties || {};
        const index = `[${props.indexVariable ?? 'i'}]`;
        for (const prefix of strings(props.prefixSubstitutions)) {
            if (replace) {
                if (expression.startsWith(prefix) && !expression.startsWith(prefix + index)) {
                    const suffix = removeNumberLiterals('msg' + expression.slice(prefix.length)).slice(3);
                    expression = prefix + index + suffix;
                }
            } else if (expression.startsWith(prefix + index)) {
                expression = prefix + expression.slice(prefix.length + index.length);
            }
        }
    }
    return expression;
}

function rewriteStringList(holder: Element, field: string, rewrite: (value: any) => any) {
    const value = holder[field];
    if (Array.isArray(value)) holder[field] = value.map(rewrite);
    else if (value && typeof value === 'object' && Object.hasOwn(value, 'string')) {
        value.string = Array.isArray(value.string) ? value.string.map(rewrite) : rewrite(value.string);
    }
}

function rewriteReplacements(element: Element, rewrite: (value: any) => any) {
    // Preserve the imported representation and unfinished rows. In particular,
    // rewriting an unrelated field must not drop a replacement expression.
    const value = element.replacements;
    if (!value) return;
    const list = value['org.apache.commons.lang3.tuple.ImmutablePair'] ?? value.entry ?? value;
    const rewriteValue = (value: any) => {
        if (value && typeof value === 'object' && Object.hasOwn(value, '$')) value.$ = rewrite(value.$);
        else return rewrite(value);
        return value;
    };
    const pairs = Array.isArray(list) ? list : [list];
    for (const pair of pairs) {
        if (Array.isArray(pair)) {
            pair[0] = rewriteValue(pair[0]); pair[1] = rewriteValue(pair[1]);
        } else if (pair && typeof pair === 'object') {
            const keys = Object.hasOwn(pair, 'left') ? ['left', 'right']
                : Object.hasOwn(pair, 'key') ? ['key', 'value']
                : Object.hasOwn(pair, 'first') ? ['first', 'second'] : [];
            for (const key of keys) pair[key] = rewriteValue(pair[key]);
            if (Array.isArray(pair.string)) pair.string = pair.string.map(rewriteValue);
        }
    }
}

function children(element: Element): Element[] {
    if (Array.isArray(element.__children)) return element.__children;
    const wire = element.properties?.children;
    if (Array.isArray(wire)) return wire;
    if (!wire || typeof wire !== 'object') return [];
    const result: Element[] = [];
    for (const [type, values] of Object.entries(wire)) {
        for (const child of Array.isArray(values) ? values : [values]) {
            if (child && typeof child === 'object') {
                // Keep the wire shape intact; type is supplied separately by
                // elementsToArray when this is hydrated in the editor.
                if (!elementType(child)) Object.defineProperty(child, '__type', { value: type, configurable: true });
                result.push(child);
            }
        }
    }
    return result;
}

/** Mutates the live element tree just as the editor's other model operations do. */
export function rewriteElementIteratorVariables(element: Element, ancestors: Element[], replace: boolean): void {
    const type = elementType(element);
    const iterator = ITERATOR_TYPES.has(type);
    const childAncestors = iterator ? [...ancestors, element] : ancestors;
    if (iterator && !replace) for (const child of children(element)) rewriteElementIteratorVariables(child, childAncestors, false);
    const rewrite = (value: any) => rewriteExpression(value, ancestors, replace);
    let fields: string[] = [];
    if (type === 'com.mirth.connect.plugins.mapper.MapperStep') fields = ['mapping', 'defaultValue'];
    else if (type === 'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep') fields = ['messageSegment', 'mapping', 'defaultValue'];
    else if (type === 'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule' || type === 'com.mirth.connect.plugins.destinationsetfilter.DestinationSetFilterStep') {
        fields = ['field']; rewriteStringList(element, 'values', rewrite);
    } else if (type === 'com.mirth.connect.plugins.xsltstep.XsltStep') fields = ['sourceXml'];
    for (const field of fields) if (Object.hasOwn(element, field)) element[field] = rewrite(element[field]);
    if (type === 'com.mirth.connect.plugins.mapper.MapperStep' || type === 'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep') rewriteReplacements(element, rewrite);
    if (iterator) {
        const props = element.properties || {};
        if (Object.hasOwn(props, 'target')) props.target = rewrite(props.target);
        rewriteStringList(props, 'prefixSubstitutions', rewrite);
        if (replace) for (const child of children(element)) rewriteElementIteratorVariables(child, childAncestors, true);
    }
}

export function getIteratorInfo(element: Element): { target: string; outbound: string | null } {
    const type = elementType(element);
    if (ITERATOR_TYPES.has(type)) return { target: element.properties?.target || '', outbound: null };
    if (type === 'com.mirth.connect.plugins.mapper.MapperStep') return { target: element.mapping || '', outbound: null };
    if (type === 'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep') {
        return element.mapping?.trim() ? { target: element.mapping, outbound: element.messageSegment || '' }
            : { target: element.messageSegment || '', outbound: null };
    }
    if (type === 'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule' || type === 'com.mirth.connect.plugins.destinationsetfilter.DestinationSetFilterStep') return { target: element.field || '', outbound: null };
    if (type === 'com.mirth.connect.plugins.xsltstep.XsltStep') return { target: element.sourceXml || '', outbound: null };
    return { target: '', outbound: null };
}

/** Swing normalizes the primary iterator input on Assign, independently of the auxiliary fields. */
export function normalizeIteratorTarget(element: Element): void {
    const type = elementType(element);
    const info = getIteratorInfo(element);
    const target = removeNumberLiterals(info.target);
    const outbound = info.outbound == null ? null : removeNumberLiterals(info.outbound);
    if (ITERATOR_TYPES.has(type)) element.properties.target = target;
    else if (type === 'com.mirth.connect.plugins.mapper.MapperStep') element.mapping = target;
    else if (type === 'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep') {
        if (!outbound?.trim()) element.messageSegment = target;
        else { element.messageSegment = outbound; element.mapping = target; }
    } else if (type === 'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule' || type === 'com.mirth.connect.plugins.destinationsetfilter.DestinationSetFilterStep') element.field = target;
    // XSLT has getIteratorInfo but deliberately inherits the no-op setter.
}
