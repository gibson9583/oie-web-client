/* Swing IteratorUtil / FilterTransformerTypePlugin authoring substitutions.
 * These edit stored expressions; the engine uses them literally at runtime.
 * Only the shipped expression fields participate, never arbitrary script text.
 */

import jsTokens from 'js-tokens';
import { ElementType, isElementEnabled } from '../../core/element-types.js';
import { iteratorIdentifierNames, readMemberBoundaries, referencesIteratorIdentifier } from '../../core/iterator-expression.js';
import { arrayToElements, isIteratorType, isJavaBlank } from '../../core/oie.js';
import { REPLACEMENT_PAIR } from '../../core/step-replacements.js';
import { generateElementScript, usesGeneratedIteratorIdentifier } from '../../core/step-script.js';

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

// Swing's Iterator panel omits blank prefixes. A null XStream list entry must
// never become an empty prefix that would match every expression.
function iteratorPrefixes(iterator: Element): string[] {
    const wire = iterator.properties?.prefixSubstitutions;
    const list = wire && typeof wire === 'object' && !Array.isArray(wire) ? wire.string : wire;
    if (list == null) return [];
    const entries = Array.isArray(list) ? list : [list];
    return entries.filter(prefix => !isJavaBlank(prefix)).map(String);
}

const stringSuffix = '.toString()';

function withoutStringSuffix(expression: string): string {
    return expression.endsWith(stringSuffix) ? expression.slice(0, -stringSuffix.length) : expression;
}

function wizardComponents(expression: string, transformer?: Element) {
    const parts = readMemberBoundaries(expression);
    if (!parts.length && completeFallback(expression)) {
        // Swing offers a compound fallback as one editable Iterator target.
        return [{ value: expression, numeric: false, callable: false, key: undefined }];
    }
    let canonical = '';
    return parts.map((part, index) => {
        const text = expression.slice(parts[index - 1]?.end ?? 0, part.end);
        // E4X selects the named child across the list. The tree sample's row
        // number should not limit a new Iterator over a deeper named field.
        const sample = part.numeric && isNamedXmlPath(canonical, transformer);
        if (!sample) canonical += text;
        return { ...part, callable: parts[index + 1]?.call, value: canonical.trimStart() };
    });
}

function completeFallback(expression: string): boolean {
    if (!expression.includes('||')) return false;
    const parts = readMemberBoundaries(expression, true);
    return !!parts.length && parts.at(-1)!.end < expression.trimEnd().length;
}

/** Cumulative member prefixes offered by the iterator creation dialog. */
export function iteratorExpressionParts(expression: string): string[] {
    return wizardComponents(withoutStringSuffix(expression)).filter(part => !part.numeric && !part.callable).map(part => part.value);
}

/** Swing hides a boundary immediately before an enclosing iterator's index. */
export function iteratorWizardPrefixes(expression: string, ancestorIndices: string[], field: 'target' | 'outbound' = 'target', transformer?: Element) {
    const parts = wizardComponents(field === 'target' ? withoutStringSuffix(expression) : expression, transformer)
        .filter(part => !part.numeric);
    const isAncestorIndex = (index: number) => !!parts[index]?.key && ancestorIndices.includes(parts[index].key!);
    const choices = parts.map(({ value }, index) => ({ value, index }))
        .filter(({ index }) => !parts[index].callable && !isAncestorIndex(index + 1));
    let minIndex = 0;
    for (let index = parts.length - 1; index >= 0; index--) {
        if (isAncestorIndex(index)) { minIndex = index + 1; break; }
    }
    const preferred = (values: typeof choices) => values.find(choice => choice.index > 0) || values[0];
    return { root: parts[0]?.value, choices, selected: preferred(choices.filter(choice => choice.index >= minIndex)) || preferred(choices) };
}

// Rhino transformer steps share one function. An independent loop can reuse
// an index, but a free reference in a sibling must keep its original binding.
export function freeIteratorScopeNames(scope: Element[], excluded?: Element): Set<string> {
    const used = new Set<string>();
    function reserve(source: string, bound: Set<string>) {
        for (const name of iteratorIdentifierNames(source)) {
            if (!bound.has(name)) used.add(name);
        }
    }
    function visit(element: Element, bound: Set<string>) {
        if (element === excluded) return;
        if (isIteratorType(elementType(element))) {
            for (const prefix of iteratorPrefixes(element)) reserve(prefix, bound);
            reserve(String(element.properties?.target ?? ''), bound);
            const nested = new Set(bound).add(element.properties?.indexVariable ?? 'i');
            for (const child of childrenOf(element)) visit(child, nested);
        } else {
            reserve(generateElementScript(element) ?? '', bound);
        }
    }
    for (const element of scope) visit(element, new Set());
    return used;
}

