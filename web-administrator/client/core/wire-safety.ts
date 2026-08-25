/* Strict collection decoding for action-time safety checks.

   api.asList is intentionally permissive for rendering: null, an empty body and
   singleton objects all become arrays. That is dangerous immediately before an
   audit decision or a whole-set/create-or-replace write, because a malformed
   successful response can become an authoritative empty list. These readers
   preserve the engine's genuine empty XStream collection (the parsed '' value),
   while rejecting null/undefined and objects without the expected collection
   member. */

import api from '@oie/web-api';

export function strictWireList<T = any>(raw: any, key: string, label: string): T[] {
    if (raw === '') return [];
    if (raw == null) throw new Error(`the engine returned an unusable ${label}`);
    // XStream collections arrive in their named wrapper (or as '' for a real
    // empty collection). A bare JSON array is not an authoritative engine
    // collection and must not become the baseline for a whole-set write.
    if (Array.isArray(raw)) throw new Error(`the engine returned an unusable ${label}`);
    if (typeof raw !== 'object') throw new Error(`the engine returned an unusable ${label}`);

    if (Object.prototype.hasOwnProperty.call(raw, key)) {
        if (raw[key] == null) throw new Error(`the engine returned an unusable ${label}`);
        const decoded = api.asList<T>(raw, key);
        // The only valid empty collection is the root-level '' handled above.
        // A named wrapper with no actual members is another malformed success.
        if (!decoded.length) throw new Error(`the engine returned an unusable ${label}`);
        return decoded;
    }

    // Some XStream collections use the model's fully-qualified class name in
    // place of its alias. Accept only that exact singleton wrapper; a bare {}
    // must never stand in for an empty collection.
    const keys = Object.keys(raw).filter(k => !k.startsWith('@'));
    if (keys.length === 1) {
        const lastSegment = (keys[0].split('.').pop() || '').toLowerCase();
        if (lastSegment === key.toLowerCase()) {
            const decoded = api.asList<T>(raw, key);
            if (!decoded.length) throw new Error(`the engine returned an unusable ${label}`);
            return decoded;
        }
    }
    throw new Error(`the engine returned an unusable ${label}`);
}
