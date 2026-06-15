/*
 * Client side of the serializer bridge. Asks the Node server (which runs the
 * engine's own datatype serializers) to convert a template to its serialized
 * XML/JSON — byte-identical to the runtime `msg`/`tmp`. Returns null on any
 * failure so callers can fall back to built-in JS parsing.
 */

let available = null;   // cached bridge availability (null = unknown)

export async function bridgeAvailable() {
    if (available !== null) return available;
    try {
        const res = await fetch('/webadmin/serialize/status');
        const status = res.ok ? await res.json() : null;
        available = !!(status && status.configured);
    } catch (e) {
        available = false;
    }
    return available;
}

/**
 * Serialize a template through the engine. Returns { format: 'xml'|'json',
 * text, meta } or null if the bridge is unavailable or errors. `meta` carries
 * the message-tree root label and per-node vocabulary descriptions (may be
 * null/empty for JSON or types without a vocabulary).
 */
export async function serializeTemplate(dataType, serializationProperties, message) {
    if (!(await bridgeAvailable())) return null;
    try {
        const res = await fetch('/webadmin/serialize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ dataType, serializationProperties, message })
        });
        if (!res.ok) {
            if (res.status === 503) available = false;   // bridge went away
            return null;
        }
        const j = await res.json();
        if (!j.ok) return null;
        return { format: j.format, text: j.data, meta: j.meta || null };
    } catch (e) {
        return null;
    }
}

/**
 * Validate a JavaScript snippet through the engine's own Rhino compiler check
 * (JavaScriptSharedUtil.validateScript) — the same one the Swing client uses.
 * Returns:
 *   { ok: true }            valid
 *   { ok: false, message }  compile error (e.g. "Error on line 3: ...")
 *   { ok: null, message }   bridge unavailable — could not validate
 */
export async function validateScript(script) {
    if (!(await bridgeAvailable())) {
        return { ok: null, message: 'Live validation requires the engine bridge (set engineHome / OIE_HOME).' };
    }
    try {
        const res = await fetch('/webadmin/serialize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ dataType: '__validate__', message: String(script ?? '') })
        });
        if (!res.ok) {
            if (res.status === 503) available = false;
            return { ok: null, message: 'Validation service unavailable.' };
        }
        const j = await res.json();
        if (!j.ok) return { ok: null, message: j.error || 'Validation failed.' };
        const err = (j.data || '').trim();
        return err ? { ok: false, message: err } : { ok: true };
    } catch (e) {
        return { ok: null, message: e.message };
    }
}
