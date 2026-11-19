type PathMode = 'substitution' | 'messageBuilder';
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
/** getExpressionParts falls back to the complete source when the visitor has no parts. */
export declare function readExpressionParts(text: string, mode?: PathMode): ExpressionPart[];
/** Source offsets in the leading member chain, including complete computed keys. */
export declare function readMemberBoundaries(text: string): MemberBoundary[];
/** Conservatively detect an index reference outside ordinary strings and comments. */
export declare function referencesIteratorIdentifier(text: string, name: string): boolean;
export {};
