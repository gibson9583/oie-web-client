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
import type { Platform } from '@oie/web-shell';
import dicomParser from 'dicom-parser';
const React = platform.React;

function typeOf(att: any) {
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
const COMPRESSED_NAMES: Record<string, string> = {
    '1.2.840.10008.1.2.5': 'RLE Lossless',
    '1.2.840.10008.1.2.4.57': 'JPEG Lossless',
    '1.2.840.10008.1.2.4.70': 'JPEG Lossless (SV1)',
    '1.2.840.10008.1.2.4.80': 'JPEG-LS Lossless',
    '1.2.840.10008.1.2.4.81': 'JPEG-LS Near-Lossless',
    '1.2.840.10008.1.2.4.90': 'JPEG 2000 Lossless',
    '1.2.840.10008.1.2.4.91': 'JPEG 2000'
};

function first(str: any) {
    // WindowCenter/Width may be multi-valued ("40\\400"); take the first.
    if (str == null || str === '') return null;
    const v = parseFloat(String(str).split('\\')[0]);
    return Number.isFinite(v) ? v : null;
}

/* Pull the image attributes we need for decode + windowing. */
function imageInfo(ds: any) {
    const rows = ds.uint16('x00280010') || 0;
    const cols = ds.uint16('x00280011') || 0;
    const spp = ds.uint16('x00280002') || 1;
    const bitsAllocated = ds.uint16('x00280100') || 8;
    const pixelRepresentation = ds.uint16('x00280103') || 0;      // 1 = signed
    const photometric = (ds.string('x00280004') || 'MONOCHROME2').trim().toUpperCase();
    const planar = ds.uint16('x00280006') || 0;                   // 1 = planar (RRR..GGG..BBB)
    const numFrames = parseInt(ds.intString('x00280008') || '1', 10) || 1;
    // Explicit VR Big Endian: dicom-parser reads header VALUES with its
    // big-endian parser, but raw pixel data stays as stored — a typed-array
    // view over it is host-little-endian, so 16-bit samples must be swapped.
    const bigEndian = (ds.string('x00020010') || '').trim() === '1.2.840.10008.1.2.2';
    const slope = first(ds.string('x00281053')) ?? 1;
    const intercept = first(ds.string('x00281052')) ?? 0;
    const wc = first(ds.string('x00281050'));
    const ww = first(ds.string('x00281051'));
    return { rows, cols, spp, bitsAllocated, pixelRepresentation, photometric, planar, numFrames, slope, intercept, wc, ww, bigEndian };
}

/* Read one uncompressed frame's samples as a typed array (Int16/Uint16/Uint8). */
function readFrame(ds: any, bytes: any, info: any, frame: any) {
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
    if (info.bigEndian) {
        for (let i = 0; i + 1 < slice.length; i += 2) { const t = slice[i]; slice[i] = slice[i + 1]; slice[i + 1] = t; }
    }
    return info.pixelRepresentation ? new Int16Array(slice.buffer) : new Uint16Array(slice.buffer);
}

/* Grayscale render with window/level (+ rescale + MONOCHROME1 inversion). */
function renderGray(canvas: any, raw: any, info: any, wc: any, ww: any) {
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
function renderRGB(canvas: any, raw: any, info: any) {
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
async function drawJpegFrame(canvas: any, ds: any, bytes: any, info: any, frame: any) {
    const el = ds.elements.x7fe00010;
    const frameBytes = dicomParser.readEncapsulatedImageFrame(ds, el, frame);
    const bitmap = await createImageBitmap(new Blob([frameBytes], { type: 'image/jpeg' }));
    canvas.width = bitmap.width || info.cols; canvas.height = bitmap.height || info.rows;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close && bitmap.close();
}

/* Thumbnail strip for multi-frame objects — scanning slices by eye instead of
   stepping a counter. Thumbnails are drawn once per (frame, window) through the
   SAME render path as the main canvas, then scaled down; JPEG frames decode
   asynchronously, so those tiles stay numbered rather than blocking the strip.
   Capped because the cost is linear in frames and a large series would stall
   the pane for a picture the user may not need. */
const THUMB_LIMIT = 64;
const THUMB_PX = 44;

function Filmstrip({ state, frame, win, onPick, expanded }: any) {
    const { ds, bytes, info, kind } = state;
    const stripRef = React.useRef(null as any);
    const drawable = kind === 'raw' && info.numFrames <= THUMB_LIMIT;

    React.useEffect(() => {
        if (!drawable || !stripRef.current) return;
        // One offscreen canvas rendered at full size per frame, then scaled into
        // each tile — reuses renderGray/renderRGB rather than a second decoder.
        const off = document.createElement('canvas');
        const tiles = stripRef.current.querySelectorAll('canvas[data-frame]');
        for (const tile of tiles) {
            const f = Number(tile.getAttribute('data-frame'));
            try {
                const raw = readFrame(ds, bytes, info, f);
                if (!raw) continue;
                if (info.spp >= 3) renderRGB(off, raw, info);
                else if (win) renderGray(off, raw, info, win.c, win.w);
                else continue;
                tile.width = THUMB_PX; tile.height = THUMB_PX;
                const ctx = tile.getContext('2d');
                ctx.clearRect(0, 0, THUMB_PX, THUMB_PX);
                // Letterbox rather than stretch, so slice geometry reads true.
                const scale = Math.min(THUMB_PX / info.cols, THUMB_PX / info.rows);
                const w = info.cols * scale, h = info.rows * scale;
                ctx.drawImage(off, (THUMB_PX - w) / 2, (THUMB_PX - h) / 2, w, h);
            } catch { /* a bad frame just leaves its tile blank */ }
        }
    }, [ds, bytes, info, win, drawable]);

    const frames = [];
    for (let f = 0; f < info.numFrames; f++) frames.push(f);

    return (
        <div ref={stripRef}
            className={expanded
                ? 'flex gap-1.5 overflow-x-auto py-1.5 px-3.5 border-t border-line bg-bg1 flex-none'
                : 'flex gap-1.5 overflow-x-auto py-1.5 px-1 border border-line rounded-[5px] bg-bg1'}>
            {frames.map((f: any) => (
                <button key={f} type="button" title={`Frame ${f + 1}`} aria-label={`Frame ${f + 1}`}
                    aria-pressed={f === frame}
                    onClick={() => onPick(f)}
                    className={f === frame
                        ? 'flex-none w-[46px] h-[46px] rounded-[4px] border-2 border-accent bg-black overflow-hidden p-0 grid place-items-center'
                        : 'flex-none w-[46px] h-[46px] rounded-[4px] border-2 border-transparent bg-black overflow-hidden p-0 grid place-items-center'}>
                    {drawable
                        ? <canvas data-frame={f} width={THUMB_PX} height={THUMB_PX} style={{ display: 'block' }} />
                        : <span className="mono text-[10px] text-text-dim">{f + 1}</span>}
                </button>
            ))}
        </div>
    );
}

export function register(platform: Platform) {

    function DicomViewer({ attachment, channelId, messageId, platform }: any) {
        const [state, setState] = React.useState({ status: 'loading' });
        const [frame, setFrame] = React.useState(0);
        const [win, setWin] = React.useState(null as any);   // { c, w } window center/width
        const [zoom, setZoom] = React.useState(1);
        /* Pan is an offset from the stage centre, in stage pixels, so it stays
           meaningful across zoom changes and stage resizes. */
        const [pan, setPan] = React.useState({ x: 0, y: 0 });
        /* Fit mode re-derives the zoom whenever the stage resizes (splitter drag,
           entering full screen). Any manual zoom/pan drops out of it. */
        /* Fit is OFF inline by default: the viewer used to show the image at
           actual size and let the tab scroll, which reads far better in a short
           detail pane than shrinking a 256px image to 49%. The dialog opens
           fitted, where fitting means filling the screen. */
        const [fitMode, setFitMode] = React.useState(false);
        // Full screen is this SAME component re-classed, not a second viewer: the
        // canvas node and every bit of state above stay mounted, so the frame,
        // zoom and window/level carry across in both directions.
        const [expanded, setExpanded] = React.useState(false);
        const [stageSize, setStageSize] = React.useState({ w: 0, h: 0 });
        /* Whether the metadata column fits BESIDE the image. A viewport
           breakpoint is the wrong signal — the viewer sits in a detail pane
           inset by the nav rail and task pane, so a wide window can still leave
           a narrow pane. Measure the container itself. */
        const [rootWidth, setRootWidth] = React.useState(0);
        const [decodeError, setDecodeError] = React.useState(null as any);   // per-frame JPEG decode failure
        const canvasRef = React.useRef(null as any);
        const stageRef = React.useRef(null as any);
        const rootRef = React.useRef(null as any);

        // The parsed image attributes, read once here so every effect below can
        // depend on them by name rather than reaching back into `state`.
        const info: any = (state as any).info;

        // Re-centre without minting a new object when it is already centred —
        // pan feeds effect dependencies, so a fresh {0,0} per render would loop.
        const resetPan = React.useCallback(
            () => setPan((p: any) => (p.x === 0 && p.y === 0 ? p : { x: 0, y: 0 })), []);

        // Load + parse the object once.
        React.useEffect(() => {
            let cancelled = false;
            setState({ status: 'loading' }); setFrame(0); setWin(null); setZoom(1);
            resetPan(); setFitMode(false); setDecodeError(null);
            (async () => {
                try {
                    // A DICOM attachment holds only the pixel data, so it has no
                    // DICM header on its own. Fetch the REASSEMBLED full DICOM from
                    // the source connector message (Swing getDICOMMessage), not the
                    // raw attachment.
                    const msg = await platform.api.messages.get(channelId, messageId);
                    const entries = platform.api.asList(msg?.connectorMessages?.entry ?? msg?.connectorMessages);
                    const cms = entries.map((e: any) => e.connectorMessage ?? e).filter(Boolean);
                    const cm = cms.find((c: any) => String(c.metaDataId) === '0') || cms[0];
                    if (!cm) throw new Error('no connector message found for this message');
                    const b64 = String(await platform.api.messages.getDicom(channelId, messageId, cm) ?? '').replace(/\s+/g, '');
                    if (!b64) throw new Error('the reassembled DICOM is empty');
                    let bin: any;
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

                    let ds: any;
                    try { ds = dicomParser.parseDicom(bytes); }
                    catch (pe: any) { throw new Error('could not parse the DICOM dataset' + (pe && (pe.message || pe.exception) ? `: ${pe.message || pe.exception}` : '')); }
                    const ts = (ds.string('x00020010') || '').trim();
                    const info = imageInfo(ds);
                    const meta: any = {};
                    for (const [tag] of META) { const v = ds.string(tag); if (v) meta[tag] = v.trim(); }

                    const kind = UNCOMPRESSED.has(ts) ? 'raw'
                        : JPEG_BASELINE.has(ts) ? 'jpeg'
                            : (COMPRESSED_NAMES[ts] ? 'unsupported' : (ds.elements.x7fe00010 && !ds.elements.x7fe00010.encapsulatedPixelData ? 'raw' : 'unsupported'));

                    if (cancelled) return;
                    setWin(info.wc != null && info.ww != null ? { c: info.wc, w: info.ww } : null);
                    setState({ status: 'ready', bytes, ds, ts, info, meta, kind, tsName: COMPRESSED_NAMES[ts] || ts });
                } catch (e: any) {
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
                if (state.kind === 'jpeg') {
                    // A decode failure must not be silent — the user would see a
                    // stale (or blank) canvas with no explanation.
                    setDecodeError(null);
                    drawJpegFrame(cv, state.ds, state.bytes, state.info, frame)
                        .catch((e: any) => setDecodeError(e && e.message ? e.message : 'the browser could not decode this frame'));
                    return;
                }
                if (state.kind !== 'raw') return;
                const raw = readFrame(state.ds, state.bytes, state.info, frame);
                if (!raw) return;
                if (state.info.spp >= 3) renderRGB(cv, raw, state.info);
                else if (win) renderGray(cv, raw, state.info, win.c, win.w);
            } catch { /* render failure → the metadata + Save remain usable */ }
        }, [state.status, frame, win, state.kind]);

        /* ---- stage sizing: Fit needs to know how much room the image has, and
           that changes when the user drags the detail-pane splitter or enters
           full screen. One observer keeps the measurement live. */
        React.useEffect(() => {
            const el = stageRef.current;
            if (!el || typeof ResizeObserver === 'undefined') return undefined;
            const ro = new ResizeObserver((entries: any) => {
                const r = entries[0].contentRect;
                const w = Math.round(r.width), h = Math.round(r.height);
                // Keep the identity when the numbers have not moved: this object
                // feeds the Fit effect's dependencies, and a fresh one per
                // observation would re-run it on every render.
                setStageSize((s: any) => (s.w === w && s.h === h ? s : { w, h }));
            });
            ro.observe(el);
            return () => ro.disconnect();
        }, [state.status]);

        React.useEffect(() => {
            const el = rootRef.current;
            if (!el || typeof ResizeObserver === 'undefined') return undefined;
            const ro = new ResizeObserver((entries: any) => {
                const w = Math.round(entries[0].contentRect.width);
                setRootWidth((prev: any) => (prev === w ? prev : w));
            });
            ro.observe(el);
            return () => ro.disconnect();
        }, [state.status]);

        React.useEffect(() => {
            const el = rowRef.current;
            if (!el || typeof ResizeObserver === 'undefined') return undefined;
            const ro = new ResizeObserver((entries: any) => {
                const w = Math.round(entries[0].contentRect.width);
                setRowWidth((prev: any) => (prev === w ? prev : w));
            });
            ro.observe(el);
            return () => ro.disconnect();
        }, [state.status, expanded]);

        /* Inline height: the viewer has to fit the DETAIL PANE, which is sized by
           the user's splitter and has nothing to do with the viewport (a `vh`
           height looks right on a short window and pushes the image out of sight
           on a tall one). Bound the WHOLE viewer, not just the image: then the
           toolbar takes what it needs, the image row takes the rest as flex-1,
           and the pane never scrolls — scrolling a viewer whose controls are
           pinned above the image just hides the image. */
        const [availH, setAvailH] = React.useState(0);
        const [rowWidth, setRowWidth] = React.useState(0);
        const rowRef = React.useRef(null as any);
        React.useEffect(() => {
            if (expanded || state.status !== 'ready') return undefined;
            const el = rootRef.current;
            if (!el || typeof ResizeObserver === 'undefined') return undefined;
            // Radix gives the tab body role="tabpanel"; that is the element with
            // the real height. Fall back to the nearest scroller elsewhere (the
            // View Attachment modal mounts this same component).
            const host = el.closest('[role="tabpanel"]') || el.closest('.overflow-auto');
            if (!host) return undefined;
            const measure = () => {
                const avail = host.clientHeight;
                if (!avail) return;
                const top = el.getBoundingClientRect().top - host.getBoundingClientRect().top;
                /* Whatever sits BELOW us still costs height — the attachments
                   tab pads its wrapper, and the host would scroll by exactly
                   that much. Sum the ancestors' bottom padding/margin up to the
                   host rather than guessing a constant. */
                let inset = 0;
                for (let n: any = el; n && n.parentElement && n !== host; n = n.parentElement) {
                    inset += parseFloat(getComputedStyle(n).marginBottom) || 0;
                    inset += parseFloat(getComputedStyle(n.parentElement).paddingBottom) || 0;
                }
                const h = Math.max(120, Math.floor(avail - top - inset - 1));
                setAvailH((prev: any) => (prev === h ? prev : h));
            };
            measure();
            // Observe the HOST, not the viewer: observing itself would react to
            // the height this effect just set and oscillate.
            const ro = new ResizeObserver(measure);
            ro.observe(host);
            return () => ro.disconnect();
        }, [expanded, state.status, rootWidth, info]);

        /* Inline the stage is sized to the IMAGE, so it cannot also be the
           measure of the room available — Fit reads the pane instead (the row's
           width, the space the tab has left). Expanded the stage IS the room. */
        const fitZoom = React.useCallback(() => {
            if (!info || !info.cols || !info.rows) return 1;
            const w = expanded ? stageSize.w : rowWidth;
            const h = expanded ? stageSize.h : availH;
            if (!w || !h) return 1;
            return Math.min(w / info.cols, h / info.rows);
        }, [info, expanded, stageSize.w, stageSize.h, rowWidth, availH]);

        // While in fit mode the zoom tracks the stage; a manual zoom/pan leaves it.
        React.useEffect(() => {
            if (!fitMode || state.status !== 'ready') return;
            setZoom(fitZoom());
            resetPan();
        }, [fitMode, fitZoom, state.status, resetPan]);

        const fit = () => { setFitMode(true); };
        const actual = () => { setFitMode(false); setZoom(1); resetPan(); };
        const clampZoom = (z: any) => Math.max(0.05, Math.min(40, z));

        /* Zoom about a point (cursor or stage centre): the image coordinate under
           that point must not move, which fixes the new pan. */
        const zoomAt = (nextZoom: any, sx: any, sy: any) => {
            const z = clampZoom(nextZoom);
            setPan((p: any) => ({
                x: sx - ((sx - p.x) / zoom) * z,
                y: sy - ((sy - p.y) / zoom) * z
            }));
            setFitMode(false);
            setZoom(z);
        };
        const zoomStep = (factor: any) => zoomAt(zoom * factor, 0, 0);

        const onWheel = (e: any) => {
            if (state.status !== 'ready') return;
            e.preventDefault();
            const box = stageRef.current.getBoundingClientRect();
            // Cursor position relative to the stage CENTRE (pan's frame of reference).
            const sx = e.clientX - box.left - box.width / 2;
            const sy = e.clientY - box.top - box.height / 2;
            zoomAt(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), sx, sy);
        };

        /* Drag: window/level on a grayscale image (the clinical default), pan with
           Shift held — and pan unconditionally when there is no window to adjust
           (RGB, or a JPEG frame the browser decoded for us). */
        const grayscaleDrag = state.status === 'ready' && state.kind === 'raw' && info && info.spp < 3 && !!win;
        const onPointerDown = (e: any) => {
            if (state.status !== 'ready' || e.button !== 0) return;
            const panning = e.shiftKey || !grayscaleDrag;
            const startX = e.clientX, startY = e.clientY;
            const start = panning ? { ...pan } : { ...win };
            // Sensitivity scales with the current window, so a narrow window stays
            // controllable and a wide one does not take a hundred drags to cross.
            const sens = Math.max(1, (win ? win.w : 256)) / 256;
            e.currentTarget.setPointerCapture(e.pointerId);
            const move = (ev: any) => {
                const dx = ev.clientX - startX, dy = ev.clientY - startY;
                if (panning) {
                    setPan({ x: (start as any).x + dx, y: (start as any).y + dy });
                    setFitMode(false);
                } else {
                    setWin({
                        w: Math.max(1, (start as any).w + dx * sens * 2),
                        c: (start as any).c + dy * sens * 2
                    });
                }
            };
            const up = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
        };

        // Auto window/level from the frame's own min/max (the load-time default).
        const autoWindow = () => {
            if (!info || state.kind !== 'raw') return;
            const raw = readFrame((state as any).ds, (state as any).bytes, info, frame);
            if (!raw) return;
            let min = Infinity, max = -Infinity;
            for (let i = 0; i < raw.length; i++) { const v = raw[i]; if (v < min) min = v; if (v > max) max = v; }
            min = min * info.slope + info.intercept; max = max * info.slope + info.intercept;
            setWin({ c: (min + max) / 2, w: Math.max(1, max - min) });
        };

        const frameCount = info ? info.numFrames : 1;
        const stepFrame = (d: any) => setFrame((f: any) => Math.max(0, Math.min(frameCount - 1, f + d)));

        /* Keys: arrows walk frames, Esc leaves full screen. Bound on the document
           while expanded (the overlay owns the screen, so focus may be anywhere)
           and on the container otherwise. Typing in a slider is left alone. */
        const onKeyDown = (e: any) => {
            const tag = e.target && e.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            if (e.key === 'ArrowLeft') { e.preventDefault(); stepFrame(-1); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); stepFrame(1); }
            else if (e.key === 'Escape' && expanded) { e.preventDefault(); setExpanded(false); }
        };
        React.useEffect(() => {
            if (!expanded) return undefined;
            const onDocKey = (e: any) => {
                if (e.key === 'Escape') { setExpanded(false); return; }
                onKeyDown(e);
            };
            document.addEventListener('keydown', onDocKey);
            return () => document.removeEventListener('keydown', onDocKey);
        });

        if (state.status === 'loading') {
            return <div className="mt-[13px]"><div className="text-text-faint text-[10px]">Loading DICOM…</div></div>;
        }
        if (state.status === 'error') {
            return <div className="mt-[13px]"><div className="text-text-faint">{`Could not load DICOM: ${state.message}`}</div></div>;
        }

        // `info` is already in scope (the gesture handlers above need it before
        // this point), so it is deliberately not re-destructured here.
        const { bytes, meta, kind, tsName } = state as any;
        const renders = kind === 'raw' || kind === 'jpeg';
        const grayscale = kind === 'raw' && info.spp < 3;

        const saveDicom = () => platform.ui.saveFile(
            `attachment-${attachment.id}.dcm`, 'application/dicom',
            () => new Blob([bytes], { type: 'application/dicom' }));

        const metaRows = META.filter(([tag]) => meta[tag]).map(([tag, label]) => (
            <tr key={tag}><td className="font-semibold pr-4">{label}</td><td className="mono">{meta[tag]}</td></tr>
        ));

        const title = `DICOM object — ${info.cols}×${info.rows}`
            + `${info.numFrames > 1 ? `, ${info.numFrames} frames` : ''} — ${bytes.length.toLocaleString()} bytes`;

        /* Full screen re-classes THIS container — the stage, canvas and controls
           below are the same nodes either way, which is what lets the view carry
           its zoom/window/frame across the transition. Expanded it wears the
           app's own dialog chrome (.modal-overlay / .modal / .modal-header /
           .modal-foot), so it reads and behaves like every other modal here
           rather than as a bespoke overlay. */
        // No top margin inline: the host already pads the attachments tab, and
        // in a squeezed pane every pixel above the image costs image.
        const rootCls = expanded
            ? 'modal flex flex-col'
            : 'flex flex-col gap-1.5';

        const toolbar = (
            /* NEVER wraps: a second toolbar row steals ~35px from the image in a
               pane that has little to spare, and it made the height below the
               toolbar unpredictable. Too narrow to fit, the toolbar scrolls
               sideways instead. */
            <div className="flex items-center gap-3 flex-nowrap overflow-x-auto text-[11px] py-1.5 px-2 bg-bg1 border border-line rounded-[5px]">
                {/* Inline, the object's size rides in the toolbar rather than on
                    a caption line of its own — that row is worth more as image
                    in a short pane. Expanded, the dialog title carries it. */}
                {!expanded && (
                    <span className="mono text-text-faint whitespace-nowrap">
                        {`${info.cols}×${info.rows}`}
                    </span>
                )}
                {info.numFrames > 1 && (
                    <span className="inline-flex items-center gap-1.5">
                        <button className="btn btn-sm" title="Previous frame (←)"
                            disabled={frame <= 0} onClick={() => stepFrame(-1)}>‹</button>
                        <span className="mono">{`Frame ${frame + 1} / ${info.numFrames}`}</span>
                        <button className="btn btn-sm" title="Next frame (→)"
                            disabled={frame >= info.numFrames - 1} onClick={() => stepFrame(1)}>›</button>
                    </span>
                )}
                <span className="inline-flex items-center gap-1.5">
                    <span className="text-text-faint">Zoom</span>
                    <button className="btn btn-sm" title="Zoom out" onClick={() => zoomStep(1 / 1.25)}>−</button>
                    <span className="mono w-[42px] text-center">{`${Math.round(zoom * 100)}%`}</span>
                    <button className="btn btn-sm" title="Zoom in" onClick={() => zoomStep(1.25)}>+</button>
                    <button className={fitMode ? 'btn btn-sm btn-primary' : 'btn btn-sm'}
                        title="Fit the image to the pane" onClick={fit}>Fit</button>
                    <button className="btn btn-sm" title="Show at actual size" onClick={actual}>1:1</button>
                </span>
                {grayscale && win && (
                    <span className="inline-flex items-center gap-1.5">
                        <span className="text-text-faint">Level</span>
                        <input type="range" aria-label="Level"
                            min={info.intercept} max={info.intercept + 4096 * info.slope} step="1"
                            value={win.c} onChange={(e: any) => setWin((w: any) => ({ ...w, c: parseFloat(e.target.value) }))} />
                        <span className="text-text-faint">Window</span>
                        <input type="range" aria-label="Window"
                            min="1" max={Math.max(2, 4096 * info.slope)} step="1"
                            value={win.w} onChange={(e: any) => setWin((w: any) => ({ ...w, w: parseFloat(e.target.value) }))} />
                        <button className="btn btn-sm" title="Window/level from this frame's own range"
                            onClick={autoWindow}>Auto</button>
                    </span>
                )}
                <span className="flex-1" />
                {/* The hint is the first thing to go: it is the only optional
                    item here, and letting it wrap the toolbar onto a second row
                    costs the image ~30px of height in an already short pane. */}
                {(expanded || rootWidth >= 1400) && (
                    <span className="text-text-faint whitespace-nowrap">
                        {grayscaleDrag ? 'drag = level/window · shift-drag = pan · wheel = zoom' : 'drag = pan · wheel = zoom'}
                    </span>
                )}
                {/* Expanded, the dialog's own header ✕ and footer Close own
                    dismissal — a third exit in the toolbar just competes. */}
                {!expanded && (
                    <>
                        <button className="btn btn-sm" title="Open full screen"
                            onClick={() => setExpanded(true)}>⤢ Full Screen</button>
                        <button className="btn btn-sm" onClick={saveDicom}>Save DICOM</button>
                    </>
                )}
            </div>
        );

        /* The image surface. Panning/zooming happens on the wrapper (overflow
           hidden) rather than a scroll box, so a drag can mean window/level
           without the browser scrolling underneath it. */
        /* Inline, the stage takes the IMAGE's own aspect rather than the pane's.
           Spanning the full width put a square image in a 6:1 black letterbox
           with vast empty margins — the dialog looks right precisely because its
           stage is close to the image's shape. Height is definite (the row), so
           aspect-ratio resolves the width; max-w-full keeps a very wide object
           from overflowing, in which case it letterboxes vertically instead.
           Expanded, the stage keeps taking all the room the dialog has.
           flex-1/min-w-0 is load-bearing where used: the canvas is absolutely
           positioned, so it lends the stage no intrinsic width. */
        const stage = (
            <div ref={stageRef}
                className={expanded
                    ? 'relative flex-1 min-w-0 min-h-0 overflow-hidden bg-black touch-none'
                    : 'relative flex-none overflow-hidden bg-black border border-line rounded-[5px] touch-none'}
                style={{
                    cursor: grayscaleDrag ? 'crosshair' : 'grab',
                    /* Inline the box is the IMAGE at the current zoom — the
                       pre-branch behaviour, which showed a 256px object at 256px
                       and let the tab scroll, rather than shrinking it to fit a
                       short pane. Capped so a large series cannot run away with
                       the page; past the cap, drag pans. */
                    ...(expanded ? null : {
                        width: `${Math.round(info.cols * zoom)}px`,
                        height: `${Math.round(info.rows * zoom)}px`,
                        maxWidth: '100%',
                        maxHeight: '60vh'
                    })
                }}
                onWheel={onWheel} onPointerDown={onPointerDown}
                onDoubleClick={() => (fitMode ? actual() : fit())}>
                <canvas ref={canvasRef}
                    style={{
                        position: 'absolute', left: '50%', top: '50%',
                        transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                        imageRendering: 'pixelated', display: 'block'
                    }} />
            </div>
        );

        // 620px is the point below which a 210px column would squeeze the image
        // more than the header is worth; below it the table follows the image.
        const metaBeside = metaRows.length > 0 && (expanded || rootWidth >= 620);
        // h-full + overflow-auto: the header table must scroll inside the row
        // rather than stretch it, which would push the image out of the pane.
        const metaPanel = metaBeside ? (
            /* Inline it takes the width the image no longer claims (capped, so
               the rows do not stretch into a sparse band on a wide pane). */
            <div className={expanded
                ? 'w-[250px] flex-none overflow-auto border-l border-line bg-pane-bg'
                : 'flex-1 min-w-0 max-w-[420px] h-full overflow-auto'}>
                <table className="dt w-full"><tbody>{metaRows}</tbody></table>
            </div>
        ) : null;

        const viewer = (
            <div ref={rootRef} className={rootCls} tabIndex={0} onKeyDown={onKeyDown}
                /* .modal is 560px wide by default — right for a form, far too
                   small for an image, so this one takes the viewport. */
                style={expanded
                    ? { width: 'calc(100vw - 40px)', height: 'calc(100vh - 40px)', maxHeight: 'none' }
                    : undefined}
                {...(expanded ? { role: 'dialog', 'aria-modal': true, 'aria-label': title } : null)}>
                {/* Only the dialog gets a heading; inline, the toolbar carries
                    the dimensions and every spare pixel goes to the image. */}
                <div className={expanded ? 'modal-header' : 'hidden'}>
                    <span>{title}</span>
                    {expanded && (
                        <button className="icon-btn" title="Close (Esc)" aria-label="Close"
                            onClick={() => setExpanded(false)}>✕</button>
                    )}
                </div>

                <div className={expanded ? 'px-3.5 pt-2.5 flex-none' : 'flex-none'}>{toolbar}</div>

                {renders ? (
                    /* The image row takes whatever the toolbar left over, in
                       both modes — nothing here is a fixed height. */
                    <div ref={rowRef}
                        className={expanded ? 'flex flex-1 min-h-0' : 'flex gap-2 items-start'}>
                        {stage}
                        {metaPanel}
                    </div>
                ) : (
                    <div className={expanded ? 'p-3.5 flex-1 overflow-auto' : ''}>
                        <div className="text-text-faint text-[11px]">
                            {`This DICOM object uses a compressed transfer syntax (${tsName}). Inline preview currently supports uncompressed and JPEG DICOM — click Save DICOM to open it in a full viewer.`}
                        </div>
                        {metaRows.length > 0 && <table className="dt mt-[13px]"><tbody>{metaRows}</tbody></table>}
                    </div>
                )}

                {decodeError && (
                    <div className={expanded ? 'text-text-faint text-[11px] px-3.5 py-1.5 flex-none' : 'text-text-faint text-[11px]'}>
                        {`Could not decode this JPEG frame: ${decodeError}`}
                    </div>
                )}

                {/* Multi-frame only: picking a slice by eye beats stepping a counter. */}
                {renders && info.numFrames > 1 && (
                    <Filmstrip state={state} frame={frame} win={win} onPick={setFrame} expanded={expanded} />
                )}

                {/* Too narrow for a column beside the image: the table follows it. */}
                {renders && metaRows.length > 0 && !metaBeside && (
                    <table className="dt self-start"><tbody>{metaRows}</tbody></table>
                )}

                {expanded && (
                    <div className="modal-foot">
                        <button className="btn" onClick={saveDicom}>Save DICOM</button>
                        <button className="btn btn-primary" onClick={() => setExpanded(false)}>Close</button>
                    </div>
                )}
            </div>
        );

        /* Expanded, the viewer sits on the app's dialog scrim; clicking the
           scrim closes it, as it does for every other modal here.

           The wrapper is ALWAYS rendered and only changes class — `contents`
           makes it invisible to layout inline. Returning two different tree
           shapes would make React rebuild the subtree on every toggle, which
           throws away the canvas (with the pixels already drawn on it) and
           leaves the ResizeObserver watching a detached node — the viewer came
           up blank at 100%. One stable tree is what lets the image, zoom and
           window/level survive the transition. */
        return (
            <div className={expanded ? 'modal-overlay' : 'contents'}
                onMouseDown={expanded
                    ? (e: any) => { if (e.target === e.currentTarget) setExpanded(false); }
                    : undefined}>
                {viewer}
            </div>
        );
    }

    platform.registerAttachmentViewer({
        id: 'dicomviewer',
        // Reassembles the WHOLE message DICOM, so render once for all of a
        // message's pixel-data attachments (Swing DICOMViewer.handleMultiple).
        handleMultiple: true,
        canHandle: (att: any) => /dicom|dcm/i.test(typeOf(att)),
        component: DicomViewer
    });
}
