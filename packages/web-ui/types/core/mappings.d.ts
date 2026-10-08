export declare const DESTINATION_MAPPINGS: Array<[string, string]>;
/** Swing's destination list uses the connector's transfer mode, not editor syntax.
 * Source receivers and authentication scripts have separate reference contexts. */
export declare function destinationMappingsFor(properties?: unknown): Array<[string, string]>;
export declare const SCRIPT_REFERENCE: Array<[string, string]>;
