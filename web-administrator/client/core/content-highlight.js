/*
 * Message content highlighting — XML / JSON / HL7 v2 syntax highlighting and
 * pretty-printing for the message browser, rendered as plain DOM (no build
 * step, air-gapped). Ported from oie-browser's React highlighters.
 *
 * HL7 fields carry a `data-tooltip` naming the field (e.g. "PID-5 · Patient
 * Name"). Names come from the engine's serializer sidecar when available (a
 * nodeName→description map, the same one used by the transformer message tree).
 * Without the sidecar the tooltip degrades to the path only (e.g. "PID-5").
 */

/* ---- helpers ---------------------------------------------------------------- */

export function normalizeLineEndings(s) {
    return String(s == null ? '' : s).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

const span = (cls, text, tooltip) => {
    const el = document.createElement('span');
    el.className = cls;
    el.textContent = text;
    if (tooltip) el.setAttribute('data-tooltip', tooltip);
    return el;
};

/* ---- type detection --------------------------------------------------------- */

export function detectType(text, dataType) {
    const dt = String(dataType || '').toUpperCase();
    if (dt.includes('HL7V2') || dt === 'HL7') return 'hl7v2';
    if (dt === 'XML' || dt.includes('HL7V3')) return 'xml';
    if (dt === 'JSON') return 'json';
    const t = normalizeLineEndings(text).trimStart();
    if (!t) return 'text';
    if (t.startsWith('<')) return 'xml';
    if (t.startsWith('{') || t.startsWith('[')) return 'json';
    // ER7: a 3-char segment name followed by a field separator.
    if (/^MSH[|^]/.test(t) || /^[A-Z][A-Z0-9]{2}[|\r\n]/.test(t)) return 'hl7v2';
    return 'text';
}

/* ---- pretty-print ----------------------------------------------------------- */

export function prettyPrintXml(xml) {
    let indent = 0;
    return String(xml).replace(/>\s*</g, '>\n<').split('\n').map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return '';
        if (trimmed.startsWith('</')) indent = Math.max(0, indent - 1);
        const result = '  '.repeat(indent) + trimmed;
        if (trimmed.startsWith('<') && !trimmed.startsWith('</') && !trimmed.endsWith('/>') && !trimmed.includes('</')) {
            indent++;
        }
        return result;
    }).join('\n');
}

export function prettyPrintJson(json) {
    try { return JSON.stringify(JSON.parse(json), null, 2); } catch { return json; }
}

/* ---- XML highlighter -------------------------------------------------------- */

const XML_RE = /(<!--[\s\S]*?-->)|(<!\[CDATA\[[\s\S]*?\]\]>)|(<\/?)([\w:.!-]+)((?:\s+[\w:.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?>)|([^<]+)/g;
const ATTR_RE = /([\w:.-]+)(\s*=\s*)("[^"]*"|'[^']*')/g;

function pushAttrs(out, attrStr) {
    let last = 0; ATTR_RE.lastIndex = 0; let m;
    while ((m = ATTR_RE.exec(attrStr)) !== null) {
        if (m.index > last) out.push(document.createTextNode(attrStr.slice(last, m.index)));
        out.push(span('tok-xml-attr', m[1]));
        out.push(document.createTextNode(m[2]));
        out.push(span('tok-xml-attrval', m[3]));
        last = m.index + m[0].length;
    }
    if (last < attrStr.length) out.push(document.createTextNode(attrStr.slice(last)));
}

function highlightXml(xml, out) {
    let last = 0; XML_RE.lastIndex = 0; let m;
    while ((m = XML_RE.exec(xml)) !== null) {
        if (m.index > last) out.push(document.createTextNode(xml.slice(last, m.index)));
        const [full, comment, cdata, bracket, tagName, attrs, close, text] = m;
        if (comment) out.push(span('tok-xml-comment', comment));
        else if (cdata) out.push(span('tok-xml-bracket', cdata));
        else if (bracket && tagName) {
            out.push(span('tok-xml-bracket', bracket));
            out.push(span('tok-xml-tag', tagName));
            if (attrs) pushAttrs(out, attrs);
            if (close) out.push(span('tok-xml-bracket', close));
        } else if (text) out.push(document.createTextNode(text));
        else out.push(document.createTextNode(full));
        last = m.index + full.length;
    }
    if (last < xml.length) out.push(document.createTextNode(xml.slice(last)));
}

/* ---- JSON highlighter ------------------------------------------------------- */

const JSON_RE = /("(?:[^"\\]|\\.)*")\s*:|("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b|(true|false|null)\b|([{}[\],:])/g;

function highlightJson(json, out) {
    const lines = json.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (i > 0) out.push(document.createTextNode('\n'));
        const line = lines[i];
        let last = 0; JSON_RE.lastIndex = 0; let m;
        while ((m = JSON_RE.exec(line)) !== null) {
            if (m.index > last) out.push(document.createTextNode(line.slice(last, m.index)));
            const [full, key, str, num, bool, bracket] = m;
            if (key) { out.push(span('tok-json-key', key)); out.push(document.createTextNode(':')); }
            else if (str) out.push(span('tok-json-string', str));
            else if (num) out.push(span('tok-json-number', num));
            else if (bool) out.push(span('tok-json-bool', bool));
            else if (bracket) out.push(span('tok-json-bracket', bracket));
            else out.push(document.createTextNode(full));
            last = m.index + full.length;
        }
        if (last < line.length) out.push(document.createTextNode(line.slice(last)));
    }
}

