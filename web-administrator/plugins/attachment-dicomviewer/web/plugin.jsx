/*
 * DICOM attachment viewer — web admin plugin (AttachmentViewer equivalent, React).
 *
 * Renders DICOM images inline the way the Swing client does (ImageJ): window/level,
 * multi-frame navigation, zoom, and Save. Parsing is dicom-parser (the same parser
 * Cornerstone's current image loader ships); the pixel→canvas render is first-party
 * (no WebGL engine). Uncompressed (Implicit/Explicit VR LE, 8/16-bit, MONOCHROME1/2
 * and RGB) and JPEG Baseline/Extended (decoded natively by the browser) render here;
 * other compressed transfer syntaxes (JPEG 2000, JPEG-LS, JPEG Lossless, RLE) are
 * detected and reported, with metadata + Save — the codecs load lazily in a follow-up.
 *
 * Authored in JSX against the host's React (platform.React). The registry holds a
 * `component` that receives { attachment, channelId, messageId, platform } as props.
 */
import { platform } from '@oie/web-shell';
import dicomParser from 'dicom-parser';
const React = platform.React;

function typeOf(att) {
    const t = att && att.type;
    return String(typeof t === 'string' ? t : (t && (t._ || t.$)) || '').trim();
}

/* Header tags surfaced in the metadata table (dicom-parser tag form: xGGGGEEEE). */
const META = [
    ['x00100010', 'Patient Name'], ['x00100020', 'Patient ID'],
    ['x00080060', 'Modality'], ['x00080020', 'Study Date'], ['x00081030', 'Study Description'],
    ['x00280010', 'Rows'], ['x00280011', 'Columns']
];

/* Transfer-syntax UIDs → capability. Uncompressed we render directly; JPEG
   baseline/extended the browser decodes; the rest are named-but-unsupported (yet). */
const UNCOMPRESSED = new Set(['1.2.840.10008.1.2', '1.2.840.10008.1.2.1', '1.2.840.10008.1.2.2']);
const JPEG_BASELINE = new Set(['1.2.840.10008.1.2.4.50', '1.2.840.10008.1.2.4.51']);
const COMPRESSED_NAMES = {
    '1.2.840.10008.1.2.5': 'RLE Lossless',
    '1.2.840.10008.1.2.4.57': 'JPEG Lossless',
    '1.2.840.10008.1.2.4.70': 'JPEG Lossless (SV1)',
    '1.2.840.10008.1.2.4.80': 'JPEG-LS Lossless',
    '1.2.840.10008.1.2.4.81': 'JPEG-LS Near-Lossless',
    '1.2.840.10008.1.2.4.90': 'JPEG 2000 Lossless',
    '1.2.840.10008.1.2.4.91': 'JPEG 2000'
};

function first(str) {
    // WindowCenter/Width may be multi-valued ("40\\400"); take the first.
    if (str == null || str === '') return null;
    const v = parseFloat(String(str).split('\\')[0]);
    return Number.isFinite(v) ? v : null;
}

/* Pull the image attributes we need for decode + windowing. */
function imageInfo(ds) {
    const rows = ds.uint16('x00280010') || 0;
    const cols = ds.uint16('x00280011') || 0;
    const spp = ds.uint16('x00280002') || 1;
    const bitsAllocated = ds.uint16('x00280100') || 8;
    const pixelRepresentation = ds.uint16('x00280103') || 0;      // 1 = signed
    const photometric = (ds.string('x00280004') || 'MONOCHROME2').trim().toUpperCase();
    const planar = ds.uint16('x00280006') || 0;                   // 1 = planar (RRR..GGG..BBB)
    const numFrames = parseInt(ds.intString('x00280008') || '1', 10) || 1;
    const slope = first(ds.string('x00281053')) ?? 1;
    const intercept = first(ds.string('x00281052')) ?? 0;
    const wc = first(ds.string('x00281050'));
    const ww = first(ds.string('x00281051'));
    return { rows, cols, spp, bitsAllocated, pixelRepresentation, photometric, planar, numFrames, slope, intercept, wc, ww };
}

/* Read one uncompressed frame's samples as a typed array (Int16/Uint16/Uint8). */
function readFrame(ds, bytes, info, frame) {
    const el = ds.elements.x7fe00010;
    if (!el) return null;
    const perPixel = info.spp;
    const pixels = info.rows * info.cols * perPixel;
    const bytesPer = info.bitsAllocated <= 8 ? 1 : 2;
    const frameBytes = pixels * bytesPer;
    const start = el.dataOffset + frame * frameBytes;
    if (start + frameBytes > bytes.length) return null;
    // Copy so the typed-array view is 0-aligned (pixel data may sit at an odd offset).
    const slice = bytes.slice(start, start + frameBytes);
    if (bytesPer === 1) return new Uint8Array(slice.buffer);
    return info.pixelRepresentation ? new Int16Array(slice.buffer) : new Uint16Array(slice.buffer);
}

