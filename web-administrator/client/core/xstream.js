/*
 * XStream-JSON decoding for engine REST data.
 *
 * The engine's REST API serializes Java objects with XStream and converts the
 * XML to JSON (Staxon). What the browser receives is therefore a *structural*
 * encoding of Java objects — typed scalar wrappers ({int:5}), collections
 * ({list:{string:[...]}}), maps ({entry:[...]} or custom-serialized forms),
 * @class/@reference attributes — not clean domain JSON.
 *
 * This module is the single place that turns those shapes into the values and
 * display strings the Swing client shows. `toDisplayString` is a faithful port
 * of the engine's StringUtil.valueOf (server/.../util/StringUtil.java):
 *   - Object[]                -> "[a, b, c]"   (Arrays.toString)
 *   - Map                     -> "{k=v, k=v}"  (recursive valueOf)
 *   - Response                -> "STATUS: statusMessage"
 *   - everything else         -> String.valueOf
 *
 * Add new XStream quirks HERE (with a fixture in xstream.test.js) rather than in
 * any individual view, so every screen benefits at once.
 */

const XSTREAM_SCALARS = new Set(['string', 'int', 'long', 'short', 'byte', 'double', 'float', 'boolean', 'char', 'date', 'null', 'big-decimal', 'big-int']);
const XSTREAM_COLLECTIONS = new Set(['list', 'linked-list', 'array-list', 'set', 'linked-hash-set', 'sorted-set', 'tree-set']);
const XSTREAM_MAPS = new Set(['map', 'linked-hash-map', 'hash-map', 'tree-map', 'sorted-map', 'concurrent-hash-map', 'properties']);

// Coerce a single-or-array XStream child into an array (no key unwrapping).
const asList = (v) => (v === null || v === undefined || v === '') ? [] : (Array.isArray(v) ? v : [v]);
const toArray = (x) => x === undefined ? [] : (Array.isArray(x) ? x : [x]);

// Expand a collection's inner node ({string:[a,b]} / {string:a} / "") into an
// array of element nodes that toDisplayString can render.
function collItems(inner) {
    if (inner === '' || inner === null || inner === undefined) return [];
    if (Array.isArray(inner)) return inner;
    if (typeof inner === 'object') {
        const ks = Object.keys(inner).filter(k => !k.startsWith('@'));
        if (ks.length === 1) {
            const val = inner[ks[0]];
            return Array.isArray(val) ? val.map(x => ({ [ks[0]]: x })) : [{ [ks[0]]: val }];
        }
    }
    return [inner];
}

/* Custom-serialized map (Java writeObject form, e.g. a CaseInsensitiveMap of
   response headers). XStream emits the serialization stream's values grouped by
   type, so for a Map<String,List<...>> the keys land in `string[]` and the
   values in `list[]` (parallel); a Map<String,String> interleaves key,value in
   `string[]`. Rendered "{k=v, ...}" like the map's toString. */
function formatCustomMap(inner) {
    if (!inner || typeof inner !== 'object') return null;
    const strings = toArray(inner.string);
    const lists = toArray(inner.list);
    const ints = toArray(inner.int);
    const size = ints.length ? Number(ints[ints.length - 1]) : null;
    let parts;
    if (lists.length && strings.length === lists.length) {
        parts = strings.map((k, i) => `${k}=${toDisplayString({ list: lists[i] })}`);
    } else if (size != null && strings.length === size * 2) {
        parts = [];
        for (let i = 0; i + 1 < strings.length; i += 2) parts.push(`${strings[i]}=${strings[i + 1]}`);
    } else if (strings.length && !lists.length) {
        parts = strings.slice();
    } else {
        return null;
    }
    return '{' + parts.join(', ') + '}';
}

// "key=value, ..." for an XStream <map> node ({entry:[...]}), Java toString style.
function formatEntryMap(node) {
    if (!node || typeof node !== 'object' || node.entry === undefined) return '{}';
    const parts = [];
    for (const entry of asList(node.entry)) {
        if (!entry || typeof entry !== 'object') continue;
        const pair = parseMapEntry(entry);
        if (pair) parts.push(`${pair[0]}=${pair[1]}`);
    }
    return '{' + parts.join(', ') + '}';
}

