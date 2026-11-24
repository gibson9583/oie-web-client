type ExpressionPart = {
    value: string;
    propertyName: string;
    numberLiteral?: boolean;
};
type MemberBoundary = {
    end: number;
    key?: string;
    numeric?: boolean;
    call?: boolean;
    regexArgument?: boolean;
};
/** Shipped Message Builder path components, or null when the initializer cannot be reproduced. */
export declare function readMessageBuilderParts(text: string): ExpressionPart[] | null;
/** Offsets into the original source, including complete computed keys and calls. */
export declare function readMemberBoundaries(text: string): MemberBoundary[];
/** Names to reserve when choosing a fresh loop index for authored JavaScript. */
export declare function iteratorIdentifierNames(source: string): string[];
/** Unknown lexical syntax vetoes a rename because it can hide an index reference. */
export declare function referencesIteratorIdentifier(text: string, name: string): boolean;
export {};
