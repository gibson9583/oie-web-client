/** Render one XStream-encoded value the way the engine's StringUtil.valueOf does. */
export declare function toDisplayString(v: unknown): string;
/** Unwrap a MapContent value to its <map> node, descending single-key wrappers. */
export declare function mapNode(mc: unknown): unknown;
/** [key, value] pairs from a MapContent value, values rendered Java-toString style. */
export declare function mappingEntries(mc: unknown): Array<[string, string]>;
/** Parse a serialized <response> envelope -> {status, statusMessage, message}, or null. */
export declare function parseResponse(content: unknown): {
    status: string;
    statusMessage: string;
    message: string;
} | null;