/** Render one XStream-encoded value the way the engine's StringUtil.valueOf does. */
export function toDisplayString(v) {
    if (v === null || v === undefined) return '';
    if (typeof v !== 'object') return String(v);
    // Custom-serialized map (response headers etc.) -> "{k=v, ...}".
    const cls = v['@class'];
    if (v['@serialization'] === 'custom' && cls && /map/i.test(cls) && v[cls]) {
        const m = formatCustomMap(v[cls]);
        if (m != null) return m;
    }
    const keys = Object.keys(v).filter(k => !k.startsWith('@'));
    if (!keys.length) return '';
    // Response object: rendered like its toString — "STATUS: statusMessage".
    if (keys.includes('status') && (keys.includes('statusMessage') || keys.includes('message'))) {
        const sm = v.statusMessage;
        return String(v.status ?? '') + (sm ? ': ' + sm : '');
    }
    if (keys.length === 1) {
        const type = keys[0];
        const inner = v[type];
        if (type === 'entry') return formatEntryMap(v);
        if (XSTREAM_SCALARS.has(type)) return inner == null ? '' : String(inner);
        if (XSTREAM_COLLECTIONS.has(type)) return '[' + collItems(inner).map(toDisplayString).join(', ') + ']';
        if (XSTREAM_MAPS.has(type)) return formatEntryMap(inner);
        // Object-type wrapper (e.g. <response>, a fully-qualified class) -> recurse.
        if (inner && typeof inner === 'object') return toDisplayString(inner);
        return inner == null ? '' : String(inner);
    }
    if (keys.includes('entry')) return formatEntryMap(v);
    try { return JSON.stringify(v); } catch { return String(v); }
}

/** Unwrap a MapContent value to its <map> node, descending single-key wrappers. */
export function mapNode(mc) {
    let cur = (mc && typeof mc === 'object' && mc.content !== undefined) ? mc.content : mc;
    for (let i = 0; i < 5 && cur && typeof cur === 'object' && cur.entry === undefined; i++) {
        const keys = Object.keys(cur).filter(k => !k.startsWith('@'));
        if (keys.length !== 1) break;
        cur = cur[keys[0]];
    }
    return cur;
}

// One entry node -> [key, value] (value rendered Java-toString style).
function parseMapEntry(entry) {
    const pairs = Object.entries(entry).filter(([k]) => !k.startsWith('@'));
    if (!pairs.length) return null;
    // Two strings collapse to {string:[key,value]}.
    if (pairs.length === 1 && pairs[0][0] === 'string' && Array.isArray(pairs[0][1])) {
        return [String(pairs[0][1][0] ?? ''), toDisplayString(pairs[0][1][1])];
    }
    // First child is the key; the second (with its type wrapper) is the value.
    const k0 = pairs[0];
    const key = (k0[1] && typeof k0[1] === 'object') ? toDisplayString({ [k0[0]]: k0[1] }) : String(k0[1] ?? '');
    const value = pairs.length >= 2 ? toDisplayString({ [pairs[1][0]]: pairs[1][1] }) : '';
    return [key, value];
}

/** [key, value] pairs from a MapContent value, values rendered Java-toString style. */
export function mappingEntries(mc) {
    const node = mapNode(mc);
    if (!node || typeof node !== 'object' || node.entry === undefined) return [];
    const out = [];
    for (const entry of asList(node.entry)) {
        if (!entry || typeof entry !== 'object') continue;
        const pair = parseMapEntry(entry);
        if (pair) out.push(pair);
    }
    return out;
}

/* ---- serialized Response envelope (browser-only; uses DOMParser) -------------
   The Response/Processed-Response content stages store a serialized Response
   object. The Swing browser deserializes it, shows status+statusMessage in the
   banner and Response.getMessage() as the body. */
function directChildText(root, tag) {
    for (const node of root.childNodes) {
        if (node.nodeType === 1 && node.nodeName === tag) return node.textContent || '';
    }
    return '';
}

/** Parse a serialized <response> envelope -> {status, statusMessage, message}, or null. */
export function parseResponse(content) {
    if (typeof content !== 'string' || !/^\s*</.test(content)) return null;
    try {
        const doc = new DOMParser().parseFromString(content, 'text/xml');
        const root = doc.documentElement;
        if (!root || doc.querySelector('parsererror') || root.nodeName !== 'response') return null;
        return {
            status: directChildText(root, 'status'),
            statusMessage: directChildText(root, 'statusMessage'),
            message: directChildText(root, 'message')
        };
    } catch { return null; }
}
