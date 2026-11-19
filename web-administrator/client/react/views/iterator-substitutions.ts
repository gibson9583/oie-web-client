/* Swing IteratorUtil / FilterTransformerTypePlugin authoring substitutions.
 * These edit stored expressions; the engine uses them literally at runtime.
 * Only the shipped expression fields participate, never arbitrary script text.
 */

import { readExpressionParts } from '../../core/iterator-expression.js';
import { arrayToElements, isIteratorType, isJavaBlank } from '../../core/oie.js';
import { REPLACEMENT_PAIR } from '../../core/step-replacements.js';

type Element = Record<string, any>;

export function childrenOf(element: Element): Element[] {
    return element.__children ??= [];
}

/** Write the editor's hydrated children back in Swing's execution order. */
export function serializeEditorElements(list: Parameters<typeof arrayToElements>[0], parentPosition = ''): ReturnType<typeof arrayToElements> {
    const wire = arrayToElements(list);
    if (!wire) return null;
    // The release converter reads the digits as a Java int. Deeply nested
    // positions can use local sibling indices if the full path would overflow.
    const lastPosition = parentPosition.replaceAll('-', '') + (list.length - 1);
    const prefix = parentPosition && Number(lastPosition) <= 2_147_483_647 ? parentPosition + '-' : '';
    for (const [type, siblings] of Object.entries(wire)) {
        for (const element of siblings) {
            element.sequenceNumber = prefix + element.sequenceNumber;
            if (isIteratorType(type) && Array.isArray(element.__children)) {
                element.properties = { ...element.properties, children: serializeEditorElements(element.__children, element.sequenceNumber) ?? '' };
                delete element.__children;
            }
        }
    }
    return wire;
}

function elementType(element: Element): string {
    return element.__type || element['@class'] || '';
}

function strings(value: any): string[] {
    const list = value?.string ?? value;
    if (list == null || value === '') return [];
    return (Array.isArray(list) ? list : [list]).map(item => String(item ?? ''));
}

const stringSuffix = '.toString()';

function withoutStringSuffix(expression: string): string {
    return expression.endsWith(stringSuffix) ? expression.slice(0, -stringSuffix.length) : expression;
}

export function removeNumberLiterals(expression: string): string {
    if (typeof expression !== 'string') return expression;
    const body = withoutStringSuffix(expression);
    return readExpressionParts(body).map(part => part.value).join('') + expression.slice(body.length);
}

function wizardComponents(expression: string) {
    let prefix = '';
    return readExpressionParts(expression).map(({ value, propertyName }) => {
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
            if (iterator === selected || !isIteratorType(elementType(iterator))) continue;
            for (const prefix of strings(iterator.properties?.prefixSubstitutions)) {
                if (target.startsWith(prefix)) {
                    if (depth > maxDepth) { preferred = iterator; maxDepth = depth; }
                    visit(childrenOf(iterator), prefix + `[${iterator.properties?.indexVariable}]` + target.slice(prefix.length), depth + 1);
                }
            }
        }
    };
    visit(iterators, expression, 0);
    return preferred;
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
    const list = value[REPLACEMENT_PAIR] ?? value.entry ?? value;
    const rewriteValue = (value: any) => {
        if (!value || typeof value !== 'object' || !Object.hasOwn(value, '$')) return rewrite(value);
        value.$ = rewrite(value.$);
        return value;
    };
    const pairs = Array.isArray(list) ? list : [list];
    for (const pair of pairs) {
        if (Array.isArray(pair)) {
            pair[0] = rewriteValue(pair[0]);
            pair[1] = rewriteValue(pair[1]);
        } else if (pair && typeof pair === 'object') {
            const keys = Object.hasOwn(pair, 'left') ? ['left', 'right']
                : Object.hasOwn(pair, 'key') ? ['key', 'value']
                : Object.hasOwn(pair, 'first') ? ['first', 'second'] : [];
            for (const key of keys) pair[key] = rewriteValue(pair[key]);
            if (Array.isArray(pair.string)) pair.string = pair.string.map(rewriteValue);
        }
    }
}

/** Mutates the live element tree just as the editor's other model operations do. */
export function rewriteElementIteratorVariables(element: Element, ancestors: Element[], replace: boolean): void {
    const type = elementType(element);
    const iterator = isIteratorType(type);
    const childAncestors = iterator ? [...ancestors, element] : ancestors;
    if (iterator && !replace) for (const child of childrenOf(element)) rewriteElementIteratorVariables(child, childAncestors, false);
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
        if (replace) for (const child of childrenOf(element)) rewriteElementIteratorVariables(child, childAncestors, true);
    }
}

export function getIteratorInfo(element: Element): { target: string; outbound: string | null } {
    const type = elementType(element);
    // JSON imports can supply primitives even when the release model declares a String.
    const text = (value: unknown) => String(value ?? '');
    if (isIteratorType(type)) return { target: text(element.properties?.target), outbound: null };
    if (type === 'com.mirth.connect.plugins.mapper.MapperStep') return { target: text(element.mapping), outbound: null };
    if (type === 'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep') {
        const mapping = text(element.mapping);
        const segment = text(element.messageSegment);
        return isJavaBlank(mapping) ? { target: segment, outbound: null } : { target: mapping, outbound: segment };
    }
    if (type === 'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule' || type === 'com.mirth.connect.plugins.destinationsetfilter.DestinationSetFilterStep') return { target: text(element.field), outbound: null };
    if (type === 'com.mirth.connect.plugins.xsltstep.XsltStep') return { target: text(element.sourceXml), outbound: null };
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
    if (isIteratorType(type)) element.properties.target = target;
    else if (type === 'com.mirth.connect.plugins.mapper.MapperStep') element.mapping = target;
    else if (type === 'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep') {
        if (isJavaBlank(outbound)) element.messageSegment = target;
        else { element.messageSegment = outbound; element.mapping = target; }
    } else if (type === 'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule' || type === 'com.mirth.connect.plugins.destinationsetfilter.DestinationSetFilterStep') element.field = target;
    // XSLT has getIteratorInfo but deliberately inherits the no-op setter.
}
