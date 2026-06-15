/*
 * DICOM attachment viewer — web admin plugin (AttachmentViewer equivalent).
 *
 * Full DICOM image rendering needs a DICOM toolkit (e.g. cornerstone) that the
 * web admin doesn't bundle. This viewer does the honest, dependency-free thing:
 * a best-effort parse of the common header tags (explicit VR little-endian, the
 * usual transfer syntax) and a Save action for the raw object.
 */

function typeOf(att) {
    const t = att && att.type;
    return String(typeof t === 'string' ? t : (t && (t._ || t.$)) || '').trim();
}

const WANTED = {
    '0008,0020': 'Study Date',
    '0008,0060': 'Modality',
    '0008,1030': 'Study Description',
    '0010,0010': 'Patient Name',
    '0010,0020': 'Patient ID',
    '0028,0010': 'Rows',
    '0028,0011': 'Columns'
};

/* Minimal explicit-VR little-endian walk over the dataset; returns {tag: value}
   for the WANTED tags. Bails gracefully on anything unexpected. */
function parseDicomTags(bytes) {
    const out = {};
    if (bytes.length < 132) return out;
    // 128-byte preamble + "DICM" magic.
    if (String.fromCharCode(bytes[128], bytes[129], bytes[130], bytes[131]) !== 'DICM') return out;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const dec = new TextDecoder('latin1');
    const longVR = new Set(['OB', 'OW', 'OF', 'SQ', 'UT', 'UN']);
    let off = 132;
    let guard = 0;
    while (off + 8 <= bytes.length && guard++ < 2000) {
        const group = dv.getUint16(off, true);
        const elem = dv.getUint16(off + 2, true);
        const vr = String.fromCharCode(bytes[off + 4], bytes[off + 5]);
        if (!/^[A-Z]{2}$/.test(vr)) break;          // not explicit VR — stop
        let len, valOff;
        if (longVR.has(vr)) {
            len = dv.getUint32(off + 8, true);
            valOff = off + 12;
        } else {
            len = dv.getUint16(off + 6, true);
            valOff = off + 8;
        }
        if (len === 0xFFFFFFFF || valOff + len > bytes.length) break;   // undefined length / overrun
        const tag = group.toString(16).padStart(4, '0') + ',' + elem.toString(16).padStart(4, '0');
        if (WANTED[tag]) {
            out[tag] = (vr === 'US') ? String(dv.getUint16(valOff, true))
                : dec.decode(bytes.subarray(valOff, valOff + len)).replace(/\0+$/, '').trim();
        }
        if (group > 0x0028) break;   // past the header tags we care about; don't walk pixel data
        off = valOff + len;
    }
    return out;
}

export function register(platform) {
    const { h } = platform.ui;

    platform.registerAttachmentViewer({
        id: 'dicomviewer',
        canHandle: (att) => /dicom|dcm/i.test(typeOf(att)),
        render(_body, { attachment, channelId, messageId, platform }) {
            const host = h('div.mt');
            host.appendChild(h('div.faint', { style: { fontSize: '11px', marginBottom: '4px' } }, 'Loading DICOM…'));
            (async () => {
                try {
                    const full = await platform.api.messages.attachment(channelId, messageId, attachment.id);
                    const b64 = String(full?.content ?? '').replace(/\s+/g, '');
                    const bin = atob(b64);
                    const bytes = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

                    let tags = {};
                    try { tags = parseDicomTags(bytes); } catch (e) { /* best-effort */ }

                    const rows = Object.entries(WANTED)
                        .filter(([tag]) => tags[tag] != null && tags[tag] !== '')
                        .map(([tag, label]) => h('tr', h('td', { style: { fontWeight: '600', paddingRight: '16px' } }, label), h('td.mono', tags[tag])));

                    platform.ui.clear(host);
                    host.appendChild(h('div', { style: { fontWeight: '600', marginBottom: '4px' } },
                        `DICOM object — ${bytes.length.toLocaleString()} bytes`));
                    host.appendChild(rows.length
                        ? h('table.dt', h('tbody', rows))
                        : h('div.faint', 'No readable header tags (non explicit-VR transfer syntax).'));
                    host.appendChild(h('div.mt',
                        h('button.btn', {
                            onClick: () => platform.ui.saveFile(`attachment-${attachment.id}.dcm`, 'application/dicom', () => new Blob([bytes], { type: 'application/dicom' }))
                        }, 'Save DICOM')));
                    host.appendChild(h('div.faint', { style: { fontSize: '11px', marginTop: '6px' } },
                        'Inline image rendering requires a DICOM toolkit; save the object to view it in a DICOM viewer.'));
                } catch (e) {
                    platform.ui.clear(host);
                    host.appendChild(h('div.faint', `Could not load DICOM: ${e.message}`));
                }
            })();
            return host;
        }
    });
}
