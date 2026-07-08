/*
 * Message-tree serialization + JavaScript validate/format.
 *
 * Serialize + validate call the connected engine's own REST endpoints (through the
 * /api proxy), which run the engine's real datatype serializers and Rhino compiler —
 * so output is byte-identical to the runtime `msg`/`tmp` and matches Swing. There
 * is no local JVM or engine install: serialization follows whichever engine the
 * session is on. A transient failure just returns null / { ok: null } so a caller
 * can leave its input unchanged rather than error.
 *
 *   POST /api<base>/datatypes/_serialize?dataType=&props=   (message body)  -> { format, data, meta }
 *   POST /api<base>/javascript/_validate                    (script body)   -> { error }
 *
 * <base> comes from core/websupport.js: '' on an engine that ships the endpoints
 * natively, '/extensions/websupport' when the Web Support plugin provides them, and
 * unavailable (null) otherwise — in which case these helpers degrade to their
 * transient-failure returns instead of erroring.
 *
 * Pretty-printing (Format Document) runs CLIENT-SIDE with js-beautify 1.15.3 — the
 * same library and options (`e4x: true, indent_with_tabs: true`) the engine's
 * JavaScriptSharedUtil.prettyPrint used, so E4X XML literals survive and output
 * matches Swing's Format Code. No engine round-trip / `_prettyPrint` endpoint needed.
 */

import { js as jsBeautify } from 'js-beautify';
import { post } from './api.js';
import { webSupportBase } from './websupport.js';

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
        const base = await webSupportBase();
        if (base === null) return null;
        const text = await post(`${base}/datatypes/_serialize`, String(message ?? ''), {
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
        const base = await webSupportBase();
        if (base === null) return { ok: null, message: 'Validation unavailable — the Web Support plugin is not installed on this engine.' };
        const text = await post(`${base}/javascript/_validate`, String(script ?? ''), {
            contentType: 'text/plain', raw: true, noAuthHandler: true
        });
        const err = (JSON.parse(text).error || '').trim();
        return err ? { ok: false, message: err } : { ok: true };
    } catch (e) {
        return { ok: null, message: e.message || 'Validation unavailable.' };
    }
}

// js-beautify's e4x mode can mangle an XML prolog into `<< ? xml version="1.0" ? >`;
// restore it to `<?xml version="1.0"[ encoding="…"]?>` (ported verbatim from the
// engine's JavaScriptSharedUtil.INVALID_PROLOG_PATTERN handling).
const PROLOG_RE = /<<\s*\?\s*xml\s+version\s*=\s*"([^"]*)"(?:\s+encoding\s*=\s*"([^"]*)")?\s*\?\s*>/g;
const BEAUTIFY_OPTS = { e4x: true, indent_with_tabs: true };

/**
 * Pretty-print a JavaScript snippet client-side with js-beautify (E4X-safe, the same
 * library + options the engine's formatter used, so XML literals survive — Monaco's
 * TS formatter would mangle them). Returns the formatted code, or null on failure
 * (the caller then leaves the text unchanged).
 */
export async function formatScript(script) {
    try {
        const src = String(script ?? '');
        if (!src.trim()) return src;
        const formatted = jsBeautify(src, BEAUTIFY_OPTS);
        return typeof formatted === 'string'
            ? formatted.replace(PROLOG_RE, (_m, version, encoding) =>
                `<?xml version="${version}"${encoding != null ? ` encoding="${encoding}"` : ''}?>`)
            : null;
    } catch {
        return null;
    }
}
