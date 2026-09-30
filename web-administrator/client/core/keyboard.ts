/** React wraps KeyboardEvent; Safari may finish composition before Enter (229). */
export function isComposing(e: { nativeEvent?: { isComposing?: boolean; keyCode?: number }; isComposing?: boolean; keyCode?: number }): boolean {
    const native = e.nativeEvent ?? e;
    return !!native.isComposing || native.keyCode === 229 || e.keyCode === 229;
}

export function isCommitEnter(e: { key?: string; nativeEvent?: { isComposing?: boolean; keyCode?: number }; isComposing?: boolean; keyCode?: number }): boolean {
    return e.key === 'Enter' && !isComposing(e);
}