/* Grayscale render with window/level (+ rescale + MONOCHROME1 inversion). */
function renderGray(canvas, raw, info, wc, ww) {
    const { rows, cols, slope, intercept, photometric } = info;
    const img = canvas.getContext('2d').createImageData(cols, rows);
    const data = img.data;
    const lower = wc - ww / 2;
    const range = ww <= 0 ? 1 : ww;
    const invert = photometric === 'MONOCHROME1';
    for (let i = 0; i < rows * cols; i++) {
        const v = raw[i] * slope + intercept;
        let g = ((v - lower) / range) * 255;
        g = g < 0 ? 0 : g > 255 ? 255 : g;
        if (invert) g = 255 - g;
        const o = i * 4;
        data[o] = data[o + 1] = data[o + 2] = g;
        data[o + 3] = 255;
    }
    canvas.width = cols; canvas.height = rows;
    canvas.getContext('2d').putImageData(img, 0, 0);
}

/* RGB render (8-bit, interleaved or planar). */
function renderRGB(canvas, raw, info) {
    const { rows, cols, planar } = info;
    const n = rows * cols;
    const img = canvas.getContext('2d').createImageData(cols, rows);
    const data = img.data;
    for (let i = 0; i < n; i++) {
        const o = i * 4;
        if (planar) { data[o] = raw[i]; data[o + 1] = raw[n + i]; data[o + 2] = raw[2 * n + i]; }
        else { data[o] = raw[i * 3]; data[o + 1] = raw[i * 3 + 1]; data[o + 2] = raw[i * 3 + 2]; }
        data[o + 3] = 255;
    }
    canvas.width = cols; canvas.height = rows;
    canvas.getContext('2d').putImageData(img, 0, 0);
}

/* Extract encapsulated JPEG frame bytes and let the browser decode + draw it. */
async function drawJpegFrame(canvas, ds, bytes, info, frame) {
    const el = ds.elements.x7fe00010;
    const frameBytes = dicomParser.readEncapsulatedImageFrame(ds, el, frame);
    const bitmap = await createImageBitmap(new Blob([frameBytes], { type: 'image/jpeg' }));
    canvas.width = bitmap.width || info.cols; canvas.height = bitmap.height || info.rows;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close && bitmap.close();
}