export function validIteratorIndex(ancestorIndices: string[], descendantIndices: string[], scope: Element[] = []): string {
    const used = freeIteratorScopeNames(scope);
    for (const index of [...ancestorIndices, ...descendantIndices]) used.add(index);
    let index = 'i';
    while (used.has(index)) {
        const next = String.fromCharCode(index.charCodeAt(0) + 1);
        index = next > 'z' ? 'i'.repeat(index.length + 1) : next.repeat(index.length);
    }
    return index;
}

/** Resolve a configured prefix only at a member boundary. */
function memberAfterPrefix(expression: string, prefix: string, transformer?: Element) {
    const exactPrefix = expression.startsWith(prefix);
    if (exactPrefix && completeFallback(prefix)) {
        const tail = expression.slice(prefix.length);
        const suffix = readMemberBoundaries('msg' + tail);
        if (suffix.length === 1 || (suffix.length === 2 && suffix[1].key)) {
            return { start: prefix.length, end: prefix.length + tail.trimEnd().length,
                key: suffix[1]?.key, numeric: false, hasFallback: false, callSuffix: false };
        }
    }
    if (!exactPrefix && !transformer) return null;
    const allowFallback = expression.includes('||') && messageChildFormat(prefix, transformer) === 'XML';
    const members = readMemberBoundaries(expression, allowFallback);
    let boundary = exactPrefix ? members.findIndex(member => member.end === prefix.length) : -1;
    // A saved Swing XML path can have [i][0] where a nested Iterator's
    // configured prefix has [i]. Both select the same E4X child.
    if (boundary < 0 && members.some(part => part.regexArgument || part.signedArgument) && messageChildFormat(prefix, transformer) === 'XML') {
        const configured = readMemberBoundaries(prefix);
        let i = 0;
        for (const [n, member] of configured.entries()) {
            const text = prefix.slice(configured[n - 1]?.end ?? 0, member.end);
            const actual = () => expression.slice(members[i - 1]?.end ?? 0, members[i]?.end);
            if (configured[n - 1]?.key && /^\[\s*0\s*\]$/.test(actual()) && actual() !== text) i++;
            if (i >= members.length || actual() !== text) return null;
            boundary = i++;
        }
    }
    if (boundary < 0 || members[boundary + 1]?.call) return null;
    const start = members[boundary].end;
    const next = members[boundary + 1] ?? { end: start };
    const hasFallback = members.at(-1)!.end < expression.trimEnd().length;
    return { ...next, start, hasFallback, callSuffix: members.slice(boundary + 1).some(part => part.regexArgument || part.signedArgument) };
}

/** The first matching iterator at the greatest matched ancestor depth wins. */
export function preferredIterator(expression: string, iterators: Element[], selected?: Element, transformer?: Element): Element | null {
    let preferred: Element | null = null;
    let maxDepth = -1;
    const visit = (nodes: Element[], target: string, depth: number) => {
        for (const iterator of nodes) {
            if (iterator === selected || !isIteratorType(elementType(iterator))) continue;
            const source = target.trimStart();
            const direct = iteratorPrefixes(iterator).some(value => {
                const prefix = value.trim();
                return memberAfterPrefix(source, prefix, transformer)
                    || memberAfterPrefix(matchXmlSamplePrefix(source, prefix, transformer) ?? '', prefix, transformer);
            });
            if (direct) {
                if (depth > maxDepth) { preferred = iterator; maxDepth = depth; }
                visit(childrenOf(iterator), rewriteIteratorExpression(target, [iterator], true, transformer), depth + 1);
            }
        }
    };
    visit(iterators, expression, 0);
    return preferred;
}

export function rewriteIteratorExpression(expression: any, ancestors: Element[], replace: boolean, transformer?: Element): any {
    if (typeof expression !== 'string' || isJavaBlank(expression)) return expression;
    const iterators = replace ? ancestors : [...ancestors].reverse();
    for (const iterator of iterators) expression = rewriteIteratorIndex(expression, iterator, replace, { transformer });
    return expression;
}

