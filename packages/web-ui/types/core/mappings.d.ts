import type { OieObject } from './wire-types.js';
export declare const DESTINATION_MAPPINGS: Array<[string, string]>;
/** Swing's destination list uses the connector's transfer mode, not editor syntax.
 * Source receivers and authentication scripts have separate reference contexts.
 * Read the live, unsaved channel on every call; do not cache by object identity. */
export declare function destinationMappingsFor(properties?: unknown, channel?: OieObject, destination?: OieObject): Array<[string, string]>;
export declare const SCRIPT_REFERENCE: Array<[string, string]>;
