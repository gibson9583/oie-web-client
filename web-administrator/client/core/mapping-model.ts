/*
 * Mapper / Message Builder helpers shared by the transformer editor: the
 * replacement-pair wire shape, a design-time value preview against the
 * inbound template tree, and step-order checks for map variables.
 *
 * Wire shape (engine ObjectJSONSerializer, verified against 4.6.0):
 *   replacements: null | '' | { 'org.apache.commons.lang3.tuple.ImmutablePair':
 *       pair | pair[] },  pair = { left: { '@class': 'string', $: expr }, right: … }
 * `$` may arrive as a number or boolean (autoPrimitive). Each side is a
 * JavaScript expression, as in the Swing String Replacement table.
 */

import { replacementPairs as stepReplacementPairs, replacementsToWire } from './step-replacements.js';
import type { Replacement } from './step-replacements.js';

export const MAPPER_TYPE = 'com.mirth.connect.plugins.mapper.MapperStep';
export const MSGBUILDER_TYPE = 'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep';
export const JAVASCRIPT_TYPE = 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep';

export type ReplacementPair = Replacement;

/* Replacement pairs from a step's `replacements` value. */
export function replacementPairs(value: any): ReplacementPair[] {
    return stepReplacementPairs({ replacements: value });
}

/* The wire value for a pair list ('' is an empty list on the engine). */
export const toReplacements = replacementsToWire;

/* A JavaScript string literal ('…' or "…") as its value, else null. */
export function literalString(expr: any): string | null {
    const s = String(expr ?? '').trim();
    const m = /^(['"])((?:\\.|(?!\1)[^\\\n])*)\1$/.exec(s);
    if (!m) return null;
    return m[2].replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_all, c: string) => {
        if (c[0] === 'u' || c[0] === 'x') return c.length > 1 ? String.fromCharCode(parseInt(c.slice(1), 16)) : c;
        return ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' } as any)[c] ?? c;
    });
}

/* Quote a value as a single-quoted JavaScript literal. */
export function quoteString(value: string): string {
    return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, '\\\'').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;
}

/* ---- preview ------------------------------------------------------------------ */

export interface TreeNode {
    label: string; value: string | null; accessor: string; children: TreeNode[];
    valueType?: 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';
}

/** Parent iterators, ordered from outermost to innermost. Not a new step type. */
export interface IteratorContext {
    id?: number;
    name: string;
    target: string;
    indexVariable: string;
    prefixSubstitutions: string[];
}
/** Template-only indices. These are never written to the channel. */
export interface MappingPreviewOptions { iteratorIndices?: Record<string, number> }

type PathPart = { kind: 'key' | 'number' | 'variable'; value: string };
function accessorParts(value: string): { root: string; parts: PathPart[]; string: boolean } | null {
    const source = String(value ?? '').trim();
    const root = /^(msg|tmp)\b/.exec(source);
    if (!root) return null;
    const parts: PathPart[] = [];
    const re = /\[\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\d+|[A-Za-z_$][\w$]*)\s*\]/y;
    let at = root[0].length;
    re.lastIndex = at;
    let match;
    while ((match = re.exec(source))) {
        const token = match[1], key = literalString(token);
        parts.push({ kind: key !== null ? 'key' : /^\d+$/.test(token) ? 'number' : 'variable', value: key ?? token });
        at = re.lastIndex;
    }
    const tail = source.slice(at);
    return tail === '' || tail === '.toString()' ? { root: root[0], parts, string: !!tail } : null;
}
function samePart(a: PathPart, b: PathPart) { return a.kind === b.kind && a.value === b.value; }
function pathStarts(path: NonNullable<ReturnType<typeof accessorParts>>, prefix: NonNullable<ReturnType<typeof accessorParts>>) {
    return path.root === prefix.root && path.parts.length >= prefix.parts.length
        && prefix.parts.every((p, i) => samePart(p, path.parts[i]));
}
function printAccessor(path: NonNullable<ReturnType<typeof accessorParts>>) {
    return path.root + path.parts.map(p => `[${p.kind === 'key' ? quoteString(p.value) : p.value}]`).join('')
        + (path.string ? '.toString()' : '');
}
// An unindexed XML path can address a collection whose template accessors
// contain occurrence numbers. Treat that as unknown, never as an absent field.
function collectionAlias(wanted: NonNullable<ReturnType<typeof accessorParts>>, candidate: NonNullable<ReturnType<typeof accessorParts>>) {
    if (wanted.root !== candidate.root) return false;
    let at = 0, skipped = false;
    for (const part of candidate.parts) {
        if (part.kind === 'number' && wanted.parts[at]?.kind !== 'number') { skipped = true; continue; }
        if (!wanted.parts[at] || !samePart(part, wanted.parts[at++])) return false;
    }
    return skipped && at === wanted.parts.length;
}

