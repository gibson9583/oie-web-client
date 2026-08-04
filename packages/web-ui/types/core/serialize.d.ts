import type { OieObject } from './wire-types.js';
/** An engine-serialized message tree: the format, the tree text, and (when the
    engine provides them) the root label + per-node vocabulary descriptions. */
export interface SerializedTemplate {
    format: 'xml' | 'json';
    text: string;
    meta: OieObject | null;
}
/**
 * Serialize a template through the engine. Returns { format: 'xml'|'json',
 * text, meta } or null on failure. `meta` carries the message-tree root label
 * and (when the engine provides them) per-node vocabulary descriptions.
 */
export declare function serializeTemplate(dataType: string, serializationProperties: OieObject | null | undefined, message: unknown): Promise<SerializedTemplate | null>;
/**
 * Validate a JavaScript snippet through the engine's own Rhino compiler check.
 * Returns:
 *   { ok: true }            valid
 *   { ok: false, message }  compile error (e.g. "Error on line 3: ...")
 *   { ok: null, message }   validation unavailable (engine unreachable)
 */
export declare function validateScript(script: string | null | undefined): Promise<{
    ok: boolean | null;
    message?: string;
}>;
/**
 * Pretty-print a JavaScript snippet client-side with js-beautify (E4X-safe, the same
 * library + options the engine's formatter used, so XML literals survive — Monaco's
 * TS formatter would mangle them). Returns the formatted code, or null on failure
 * (the caller then leaves the text unchanged).
 */
export declare function formatScript(script: string | null | undefined): Promise<string | null>;
