type PathMode = 'substitution' | 'messageBuilder';
type ExpressionPart = {
    value: string;
    propertyName: string;
    numberLiteral?: boolean;
};
export declare function isJavaBlank(text: string | null | undefined): boolean;
/** getExpressionParts falls back to the complete source when the visitor has no parts. */
export declare function readExpressionParts(text: string, mode?: PathMode): ExpressionPart[];
export {};