/* Apply only configured prefixes to complete accessors. Never rewrite arbitrary
 * JavaScript, quoted text, or an unrelated index. A selected numeric occurrence
 * becomes the iterator variable; other numeric indices remain intentional. */
export function iteratorExpression(expression: string, contexts: IteratorContext[], remove = false, keepFixed: IteratorContext[] = []): string {
    const path = accessorParts(expression);
    if (!path) return expression;
    let changed = false;
    for (const context of remove ? [...contexts].reverse() : contexts) {
        if (!/^[A-Za-z_$][\w$]*$/.test(context.indexVariable)) continue;
        for (const raw of context.prefixSubstitutions) {
            const prefix = accessorParts(raw);
            if (!prefix || !pathStarts(path, prefix)) continue;
            const at = prefix.parts.length, next = path.parts[at];
            if (remove) {
                if (next?.kind === 'variable' && next.value === context.indexVariable) {
                    path.parts.splice(at, 1); changed = true;
                }
            } else if (!next || next.kind === 'key' || (next.kind === 'number' && !keepFixed.includes(context))) {
                path.parts.splice(at, next?.kind === 'number' ? 1 : 0, { kind: 'variable', value: context.indexVariable });
                changed = true;
            }
        }
    }
    return changed ? printAccessor(path) : expression;
}

/** Rebind supported step paths when membership changes. Arbitrary JS stays
 * byte-for-byte intact and is reported for review rather than guessed at. */
export function rebindIteratorStep(element: any, before: IteratorContext[], after: IteratorContext[]): boolean {
    let review = false;
    // A fixed index is a choice while the step stays in its iterator. Only
    // entering an iterator turns one into the index variable.
    const stayed = after.filter(c => c.id !== undefined && before.some(b => b.id === c.id));
    const rewrite = (value: any) => {
        if (typeof value !== 'string') return value;
        const next = iteratorExpression(iteratorExpression(value, before, true), after, false, stayed);
        const path = accessorParts(next);
        if (literalString(next) === null && before.some(c => {
            // An accessor outside the configured prefixes is preserved too,
            // but may still reference an index that no longer exists.
            if (path) return !after.some(a => a.indexVariable === c.indexVariable)
                && path.parts.some(p => p.kind === 'variable' && p.value === c.indexVariable);
            const variable = c.indexVariable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return variable && new RegExp(`(^|[^\\w$])${variable}(?![\\w$])`).test(next);
        })) review = true;
        return next;
    };
    if (element.__type === MAPPER_TYPE || element.__type === MSGBUILDER_TYPE) {
        for (const key of ['mapping', 'defaultValue', ...(element.__type === MSGBUILDER_TYPE ? ['messageSegment'] : [])])
            element[key] = rewrite(element[key]);
        const pairs = replacementPairs(element.replacements);
        const next = pairs.map(([l, r]): ReplacementPair => [rewrite(l), rewrite(r)]);
        if (next.some((p, i) => p[0] !== pairs[i][0] || p[1] !== pairs[i][1])) element.replacements = toReplacements(next);
    } else if (element.__type === 'com.mirth.connect.model.IteratorStep' && element.properties) {
        element.properties.target = rewrite(element.properties.target);
        const raw = element.properties.prefixSubstitutions?.string;
        if (raw != null) {
            const prefixes: string[] = (Array.isArray(raw) ? raw : [raw]).map(String);
            const next = prefixes.map(rewrite);
            if (next.some((p, i) => p !== prefixes[i]))
                element.properties.prefixSubstitutions = { ...element.properties.prefixSubstitutions, string: next };
        }
    }
    return review;
}