export function register(platform) {

    function DicomViewer({ attachment, channelId, messageId, platform }) {
        const [state, setState] = React.useState({ status: 'loading' });
        const [frame, setFrame] = React.useState(0);
        const [win, setWin] = React.useState(null);   // { c, w } window center/width
        const [zoom, setZoom] = React.useState(1);
        const canvasRef = React.useRef(null);

        // Load + parse the object once.
        React.useEffect(() => {
            let cancelled = false;
            setState({ status: 'loading' }); setFrame(0); setWin(null); setZoom(1);
            (async () => {
                try {
                    const full = await platform.api.messages.attachment(channelId, messageId, attachment.id);
                    const b64 = String(full?.content ?? full?.attachment?.content ?? '').replace(/\s+/g, '');
                    if (!b64) throw new Error('the attachment has no content');
                    let bin;
                    try { bin = atob(b64); } catch { throw new Error('the attachment content is not valid Base64'); }
                    const bytes = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

                    // Require the DICOM P10 preamble + "DICM" magic so a mangled /
                    // non-DICOM attachment gives a clear message instead of a raw
                    // parser throw (dicom-parser throws bare objects, not Errors).
                    if (bytes.length < 132 ||
                        String.fromCharCode(bytes[128], bytes[129], bytes[130], bytes[131]) !== 'DICM') {
                        throw new Error('not a valid DICOM object (missing the DICM header) — the message content may not be raw binary DICOM');
                    }

                    let ds;
                    try { ds = dicomParser.parseDicom(bytes); }
                    catch (pe) { throw new Error('could not parse the DICOM dataset' + (pe && (pe.message || pe.exception) ? `: ${pe.message || pe.exception}` : '')); }
                    const ts = (ds.string('x00020010') || '').trim();
                    const info = imageInfo(ds);
                    const meta = {};
                    for (const [tag] of META) { const v = ds.string(tag); if (v) meta[tag] = v.trim(); }

                    const kind = UNCOMPRESSED.has(ts) ? 'raw'
                        : JPEG_BASELINE.has(ts) ? 'jpeg'
                            : (COMPRESSED_NAMES[ts] ? 'unsupported' : (ds.elements.x7fe00010 && !ds.elements.x7fe00010.encapsulatedPixelData ? 'raw' : 'unsupported'));

                    if (cancelled) return;
                    setWin(info.wc != null && info.ww != null ? { c: info.wc, w: info.ww } : null);
                    setState({ status: 'ready', bytes, ds, ts, info, meta, kind, tsName: COMPRESSED_NAMES[ts] || ts });
                } catch (e) {
                    if (!cancelled) setState({ status: 'error', message: e.message });
                }
            })();
            return () => { cancelled = true; };
        }, [channelId, messageId, attachment.id]);

        // Compute a default window from the frame if the header carried none.
        React.useEffect(() => {
            if (state.status !== 'ready' || state.kind !== 'raw' || win || state.info.spp > 1) return;
            const raw = readFrame(state.ds, state.bytes, state.info, frame);
            if (!raw) return;
            let min = Infinity, max = -Infinity;
            for (let i = 0; i < raw.length; i++) { const v = raw[i]; if (v < min) min = v; if (v > max) max = v; }
            const s = state.info.slope, ic = state.info.intercept;
            min = min * s + ic; max = max * s + ic;
            setWin({ c: (min + max) / 2, w: Math.max(1, max - min) });
        }, [state.status, frame, win]);

        // Draw the current frame whenever inputs change.
        React.useEffect(() => {
            if (state.status !== 'ready' || !canvasRef.current) return;
            const cv = canvasRef.current;
            try {
                if (state.kind === 'jpeg') { drawJpegFrame(cv, state.ds, state.bytes, state.info, frame).catch(() => {}); return; }
                if (state.kind !== 'raw') return;
                const raw = readFrame(state.ds, state.bytes, state.info, frame);
                if (!raw) return;
                if (state.info.spp >= 3) renderRGB(cv, raw, state.info);
                else if (win) renderGray(cv, raw, state.info, win.c, win.w);
            } catch { /* render failure → the metadata + Save remain usable */ }
        }, [state.status, frame, win, state.kind]);

        if (state.status === 'loading') {
            return <div className="mt-[14px]"><div className="text-text-faint text-[11px]">Loading DICOM…</div></div>;
        }
        if (state.status === 'error') {
            return <div className="mt-[14px]"><div className="text-text-faint">{`Could not load DICOM: ${state.message}`}</div></div>;
        }

        const { bytes, info, meta, kind, tsName } = state;
        const renders = kind === 'raw' || kind === 'jpeg';
        const grayscale = kind === 'raw' && info.spp < 3;

        const saveDicom = () => platform.ui.saveFile(
            `attachment-${attachment.id}.dcm`, 'application/dicom',
            () => new Blob([bytes], { type: 'application/dicom' }));

        const metaRows = META.filter(([tag]) => meta[tag]).map(([tag, label]) => (
            <tr key={tag}><td className="font-semibold pr-4">{label}</td><td className="mono">{meta[tag]}</td></tr>
        ));

        return (
            <div className="mt-[14px] flex flex-col gap-3">
                <div className="font-semibold">
                    {`DICOM object — ${info.cols}×${info.rows}${info.numFrames > 1 ? `, ${info.numFrames} frames` : ''} — ${bytes.length.toLocaleString()} bytes`}
                </div>

                {renders ? (
                    <div className="flex flex-col gap-2">
                        <div className="border border-line rounded-[6px] bg-black inline-block overflow-auto max-h-[60vh] max-w-full self-start">
                            <canvas ref={canvasRef}
                                style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', imageRendering: 'pixelated', display: 'block' }} />
                        </div>
                        <div className="flex items-center gap-4 flex-wrap text-[12px]">
                            {info.numFrames > 1 && (
                                <span className="inline-flex items-center gap-1.5">
                                    <button className="btn btn-sm" disabled={frame <= 0} onClick={() => setFrame(f => Math.max(0, f - 1))}>‹</button>
                                    <span className="mono">{`Frame ${frame + 1} / ${info.numFrames}`}</span>
                                    <button className="btn btn-sm" disabled={frame >= info.numFrames - 1} onClick={() => setFrame(f => Math.min(info.numFrames - 1, f + 1))}>›</button>
                                </span>
                            )}
                            <span className="inline-flex items-center gap-1.5">
                                <span className="text-text-faint">Zoom</span>
                                <input type="range" min="0.25" max="8" step="0.25" value={zoom} onChange={e => setZoom(parseFloat(e.target.value))} />
                                <span className="mono w-[42px]">{`${Math.round(zoom * 100)}%`}</span>
                            </span>
                            {grayscale && win && (
                                <>
                                    <span className="inline-flex items-center gap-1.5">
                                        <span className="text-text-faint">Level</span>
                                        <input type="range" min={info.intercept} max={info.intercept + 4096 * info.slope} step="1"
                                            value={win.c} onChange={e => setWin(w => ({ ...w, c: parseFloat(e.target.value) }))} />
                                    </span>
                                    <span className="inline-flex items-center gap-1.5">
                                        <span className="text-text-faint">Window</span>
                                        <input type="range" min="1" max={Math.max(2, 4096 * info.slope)} step="1"
                                            value={win.w} onChange={e => setWin(w => ({ ...w, w: parseFloat(e.target.value) }))} />
                                    </span>
                                </>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="text-text-faint text-[12px]">
                        {`This DICOM object uses a compressed transfer syntax (${tsName}). Inline preview currently supports uncompressed and JPEG DICOM — click Save DICOM to open it in a full viewer.`}
                    </div>
                )}

                {metaRows.length > 0 && <table className="dt self-start"><tbody>{metaRows}</tbody></table>}

                <div><button className="btn" onClick={saveDicom}>Save DICOM</button></div>
            </div>
        );
    }

    platform.registerAttachmentViewer({
        id: 'dicomviewer',
        canHandle: (att) => /dicom|dcm/i.test(typeOf(att)),
        component: DicomViewer
    });
}
