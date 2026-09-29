/** React wraps KeyboardEvent; Safari may finish composition before Enter (229). */
export declare function isComposing(e: {
    nativeEvent?: {
        isComposing?: boolean;
        keyCode?: number;
    };
    isComposing?: boolean;
    keyCode?: number;
}): boolean;
export declare function isCommitEnter(e: {
    key?: string;
    nativeEvent?: {
        isComposing?: boolean;
        keyCode?: number;
    };
    isComposing?: boolean;
    keyCode?: number;
}): boolean;
