/* Swing IteratorUtil / FilterTransformerTypePlugin authoring substitutions.
 * These edit stored expressions; the engine uses them literally at runtime.
 * Only the shipped expression fields participate, never arbitrary script text.
 */

import { isJavaBlank, readExpressionParts } from './rhino-key-source.js';

type Element = Record<string, any>;

const ITERATOR_TYPES = new Set(['com.mirth.connect.model.IteratorStep', 'com.mirth.connect.model.IteratorRule']);
function elementType(element: Element): string {
    return element.__type || element['@class'] || '';
}

function strings(value: any): string[] {
    const list = value?.string ?? value;
    if (list == null || value === '') return [];
    return (Array.isArray(list) ? list : [list]).map(item => String(item ?? ''));
}

// Rhino StringLiteral.toSource decodes JavaScript escapes, then prints the
// original quote style with ASCII escapes. Keep this limited to literal keys;
// no user expression is evaluated.
function stringLiteralSource(literal: string): string | null {
    const quote = literal[0];
    const escapes: Record<string, string> = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };
    let value = '';
    for (let index = 1; index < literal.length - 1; index++) {
        let ch = literal[index];
        if (ch === '\\') {
            while (literal[index + 1] && literal[index + 1] !== '\ufeff' && /\p{Cf}/u.test(literal[index + 1])) index++;
            ch = literal[++index];
            if (Object.hasOwn(escapes, ch)) value += escapes[ch];
            else if (ch === 'u' || ch === 'x') {
                const size = ch === 'u' ? 4 : 2;
                const hex = literal.slice(index + 1, index + 1 + size);
                if (hex.length !== size || !/^[\da-f]+$/i.test(hex)) return null;
                value += String.fromCharCode(parseInt(hex, 16));
                index += size;
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
    let source = quote;
    for (let index = 0; index < value.length; index++) {
        const ch = value[index];
        const code = value.charCodeAt(index);
        const escape = Object.keys(escapes).find(key => escapes[key] === ch);
        if (escape) source += '\\' + escape;
        else if (ch === quote || ch === '\\') source += '\\' + ch;
        else if (code >= 0x20 && code <= 0x7e) source += ch;
        else source += code < 0x100 ? '\\x' + code.toString(16).padStart(2, '0') : '\\u' + code.toString(16).padStart(4, '0');
    }
    return source + quote;
}

const stringSuffix = '.toString()';

function withoutStringSuffix(expression: string): string {
    return expression.endsWith(stringSuffix) ? expression.slice(0, -stringSuffix.length) : expression;
}

export function removeNumberLiterals(expression: string): string {
    if (typeof expression !== 'string') return expression;
    const body = withoutStringSuffix(expression);
    return readExpressionParts(body, stringLiteralSource).map(part => part.value).join('') + expression.slice(body.length);
}

function wizardComponents(expression: string) {
    let prefix = '';
    return readExpressionParts(expression, stringLiteralSource).map(({ value, propertyName }) => {
        prefix += value;
        return { value: prefix, propertyName };
    });
}

/** Cumulative member prefixes offered by the iterator creation dialog. */
export function iteratorExpressionParts(expression: string): string[] {
    return wizardComponents(withoutStringSuffix(expression)).map(part => part.value);
}

/** Swing hides a boundary immediately before an enclosing iterator's index. */
export function iteratorWizardPrefixes(expression: string, ancestorIndices: string[], field: 'target' | 'outbound' = 'target') {
    const parts = wizardComponents(field === 'target' ? withoutStringSuffix(expression) : expression);
    const isAncestorIndex = (index: number) => !!parts[index] && ancestorIndices.includes(parts[index].propertyName);
    const choices = parts.map(({ value }, index) => ({ value, index }))
        .filter(({ index }) => !isAncestorIndex(index + 1));
    let minIndex = 0;
    for (let index = parts.length - 1; index >= 0; index--) {
        if (isAncestorIndex(index)) { minIndex = index + 1; break; }
    }
    const preferred = (values: typeof choices) => values.find(choice => choice.index > 0) || values[0];
    return { root: parts[0]?.value, choices, selected: preferred(choices.filter(choice => choice.index >= minIndex)) || preferred(choices) };
}

export function validIteratorIndex(ancestorIndices: string[], descendantIndices: string[]): string {
    const used = new Set([...ancestorIndices, ...descendantIndices]);
    let index = 'i';
    while (used.has(index)) {
        const next = String.fromCharCode(index.charCodeAt(0) + 1);
        index = next > 'z' ? 'i'.repeat(index.length + 1) : next.repeat(index.length);
    }
    return index;
}

/** The first matching iterator at the greatest matched ancestor depth wins. */
export function preferredIterator(expression: string, iterators: Element[], selected?: Element): Element | null {
    expression = withoutStringSuffix(expression);
    let preferred: Element | null = null;
    let maxDepth = -1;
    const visit = (nodes: Element[], target: string, depth: number) => {
        for (const iterator of nodes) {
            if (iterator === selected || !ITERATOR_TYPES.has(elementType(iterator))) continue;
            for (const prefix of strings(iterator.properties?.prefixSubstitutions)) {
                if (target.startsWith(prefix)) {
                    if (depth > maxDepth) { preferred = iterator; maxDepth = depth; }
                    visit(children(iterator), prefix + `[${iterator.properties?.indexVariable}]` + target.slice(prefix.length), depth + 1);
                }
            }
        }
    };
    visit(iterators, expression, 0);
    return preferred;
}

export function iteratorName(element: Element): string {
    const target = element.properties?.target || '';
    return elementType(element) === 'com.mirth.connect.model.IteratorRule'
        ? `Accept message if ${element.properties?.intersectIterations ? 'all of the iterations return' : 'at least one of the iterations returns'} true for each ${target}`
        : `For each ${target}`;
}

export function rewriteIteratorExpression(expression: any, ancestors: Element[], replace: boolean): any {
    if (typeof expression !== 'string' || isJavaBlank(expression)) return expression;
    const iterators = replace ? ancestors : [...ancestors].reverse();
    for (const iterator of iterators) {
        const props = iterator.properties || {};
        const index = `[${props.indexVariable ?? 'i'}]`;
        for (const prefix of strings(props.prefixSubstitutions)) {
            if (replace) {
                if (expression.startsWith(prefix) && !expression.startsWith(prefix + index)) {
                    const suffix = removeNumberLiterals('msg' + expression.slice(prefix.length)).replace(/^msg/, '');
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
    const rewrite = (value: any) => rewriteIteratorExpression(value, ancestors, replace);
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
        return !isJavaBlank(element.mapping) ? { target: element.mapping, outbound: element.messageSegment || '' }
            : { target: element.messageSegment || '', outbound: null };
    }
    if (type === 'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule' || type === 'com.mirth.connect.plugins.destinationsetfilter.DestinationSetFilterStep') return { target: element.field || '', outbound: null };
    if (type === 'com.mirth.connect.plugins.xsltstep.XsltStep') return { target: element.sourceXml || '', outbound: null };
    return { target: '', outbound: null };
}

/** Swing normalizes the primary iterator input on Assign, independently of the auxiliary fields. */
export function normalizeIteratorTarget(element: Element, previous: Element[] = [], current: Element[] = []): void {
    const type = elementType(element);
    const info = getIteratorInfo(element);
    const normalize = (expression: string) => {
        const detached = rewriteIteratorExpression(removeNumberLiterals(expression), previous, false);
        return rewriteIteratorExpression(detached, current, true);
    };
    const target = normalize(info.target);
    const outbound = info.outbound == null ? null : normalize(info.outbound);
    if (ITERATOR_TYPES.has(type)) element.properties.target = target;
    else if (type === 'com.mirth.connect.plugins.mapper.MapperStep') element.mapping = target;
    else if (type === 'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep') {
        if (isJavaBlank(outbound)) element.messageSegment = target;
        else { element.messageSegment = outbound; element.mapping = target; }
    } else if (type === 'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule' || type === 'com.mirth.connect.plugins.destinationsetfilter.DestinationSetFilterStep') element.field = target;
    // XSLT has getIteratorInfo but deliberately inherits the no-op setter.
}
