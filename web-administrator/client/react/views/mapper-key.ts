import jsTokens from 'js-tokens';
import { freeIteratorScopeNames } from './iterator-substitutions.js';
import { ElementType } from '../../core/element-types.js';
import { destinationsOf, elementsToArray, isIteratorType } from '../../core/oie.js';
import { convertIdentifier } from '../../core/step-script.js';
import type { OieObject } from '../../core/wire-types.js';

const escapes: Record<string, string> = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };

function literalValue(token: string): string {
    return token.slice(1, -1).replace(/\\(u\{[\da-fA-F]{1,6}\}|u[\da-fA-F]{4}|x[\da-fA-F]{2}|[0-3][0-7]{0,2}|[4-7][0-7]?|\r\n|[\s\S])/g, (_, code: string) => {
        if (code.startsWith('u{')) {
            const point = parseInt(code.slice(2), 16);
            return point <= 0x10ffff ? String.fromCodePoint(point) : code;
        }
        if (code.length > 1 && (code[0] === 'u' || code[0] === 'x')) return String.fromCharCode(parseInt(code.slice(1), 16));
        if (/^[0-7]/.test(code)) return String.fromCharCode(parseInt(code, 8));
        if (/^[\r\n\u2028\u2029]/.test(code)) return '';
        return escapes[code] ?? code;
    });
}

function collectChannelWrites(script: string, keys: Set<string>): void {
    // The XML-aware tokenizer keeps E4X literals, strings, and regexes intact.
    // Look for a literal first argument followed by a comma so $c reads don't reserve keys.
    const tokens = [...jsTokens(script, { jsx: true })].filter(token =>
        token.type !== 'WhiteSpace' && token.type !== 'LineTerminatorSequence' && !token.type.endsWith('Comment'));
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].type !== 'IdentifierName') continue;
        let open = i + 1;
        if (tokens[i].value === 'channelMap' && tokens[open]?.value === '.' && tokens[open + 1]?.value === 'put') open += 2;
        else if (tokens[i].value !== '$c') continue;
        const key = tokens[open + 1];
        if (tokens[open]?.value === '(' && tokens[open + 2]?.value === ','
            && (key.type === 'StringLiteral' || key.type === 'NoSubstitutionTemplate') && key.closed) {
            keys.add(literalValue(key.value));
        }
    }
}

export function availableMapperKey(channel: OieObject, base: string, steps: OieObject[], outerIterator?: OieObject): string {
    if (!base) return base;
    const keys = new Set<string>();
    function collect(elements: Parameters<typeof elementsToArray>[0]): void {
        for (const el of elementsToArray(elements)) {
            if (el.__type === ElementType.Mapper && (!el.scope || el.scope === 'CHANNEL')) keys.add(el.variable);
            if (el.__type === ElementType.Xslt) keys.add(el.resultVariable);
            if (typeof el.script === 'string') collectChannelWrites(el.script, keys);
            if (isIteratorType(el.__type)) collect(el.properties?.children);
        }
    }
    for (const connector of [channel.sourceConnector, ...destinationsOf(channel)]) {
        collect(connector?.filter?.elements);
        collect(connector?.transformer?.elements);
        collect(connector?.responseTransformer?.elements);
    }

    // The engine initializes every nested Mapper/XSLT list before the outer loop,
    // and publishes them all afterward. The output map's scope does not distinguish lists.
    // A generated list is also a function-scoped variable visible to authored sibling steps.
    const locals = outerIterator ? freeIteratorScopeNames(steps) : new Set<string>();
    function collectLocals(iterator: OieObject): void {
        locals.add(iterator.properties?.indexVariable ?? 'i');
        for (const el of iterator.__children) {
            if (el.__type === ElementType.Mapper) locals.add('_' + convertIdentifier(el.variable));
            if (el.__type === ElementType.Xslt) locals.add('_' + convertIdentifier(el.resultVariable));
            if (isIteratorType(el.__type)) collectLocals(el);
        }
    }
    if (outerIterator) collectLocals(outerIterator);
    let key = base;
    for (let suffix = 2; keys.has(key) || locals.has('_' + convertIdentifier(key)); suffix++) key = `${base}_${suffix}`;
    return key;
}
