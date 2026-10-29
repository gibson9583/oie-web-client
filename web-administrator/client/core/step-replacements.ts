/* Mapper and Message Builder use List<Pair<String, String>>. XStream writes
 * typed ImmutablePair values; expressions must remain source text, not JSON
 * literals. Keep the older import shapes understood by Generated Script too. */
export const REPLACEMENT_PAIR = 'org.apache.commons.lang3.tuple.ImmutablePair';
export type Replacement = [string, string];

const expression = (value: any): string => String(
    value && typeof value === 'object' ? value.$ ?? '' : value ?? ''
);

export function replacementPairs(element: any): Replacement[] {
    let value = element?.replacements;
    if (!value) return [];
    value = value[REPLACEMENT_PAIR] ?? value.entry ?? value;
    return (Array.isArray(value) ? value : [value]).flatMap((pair: any): Replacement[] => {
        if (Array.isArray(pair)) return [[expression(pair[0]), expression(pair[1])]];
        if (!pair || typeof pair !== 'object') return [];
        if (pair.left !== undefined) return [[expression(pair.left), expression(pair.right)]];
        if (pair.key !== undefined) return [[expression(pair.key), expression(pair.value)]];
        if (pair.first !== undefined) return [[expression(pair.first), expression(pair.second)]];
        if (Array.isArray(pair.string)) return [[expression(pair.string[0]), expression(pair.string[1])]];
        return [];
    });
}
