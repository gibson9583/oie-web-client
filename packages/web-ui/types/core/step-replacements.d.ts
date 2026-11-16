export declare const REPLACEMENT_PAIR = "org.apache.commons.lang3.tuple.ImmutablePair";
export type Replacement = [string, string];
export declare function replacementPairs(element: any): Replacement[];
export declare function replacementsToWire(rows: Replacement[]): "" | {
    "org.apache.commons.lang3.tuple.ImmutablePair": {
        left: {
            '@class': string;
            $: string;
        };
        right: {
            '@class': string;
            $: string;
        };
    }[];
};