function treeMemberName(member: string): string | undefined {
    member = member.trim();
    const qualified = /^\[\s*new\s+QName\s*\(\s*(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")\s*,\s*(['"])([^'"\\]+)\1\s*\)\s*\]$/.exec(member);
    if (qualified) return qualified[2];
    const key = member.replace(/^\.\s*(?:(?:\*|[$_\p{ID_Start}][$\p{ID_Continue}]*)\s*::\s*)?/u, '');
    const literal = /^\[\s*(['"])([^'"\\]+)\1\s*\]$/.exec(key);
    if (literal) return literal[2];
    return key !== member && /^[$_\p{ID_Start}][$\p{ID_Continue}]*$/u.test(key) ? key : undefined;
}

function plainChild(member: string): boolean {
    return /^\s*(?:\[\s*['"]|\.\s*[$_\p{ID_Start}][$\p{ID_Continue}]*\s*$)/u.test(member);
}

// A named namespace can resolve to the wildcard's namespace at runtime. Only
// guard a literal path to the selected repeated ancestor; other writes can
// intentionally address a fixed field while the loop runs.
function overlapsRepeatedTreeAncestor(path: string, prefix: string): boolean {
    const members = (value: string) => readMemberBoundaries(value).map((member, i, list) =>
        ({ ...member, text: value.slice(list[i - 1]?.end ?? 0, member.end) }));
    const selected = members(path);
    const configured = members(prefix);
    if (!configured.length || configured.at(-1)?.end !== prefix.length) return false;
    let i = 0;
    let differentSelector = false;
    for (const member of configured) {
        if (selected[i]?.numeric && selected[i - 1]?.text.startsWith('.*::') && !member.numeric) i++;
        const tree = selected[i++];
        if (!tree) return false;
        if (tree.text === member.text) continue;
        const name = treeMemberName(tree.text);
        if (name === undefined || name !== treeMemberName(member.text)) return false;
        // The tree always quotes ordinary children. An authored prefix may use
        // dot notation for the same child before reaching the namespace.
        if (!tree.text.startsWith('.*::') && !(plainChild(tree.text) && plainChild(member.text))) return false;
        differentSelector = true;
    }
    // A single sample row has no numeric selector, even when production messages repeat it.
    return differentSelector;
}

export function treeWritePath(path: string, ancestors: Element[]): string | null {
    for (const iterator of ancestors) {
        const scoped = rewriteIteratorIndex(path, iterator, true);
        if (scoped === path && path.includes('.*::[')) {
            const prefixes = [...iteratorPrefixes(iterator), iterator.properties?.target];
            if (prefixes.some(prefix => typeof prefix === 'string' && overlapsRepeatedTreeAncestor(path, prefix.trim()))) return null;
        }
        path = scoped;
    }
    return path;
}

const xmlDataTypes = new Set(['XML', 'HL7V2', 'HL7V3', 'DELIMITED', 'EDI/X12', 'NCPDP', 'DICOM']);

function messageChildFormat(prefix: string, transformer?: Element): string | undefined {
    if (!transformer) return;
    const members = readMemberBoundaries(prefix);
    const root = prefix.slice(0, members[0]?.end);
    if (root !== 'msg' && root !== 'tmp') return;
    const side = root === 'msg' ? 'inbound' : 'outbound';
    const type = transformer[side + 'DataType'];
    const format = transformer[side + 'Properties']?.serializationProperties?.serializationType ?? (xmlDataTypes.has(type) ? 'XML' : type);
    for (const [i, member] of members.slice(1).entries()) {
        const selector = prefix.slice(members[i].end, member.end);
        if (plainChild(selector) || member.key || member.numeric) continue;
        if (format !== 'XML' || treeMemberName(selector) === undefined) return;
    }
    return format;
}

function isNamedXmlPath(path: string, transformer?: Element): boolean {
    return messageChildFormat(path.trimStart(), transformer) === 'XML'
        && !readMemberBoundaries(path).at(-1)?.key;
}

/** Remove only sample selectors that prevent the chosen XML prefix from matching.
 * The suffix belongs to the author's field and keeps its fixed selections. */
function matchXmlSamplePrefix(source: string, prefix: string, transformer?: Element): string | null {
    if (!isNamedXmlPath(prefix, transformer)) return null;
    const actual = readMemberBoundaries(source, true);
    const expected = readMemberBoundaries(prefix);
    let i = 0;
    let skipped = false;
    for (const [j, member] of expected.entries()) {
        const token = prefix.slice(expected[j - 1]?.end ?? 0, member.end);
        const chunk = () => source.slice(actual[i - 1]?.end ?? 0, actual[i]?.end);
        // The old binding [i][0] is already scoped. Leave its identity selector
        // to the nested call handling in memberAfterPrefix.
        if (actual[i]?.numeric && !actual[i - 1]?.key && treeMemberName(token) !== undefined) {
            i++;
            skipped = true;
        }
        if (i >= actual.length || chunk() !== token) return null;
        i++;
    }
    return skipped ? prefix + source.slice(actual[i - 1].end) : null;
}

type RewriteOptions = { rename?: string; detachedIndices?: number[]; transformer?: Element };

function rewriteIteratorIndex(expression: string, iterator: Element, insert: boolean,
    { rename, detachedIndices, transformer }: RewriteOptions = {}): string {
    const index = iterator.properties?.indexVariable ?? 'i';
    const prefixes = iteratorPrefixes(iterator).map(value => value.trim());
    const initial = expression.trimStart();
    const sorted = [...new Set(prefixes)].sort((a, b) => b.length - a.length);
    const first = sorted.find(prefix => {
        const next = memberAfterPrefix(initial, prefix, transformer);
        return next && (insert || next.key === index);
    }) ?? (insert ? sorted.find(prefix => matchXmlSamplePrefix(initial, prefix, transformer)) : undefined);
    if (first === undefined) return expression;
    const position = prefixes.indexOf(first);
    const parents = prefixes.slice(0, position).filter(prefix =>
        first.startsWith(prefix + `[${index}]`) && memberAfterPrefix(initial, prefix, transformer)?.key === index);
    // Independent prefixes keep their longest matching member. An explicitly
    // dependent path can consume the index inserted earlier on the same branch.
    // Rename from the leaf upwards while its old parent binding still matches.
    let branch = [parents[0] ?? first];
    if (rename) branch = [first, ...parents.reverse()];
    else if (insert) branch = [first, ...prefixes.slice(position + 1).filter(prefix => prefix.startsWith(first + `[${index}]`))];
    for (const prefix of branch) {
        let source = expression.trimStart();
        const leading = expression.length - source.length;
        let next = memberAfterPrefix(source, prefix, transformer);
        if (!next && insert) {
            const canonical = matchXmlSamplePrefix(source, prefix, transformer);
            if (canonical) {
                next = memberAfterPrefix(canonical, prefix, transformer);
                if (!next) continue;
                const removed = source.length - canonical.length;
                if (detachedIndices) {
                    for (let n = 0; n < detachedIndices.length; n++) {
                        if (detachedIndices[n] >= leading + prefix.length + removed) detachedIndices[n] -= removed;
                    }
                }
                expression = expression.slice(0, leading) + canonical;
                source = canonical;
            }
        }
        if (!next) continue;
        const usesIndex = next.key === index;
        if (insert && usesIndex) continue;
        if (!insert && !usesIndex) continue;
        // Detaching a JSON array row still requires a record index. Preserve
        // any following child selector, including another array subscript.
        const selectFirst = !insert && !rename && next.callSuffix && messageChildFormat(prefix, transformer) === 'JSON';
        const replacement = insert ? `[${index}]` : rename ? `[${rename}]` : selectFirst ? '[0]' : '';
        const start = leading + next.start;
        const detached = detachedIndices?.indexOf(start) ?? -1;
        // Swing retains the numeric sample for an XML fallback, so detachment
        // restores the exact selection. A regex call keeps only the E4X [0]
        // identity selector; on a JavaScript object that would read key 0.
        const keepSample = insert && next.numeric && (next.hasFallback || (next.callSuffix
            && /^\[\s*0\s*\]$/.test(source.slice(next.start, next.end)) && messageChildFormat(prefix, transformer) === 'XML'));
        const end = usesIndex || (next.numeric && detached < 0 && !keepSample) ? leading + next.end : start;
        if (detachedIndices) {
            if (insert && detached >= 0) detachedIndices.splice(detached, 1);
            const delta = start + replacement.length - end;
            for (let offset = 0; offset < detachedIndices.length; offset++) {
                if (detachedIndices[offset] >= end) detachedIndices[offset] += delta;
            }
            if (!insert && !selectFirst) detachedIndices.push(start);
        }
        expression = expression.slice(0, start) + replacement + expression.slice(end);
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

function rewriteSubtree(element: Element, rewrite: (value: any) => any): void {
    const type = elementType(element);
    const iterator = isIteratorType(type);
    let fields: string[] = [];
    if (type === ElementType.Mapper) fields = ['mapping', 'defaultValue'];
    else if (type === ElementType.MessageBuilder) fields = ['messageSegment', 'mapping', 'defaultValue'];
    else if (type === ElementType.RuleBuilder || type === ElementType.DestinationSetFilter) {
        fields = ['field']; rewriteStringList(element, 'values', rewrite);
    } else if (type === ElementType.Xslt) fields = ['sourceXml'];
    for (const field of fields) if (Object.hasOwn(element, field)) element[field] = rewrite(element[field]);
    if (type === ElementType.Mapper || type === ElementType.MessageBuilder) rewriteReplacements(element, rewrite);
    if (iterator) {
        const props = element.properties || {};
        if (Object.hasOwn(props, 'target')) props.target = rewrite(props.target);
        rewriteStringList(props, 'prefixSubstitutions', rewrite);
        for (const child of childrenOf(element)) rewriteSubtree(child, rewrite);
    }
}

/** Mutates only fields affected by entering or leaving the supplied ancestors. */
export function rewriteElementIteratorVariables(element: Element, ancestors: Element[], replace: boolean, transformer?: Element): void {
    if (ancestors.length) rewriteSubtree(element, value => rewriteIteratorExpression(value, ancestors, replace, transformer));
}

export function relocateElementIteratorVariables(element: Element, previous: Element[], current: Element[], transformer?: Element): void {
    let shared = 0;
    while (shared < previous.length && previous[shared] === current[shared]) shared++;
    const departed = previous.slice(shared).reverse();
    const entered = current.slice(shared);
    if (!departed.length && !entered.length) return;
    rewriteSubtree(element, value => {
        if (typeof value !== 'string') return value;
        // An explicit index following a detached loop index belongs to its selected item.
        const detachedIndices: number[] = [];
        for (const iterator of departed) value = rewriteIteratorIndex(value, iterator, false, { detachedIndices, transformer });
        for (const iterator of entered) value = rewriteIteratorIndex(value, iterator, true, { detachedIndices, transformer });
        return value;
    });
}

function declaresIndex(script: string, index: string): boolean {
    const tokens = [];
    let lineBreak = false;
    for (const token of jsTokens(script, { jsx: true })) {
        if (token.type === 'WhiteSpace' || token.type === 'LineTerminatorSequence' || token.type.endsWith('Comment')) {
            lineBreak ||= /[\r\n\u2028\u2029]/.test(token.value);
        } else {
            tokens.push({ ...token, lineBreak });
            lineBreak = false;
        }
    }
    let depth = 0;
    let declaration = false;
    for (const [i, token] of tokens.entries()) {
        const previous = tokens[i - 1];
        if (!depth) {
            // A newline before or after a comma (or '=') can continue a declaration.
            // At other ambiguous statement boundaries, retain the existing rename guard.
            if (token.lineBreak && ![',', '='].includes(token.value) && ![',', '='].includes(previous?.value)) declaration = false;
            if (token.type === 'IdentifierName' && token.value === 'var') {
                // A bare branch body can start with "var" after ")", "else", or "do".
                declaration = !previous || previous.value === ';' || previous.value === '}' || previous.type.endsWith('Literal');
            } else if (token.value === ';' || token.type === 'TemplateHead' || token.type.startsWith('JSX')) {
                declaration = false;
            }
            if (declaration && (token.value === 'var' || token.value === ',')
                && tokens[i + 1]?.value === index && tokens[i + 2]?.value === '=') return true;
        }
        if (token.type === 'Punctuator') {
            if (['(', '[', '{'].includes(token.value)) depth++;
            if ([')', ']', '}'].includes(token.value)) depth--;
        }
    }
    return false;
}

// An initializer inside a separate loop may never have executed.
function earlierIndexInitializer(list: Element[], loop: Element, index: string, initialized = false): boolean | undefined {
    for (const step of list) {
        if (step === loop) return initialized;
        if (isIteratorType(elementType(step))) {
            const inside = earlierIndexInitializer(childrenOf(step), loop, index, initialized);
            if (inside !== undefined) return inside;
        } else if (isElementEnabled(step) && elementType(step) === ElementType.JavaScriptStep) {
            if (declaresIndex(step.script ?? '', index)) initialized = true;
        }
    }
}

export function renameIteratorIndex(element: Element, index: string, scope: Element[] = [element], transformer?: Element): boolean {
    const previous = element.properties.indexVariable ?? 'i';
    if (previous === index) return true;
    // IteratorRuleProperties generates a result flag for each nesting depth.
    if (elementType(element) === ElementType.IteratorRule && /^_iterator_flag_\d+$/.test(index)) return false;
    const target = element.properties.target;
    const binding = { properties: { indexVariable: previous, prefixSubstitutions: [...iteratorPrefixes(element), target] } };
    const rewrite = (value: any) => typeof value === 'string' ? rewriteIteratorIndex(value, binding, false, { rename: index, transformer }) : value;
    const unsafeReference = (value: unknown, name: string) => typeof value === 'string' && referencesIteratorIdentifier(value, name);
    const mentionsEitherIndex = (value: unknown) => unsafeReference(value, previous) || unsafeReference(value, index);
    const hasScriptReferences = (el: Element): boolean =>
        mentionsEitherIndex(el.script) || !!el.scriptPath
        || (elementType(el) === ElementType.Xslt && mentionsEitherIndex(el.template))
        || (isIteratorType(elementType(el)) && childrenOf(el).some(hasScriptReferences));
    // A disabled descendant can be enabled later without another index edit.
    // External scripts execute in this scope too. Only the engine can read the file.
    const hasScopeCollision = (el: Element, iterating: boolean): boolean =>
        !!el.scriptPath || usesGeneratedIteratorIdentifier(el, index, iterating) || (isIteratorType(elementType(el))
            && childrenOf(el).some(child => hasScopeCollision(child, true)));
    const siblingNames = freeIteratorScopeNames(scope, element);
    const children = childrenOf(element);
    // Correcting an empty loop's default can restore a sibling's independently initialized value.
    const oldNameConflict = siblingNames.has(previous)
        && (children.length > 0 || !earlierIndexInitializer(scope, element, previous));
    let unsafe = siblingNames.has(index) || oldNameConflict
        || mentionsEitherIndex(target) || children.some(hasScriptReferences)
        || index === 'getArrayOrXmlLength' || scope.some(el => hasScopeCollision(el, false));
    if (unsafe) return false;
    // Read from a draft first so a successful edit updates all references together.
    for (const child of children) {
        rewriteSubtree(structuredClone(child), value => {
            const updated = rewrite(value);
            unsafe ||= unsafeReference(value, index) || unsafeReference(updated, previous);
            return updated;
        });
        if (unsafe) return false;
    }
    for (const child of children) rewriteSubtree(child, rewrite);
    const prefixes = iteratorPrefixes(element);
    rewriteStringList(element.properties, 'prefixSubstitutions', value => {
        if (typeof value !== 'string') return value;
        const earlier = prefixes.slice(0, prefixes.indexOf(value));
        return earlier.some(prefix => value.startsWith(prefix + `[${previous}]`)) ? rewrite(value) : value;
    });
    element.properties.indexVariable = index;
    return true;
}

export function isIteratorIndexName(index: string): boolean {
    // Rhino ignores format controls in identifiers, so joiners cannot distinguish two indices.
    if (/\p{Cf}/u.test(index) || !/^[$_\p{ID_Start}][$\p{ID_Continue}]*$/u.test(index)) return false;
    const parts = readMemberBoundaries(index);
    return parts.length === 1 && parts[0].end === index.length;
}

export function getIteratorInfo(element: Element): { target: string; outbound: string | null } {
    const type = elementType(element);
    // JSON imports can supply primitives even when the release model declares a String.
    const text = (value: unknown) => String(value ?? '');
    if (isIteratorType(type)) return { target: text(element.properties?.target), outbound: null };
    if (type === ElementType.Mapper) return { target: text(element.mapping), outbound: null };
    if (type === ElementType.MessageBuilder) {
        const mapping = text(element.mapping);
        const segment = text(element.messageSegment);
        return isJavaBlank(mapping) ? { target: segment, outbound: null } : { target: mapping, outbound: segment };
    }
    if (type === ElementType.RuleBuilder || type === ElementType.DestinationSetFilter) return { target: text(element.field), outbound: null };
    if (type === ElementType.Xslt) return { target: text(element.sourceXml), outbound: null };
    return { target: '', outbound: null };
}