/** Bind known iterator indices for template lookup, without evaluating code. */
export function sampleExpression(expression: string, contexts: IteratorContext[], options: MappingPreviewOptions = {}): string {
    const path = accessorParts(expression);
    if (!path) return expression;
    for (const part of path.parts) {
        if (part.kind !== 'variable' || !contexts.some(c => c.indexVariable === part.value)) continue;
        const index = options.iteratorIndices?.[part.value] ?? 0;
        if (!Number.isSafeInteger(index) || index < 0) continue;
        part.kind = 'number'; part.value = String(index);
    }
    return printAccessor(path);
}

/** Number of template repetitions, or null for a runtime-only iterator target. */
export function iteratorSampleCount(nodes: TreeNode[] | null | undefined, context: IteratorContext,
    contexts: IteratorContext[], options: MappingPreviewOptions = {}): number | null {
    if (!nodes) return null;
    const target = accessorParts(sampleExpression(context.target, contexts, options));
    if (!target || target.parts.some(p => p.kind === 'variable')) return null;
    let exact: TreeNode | undefined;
    const occurrences = new Set<number>();
    for (const node of new Set(indexTree(nodes).values())) {
        const path = accessorParts(node.accessor);
        if (!path || !pathStarts(path, target)) continue;
        if (path.parts.length === target.parts.length) exact = node;
        if (path.parts.length === target.parts.length + 1 && path.parts.at(-1)?.kind === 'number')
            occurrences.add(Number(path.parts.at(-1)!.value));
    }
    if (exact?.valueType && exact.valueType !== 'array') return null;
    if (occurrences.size) return [...occurrences].reduce((max, n) => Math.max(max, n), 0) + 1;
    if (exact) return exact.value === null && !exact.children.length ? 0 : 1;
    if ([...new Set(indexTree(nodes).values())].some(n => {
        const candidate = accessorParts(n.accessor);
        return candidate && collectionAlias(target, candidate);
    })) return null;
    return 0;
}

/** Picker tree for one sample repetition. Accessors retain symbolic indices. */
export function iteratorTree(nodes: TreeNode[] | null | undefined, contexts: IteratorContext[],
    options: MappingPreviewOptions = {}): TreeNode[] | null | undefined {
    if (!nodes || !contexts.length) return nodes;
    const visit = (node: TreeNode): TreeNode | null => {
        const expression = iteratorExpression(node.accessor, contexts);
        const bound = sampleExpression(expression, contexts, options);
        const original = accessorParts(node.accessor), sample = accessorParts(bound);
        if (original && sample && expression !== node.accessor) {
            // Singleton XML nodes omit [0]; JSON array containers retain their
            // own path and their indexed children supply the sample item.
            const arrayContainer = node.children.some(c => {
                const p = accessorParts(c.accessor);
                return p && p.parts.length === original.parts.length + 1 && p.parts.at(-1)?.kind === 'number';
            });
            if (arrayContainer && sample.parts.length > original.parts.length)
                return { ...node, children: node.children.map(visit).filter((n): n is TreeNode => !!n) };
            const zero = (parts: PathPart[]) => parts.filter(p => !(p.kind === 'number' && Number(p.value) === 0));
            const a = zero(original.parts), b = zero(sample.parts);
            if (a.length !== b.length || !a.every((p, i) => samePart(p, b[i]))) return null;
        }
        return { ...node, accessor: expression, children: node.children.map(visit).filter((n): n is TreeNode => !!n) };
    };
    return nodes.map(visit).filter((n): n is TreeNode => !!n);
}