/* ---- HL7 v2 highlighter ----------------------------------------------------- */

function parseEncodingChars(mshLine) {
    const fieldSep = mshLine.charAt(3) || '|';
    const enc = mshLine.substring(4, 8);
    return {
        fieldSep,
        componentSep: enc.charAt(0) || '^',
        repetitionSep: enc.charAt(1) || '~',
        escapeChar: enc.charAt(2) || '\\',
        subComponentSep: enc.charAt(3) || '&'
    };
}

// Field name from the sidecar descriptions map (by node id like PID.5 / PID.5.1).
// Without the sidecar there's no name — the tooltip falls back to the path.
function hl7Name(seg, field, comp, descriptions) {
    if (descriptions) {
        if (comp > 1 && descriptions[`${seg}.${field}.${comp}`]) return descriptions[`${seg}.${field}.${comp}`];
        if (descriptions[`${seg}.${field}.1`] && comp <= 1) return descriptions[`${seg}.${field}.1`];
        if (descriptions[`${seg}.${field}`]) return descriptions[`${seg}.${field}`];
    }
    return undefined;
}

function hl7Tooltip(seg, field, comp, descriptions) {
    const name = hl7Name(seg, field, comp, descriptions);
    const path = comp > 1 ? `${seg}-${field}.${comp}` : `${seg}-${field}`;
    return name ? `${path} · ${name}` : path;
}

function highlightField(value, seg, field, enc, descriptions, out) {
    const reps = value.split(enc.repetitionSep);
    for (let r = 0; r < reps.length; r++) {
        if (r > 0) out.push(span('tok-hl7-sep', enc.repetitionSep));
        const comps = reps[r].split(enc.componentSep);
        for (let c = 0; c < comps.length; c++) {
            if (c > 0) out.push(span('tok-hl7-sep', enc.componentSep));
            if (!comps[c]) continue;
            const subs = comps[c].split(enc.subComponentSep);
            for (let sc = 0; sc < subs.length; sc++) {
                if (sc > 0) out.push(span('tok-hl7-sep', enc.subComponentSep));
                if (!subs[sc]) continue;
                out.push(span('tok-hl7-field', subs[sc], hl7Tooltip(seg, field, c + 1, descriptions)));
            }
        }
    }
}

function highlightMshLine(line, enc, descriptions, out) {
    out.push(span('tok-hl7-seg', 'MSH'));
    out.push(span('tok-hl7-sep', enc.fieldSep));
    out.push(span('tok-hl7-field', line.substring(4, 8), hl7Tooltip('MSH', 2, 1, descriptions)));
    const rest = line.substring(8);
    if (!rest) return;
    const fields = rest.split(enc.fieldSep);
    for (let i = 0; i < fields.length; i++) {
        if (i > 0 || fields[0] === '') out.push(span('tok-hl7-sep', enc.fieldSep));
        if (i === 0 && fields[0] === '') continue;
        if (!fields[i]) continue;
        highlightField(fields[i], 'MSH', i + 2, enc, descriptions, out);
    }
}

function highlightSegmentLine(line, enc, descriptions, out) {
    const sepIdx = line.indexOf(enc.fieldSep);
    const seg = sepIdx > 0 ? line.substring(0, sepIdx) : line;
    out.push(span('tok-hl7-seg', seg));
    if (sepIdx < 0) return;
    const fields = line.substring(sepIdx + 1).split(enc.fieldSep);
    for (let i = 0; i < fields.length; i++) {
        out.push(span('tok-hl7-sep', enc.fieldSep));
        if (!fields[i]) continue;
        highlightField(fields[i], seg, i + 1, enc, descriptions, out);
    }
}

function highlightHl7(hl7, descriptions, out) {
    const lines = hl7.split('\n');
    const mshLine = lines.find((l) => l.startsWith('MSH'));
    const enc = parseEncodingChars(mshLine || 'MSH|^~\\&');
    for (let i = 0; i < lines.length; i++) {
        if (i > 0) out.push(document.createTextNode('\n'));
        const line = lines[i];
        if (!line.trim()) continue;
        if (line.startsWith('MSH')) highlightMshLine(line, enc, descriptions, out);
        else if (/^[A-Z][A-Z\d]{2}/.test(line)) highlightSegmentLine(line, enc, descriptions, out);
        else out.push(document.createTextNode(line));
    }
}

/* ---- public render ---------------------------------------------------------- */

/**
 * Highlight `text` into the given <pre> element (cleared first).
 *   type        'xml' | 'json' | 'hl7v2' | 'text' (default: auto-detect)
 *   format      pretty-print XML/JSON before highlighting
 *   descriptions HL7 nodeName → field-name map from the sidecar (optional)
 */
export function renderHighlighted(preEl, text, { type, dataType, format = false, descriptions = null } = {}) {
    while (preEl.firstChild) preEl.removeChild(preEl.firstChild);
    let body = normalizeLineEndings(text);
    const kind = type || detectType(body, dataType);
    if (format && kind === 'xml') body = prettyPrintXml(body);
    else if (format && kind === 'json') body = prettyPrintJson(body);

    const out = [];
    if (kind === 'xml') highlightXml(body, out);
    else if (kind === 'json') highlightJson(body, out);
    else if (kind === 'hl7v2') highlightHl7(body, descriptions, out);
    else out.push(document.createTextNode(body));

    const frag = document.createDocumentFragment();
    for (const n of out) frag.appendChild(n);
    preEl.appendChild(frag);
    return kind;
}
