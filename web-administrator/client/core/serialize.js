/*
 * Message-tree serialization + JavaScript validate/format, served by the ENGINE.
 *
 * These call the connected engine's own REST endpoints (through the /api proxy),
 * which run the engine's real datatype serializers and Rhino compiler/formatter —
 * so output is byte-identical to the runtime `msg`/`tmp` and matches Swing. There
 * is no local JVM or engine install: serialization follows whichever engine the
 * session is on. The web administrator targets an engine release that provides
 * these endpoints; a transient failure just returns null / { ok: null } so a
 * caller can leave its input unchanged rather than error.
 *
 *   POST /api/datatypes/_serialize?dataType=&props=   (message body)  -> { format, data, meta }
 *   POST /api/javascript/_validate                    (script body)   -> { error }
 *   POST /api/javascript/_prettyPrint                 (script body)    -> formatted text
 */

import { post } from './api.js';

/* Flatten an engine SerializationProperties object to newline-separated key=value
   lines (the `props` query param). Only primitive fields are forwarded; the engine
   coerces by the property's declared type and ignores anything it doesn't know. */
function flattenProps(props) {
    if (!props || typeof props !== 'object') return '';
    const lines = [];
    for (const [k, v] of Object.entries(props)) {
        if (k.startsWith('@')) continue;
        if (v === null || v === undefined) continue;
        if (typeof v === 'object') continue;   // nested props left at engine defaults
        lines.push(`${k}=${v}`);
    }
    return lines.join('\n');
}

/**
 * Serialize a template through the engine. Returns { format: 'xml'|'json',
 * text, meta } or null on failure. `meta` carries the message-tree root label
 * and (when the engine provides them) per-node vocabulary descriptions.
 */
export async function serializeTemplate(dataType, serializationProperties, message) {
    try {
        const text = await post('/datatypes/_serialize', String(message ?? ''), {
            contentType: 'text/plain',
            params: { dataType, props: flattenProps(serializationProperties) || undefined },
            raw: true, noAuthHandler: true
        });
        const j = JSON.parse(text);
        return { format: j.format, text: j.data, meta: j.meta || null };
    } catch {
        return null;
    }
}

/**
 * Validate a JavaScript snippet through the engine's own Rhino compiler check.
 * Returns:
 *   { ok: true }            valid
 *   { ok: false, message }  compile error (e.g. "Error on line 3: ...")
 *   { ok: null, message }   validation unavailable (engine unreachable)
 */
export async function validateScript(script) {
    try {
        const text = await post('/javascript/_validate', String(script ?? ''), {
            contentType: 'text/plain', raw: true, noAuthHandler: true
        });
        const err = (JSON.parse(text).error || '').trim();
        return err ? { ok: false, message: err } : { ok: true };
    } catch (e) {
        return { ok: null, message: e.message || 'Validation unavailable.' };
    }
}

/**
 * Pretty-print a JavaScript snippet through the engine's own formatter (the same
 * one Swing's Format Code uses, so E4X XML literals survive — Monaco's TS
 * formatter would mangle them). Returns the formatted code, or null on failure
 * (the caller then leaves the text unchanged).
 */
export async function formatScript(script) {
    try {
        const formatted = await post('/javascript/_prettyPrint', String(script ?? ''), {
            contentType: 'text/plain', raw: true, noAuthHandler: true
        });
        return typeof formatted === 'string' ? formatted : null;
    } catch {
        return null;
    }
}
