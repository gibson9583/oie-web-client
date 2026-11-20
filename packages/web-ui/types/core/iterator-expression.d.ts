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
};
/** Shipped Message Builder path components, or null when the initializer cannot be reproduced. */
export declare function readMessageBuilderParts(text: string): ExpressionPart[] | null;
/** Offsets into the original source, including complete computed keys and calls. */
export declare function readMemberBoundaries(text: string): MemberBoundary[];
/** Unknown lexical syntax vetoes a rename because it can hide an index reference. */
export declare function referencesIteratorIdentifier(text: string, name: string): boolean;
export {};