/* accessor -> node, with and without a trailing .toString(). */
export function indexTree(nodes: TreeNode[] | null | undefined): Map<string, TreeNode> {
    const map = new Map<string, TreeNode>();
    const walk = (list: TreeNode[]) => {
        for (const n of list) {
            map.set(n.accessor, n);
            map.set(n.accessor.replace(/\.toString\(\)\s*$/, ''), n);
            walk(n.children || []);
        }
    };
    walk(nodes || []);
    return map;
}

export type MappingPreview =
    | { status: 'ok'; raw: string; usedDefault: boolean; missing: boolean; steps: Array<{ find: string; replace: string; value: string }>; value: string }
    | { status: 'runtime'; reason: string }
    | { status: 'error'; reason: string };

/* A plain inbound path: msg['A']['B'][0]['C'], optionally .toString(). */
export const INBOUND_PATH_RE = /^msg(?:\[(?:'(?:[^'\\]|\\.)*'|\d+)\])+(?:\.toString\(\))?$/;

/* Resolve one expression to a design-time value, or null when it depends on
   runtime state. A plain msg path that is not in the template reads as ''
   (E4X returns an empty list), flagged `missing`. */
function resolveExpr(expr: string, index: Map<string, TreeNode>): { value: string; missing: boolean } | null {
    const trimmed = String(expr ?? '').trim();
    if (!trimmed) return { value: '', missing: false };
    const lit = literalString(trimmed);
    if (lit !== null) return { value: lit, missing: false };
    const withoutString = trimmed.replace(/\.toString\(\)\s*$/, '');
    const parsed = accessorParts(withoutString);
    const json = index.get(parsed?.root || 'msg')?.valueType !== undefined;
    // XML singleton occurrences omit [0] in the tree. Exact JSON/indexed XML
    // paths win before trying that alias.
    const zeroAlias = !json && parsed && printAccessor({ ...parsed, parts: parsed.parts.filter(p => !(p.kind === 'number' && Number(p.value) === 0)) });
    const node = index.get(trimmed) || index.get(withoutString) || (zeroAlias ? index.get(zeroAlias) : undefined);
    // JSON sample text is display text, not the runtime value's type. The
    // engine defaults null and handles replacements differently for nonstrings.
    if (node) return node.children.length || (node.valueType && node.valueType !== 'string')
        ? null : { value: node.value ?? '', missing: false };
    // Missing JSON parents can throw before validate() gets a value. XML's
    // empty-list/default behavior and occurrence aliases do not apply to JSON.
    if (json) return null;
    if (parsed && [...new Set(index.values())].some(n => {
        const candidate = accessorParts(n.accessor);
        return candidate && collectionAlias(parsed, candidate);
    })) return null;
    if (index.size && INBOUND_PATH_RE.test(trimmed)) return { value: '', missing: true };
    return null;
}

/*
 * Mirrors the engine's validate(mapping, defaultValue, replacement): a blank
 * result takes the default, then each replacement runs as replaceAll in order.
 * Java and JavaScript regex syntax differ in edge cases, so this is a preview.
 */
export function previewMapping(step: { mapping?: any; defaultValue?: any; replacements?: any },
    index: Map<string, TreeNode>, contexts: IteratorContext[] = [], options: MappingPreviewOptions = {}): MappingPreview {
    for (const context of contexts) {
        const count = iteratorSampleCount(index.size ? [...new Set(index.values())] : null, context, contexts, options);
        const sample = options.iteratorIndices?.[context.indexVariable] ?? 0;
        if (count === null || !Number.isSafeInteger(sample) || sample < 0 || sample >= count)
            return { status: 'runtime', reason: count === 0 ? 'The iterator has no repetitions in this template.'
                : 'This iterator sample is unavailable. Its target may require runtime data.' };
    }
    const mapped = resolveExpr(sampleExpression(step.mapping, contexts, options), index);
    if (!mapped) return { status: 'runtime', reason: 'The value is computed when a message runs.' };
    let value = mapped.value;
    let usedDefault = false;
    if (value === '') {
        const def = resolveExpr(sampleExpression(step.defaultValue, contexts, options), index);
        if (!def) return { status: 'runtime', reason: 'The field is empty and the default is computed when a message runs.' };
        value = def.value;
        usedDefault = true;
    }
    const raw = value;
    const steps: Array<{ find: string; replace: string; value: string }> = [];
    for (const [l, r] of replacementPairs(step.replacements)) {
        const find = literalString(l);
        const repl = literalString(r);
        if (find === null || repl === null) return { status: 'runtime', reason: 'A replacement is computed when a message runs.' };
        try {
            value = value.replace(new RegExp(find, 'g'), repl);
        } catch (e: any) {
            return { status: 'error', reason: `Invalid regular expression ${l}: ${e.message}` };
        }
        steps.push({ find, replace: repl, value });
    }
    return { status: 'ok', raw, usedDefault, missing: mapped.missing, steps, value };
}

/* ---- variable order ------------------------------------------------------------- */

const PUT_RE = /(?:globalMap|globalChannelMap|channelMap|connectorMap|responseMap|sourceMap)\.put\s*\(\s*['"]([^'"]+)['"]|\$(?:gc|co|g|c|r|s)\s*\(\s*['"]([^'"]+)['"]\s*,/g;
const READ_RE = /(?:globalMap|globalChannelMap|channelMap|connectorMap|responseMap|sourceMap|configurationMap)\.get\s*\(\s*['"]([^'"]+)['"]\s*\)|\$(?:gc|co|cfg|g|c|r|s)?\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function matches(re: RegExp, text: any): string[] {
    const out: string[] = [];
    if (typeof text !== 'string' || !text) return out;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) out.push(m[1] || m[2]);
    return out;
}

/* Map variables a step sets. */
export function variablesSet(el: any): string[] {
    if (!el || el.enabled === false) return [];
    const out = new Set<string>();
    if (el.__type === MAPPER_TYPE && typeof el.variable === 'string' && el.variable.trim()) out.add(el.variable.trim());
    for (const name of matches(PUT_RE, el.script)) out.add(name);
    return [...out];
}

/* Map variables a step reads. */
export function variablesRead(el: any): string[] {
    if (!el || el.enabled === false) return [];
    const out = new Set<string>();
    const fields = [el.mapping, el.defaultValue, el.messageSegment, el.script];
    for (const [l, r] of replacementPairs(el.replacements)) fields.push(l, r);
    for (const f of fields) for (const name of matches(READ_RE, f)) out.add(name);
    return [...out];
}

export interface OrderWarning { name: string; setBy: number }

/*
 * For steps in execution order: the variables each step reads before any
 * earlier step sets them, where a later step does set them. Variables set
 * nowhere in this list (another connector, a global script) are not flagged.
 */
export function orderWarnings(steps: any[]): OrderWarning[][] {
    const setters = new Map<string, number[]>();
    steps.forEach((el, i) => {
        for (const name of variablesSet(el)) {
            if (!setters.has(name)) setters.set(name, []);
            setters.get(name)!.push(i);
        }
    });
    return steps.map((el, i) => {
        const out: OrderWarning[] = [];
        for (const name of variablesRead(el)) {
            const at = setters.get(name);
            if (!at || at.some(j => j < i) || at.includes(i)) continue;
            out.push({ name, setBy: at[0] });
        }
        return out;
    });
}
