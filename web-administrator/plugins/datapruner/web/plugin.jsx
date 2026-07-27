/*
 * Data Pruner — web admin plugin (SettingsPanelPlugin equivalent, React).
 *
 * Registers a "Data Pruner" tab in Settings through platform.registerSettingsPanel
 * (the same hook a third-party settings panel would use), instead of being a
 * privileged core Settings tab. Talks to the engine's datapruner extension:
 *   GET /extensions/datapruner/status, POST _start / _stop, and the plugin's
 *   "Data Pruner" properties.
 *
 * Authored in JSX against the host's React (platform.React) so the plugin
 * component shares the app's single React instance. The data-fetch +
 * XStream/PollConnectorProperties round-trip logic is the same as the original
 * imperative plugin; only the rendering became React/JSX. The registry now holds
 * a `component` that receives the same ctx the old render(host, ctx) got —
 * { platform, setTasks } — as PROPS and returns JSX.
 *
 * Tasks: the component declares its task pane through the ctx.setTasks(title,
 * items) callback (the same callback the imperative panel used), called from an
 * effect once load() resolves and again whenever the bound handlers change. The
 * task items are still legacy DOM taskButton() nodes — the Settings view's
 * TasksPane mounts those DOM nodes into the rail's .taskbar, so the contract is
 * unchanged from the imperative version.
 */
import { platform } from '@oie/web-shell';
const React = platform.React;

const PRUNER_STATUS_ORDER = ['currentState', 'currentProcess', 'lastProcess', 'nextProcess', 'isRunning'];

/* ---- XStream sub-document (pollingProperties / archiverOptions) helpers ----
   Both properties are XStream-serialized objects stored as XML strings. We parse
   each into a DOM, mutate ONLY the direct-child elements we expose, and re-serialize.
   Every untouched child element (pollOnStart, pollConnectorPropertiesAdvanced, and
   any unknown/plugin-added field) round-trips verbatim. */

function childEl(root, name) {
    if (!root) return null;
    for (const c of root.children) if (c.tagName === name) return c;
    return null;
}
// value null/undefined -> remove element (represents a null field); otherwise
// create-or-update the element's text (empty string yields an empty element,
// matching how the Swing panel always writes String fields such as rootFolder).
function setChild(doc, root, name, value) {
    let el = childEl(root, name);
    if (value === null || value === undefined) {
        if (el) root.removeChild(el);
        return;
    }
    if (!el) { el = doc.createElement(name); root.appendChild(el); }
    el.textContent = String(value);
}
const elText = (el) => (el ? el.textContent : '');
const elBool = (el) => (el ? (el.textContent || '').trim() === 'true' : false);

const UNIT_MS = { milliseconds: 1, seconds: 1000, minutes: 60000, hours: 3600000 };
function msToFreq(ms) {
    if (ms > 0 && ms % 3600000 === 0) return { val: ms / 3600000, unit: 'hours' };
    if (ms > 0 && ms % 60000 === 0) return { val: ms / 60000, unit: 'minutes' };
    if (ms > 0 && ms % 1000 === 0) return { val: ms / 1000, unit: 'seconds' };
    return { val: ms || '', unit: 'milliseconds' };
}

/* MessageWriterOptions "Content" combo: (contentType enum name, destinationContent).
   "XML serialized message" == null contentType. Mirrors MessageExportPanel order. */
const CONTENT_OPTIONS = [
    { key: 'xml', label: 'XML serialized message', contentType: null, dest: false },
    { key: 'src-RAW', label: 'Source - Raw', contentType: 'RAW', dest: false },
    { key: 'src-PROCESSED_RAW', label: 'Source - Processed raw', contentType: 'PROCESSED_RAW', dest: false },
    { key: 'src-TRANSFORMED', label: 'Source - Transformed', contentType: 'TRANSFORMED', dest: false },
    { key: 'src-ENCODED', label: 'Source - Encoded', contentType: 'ENCODED', dest: false },
    { key: 'src-RESPONSE', label: 'Source - Response', contentType: 'RESPONSE', dest: false },
    { key: 'dst-RAW', label: 'Destination - Raw', contentType: 'RAW', dest: true },
    { key: 'dst-TRANSFORMED', label: 'Destination - Transformed', contentType: 'TRANSFORMED', dest: true },
    { key: 'dst-ENCODED', label: 'Destination - Encoded', contentType: 'ENCODED', dest: true },
    { key: 'dst-SENT', label: 'Destination - Sent', contentType: 'SENT', dest: true },
    { key: 'dst-RESPONSE', label: 'Destination - Response', contentType: 'RESPONSE', dest: true },
    { key: 'dst-PROCESSED_RESPONSE', label: 'Destination - Processed response', contentType: 'PROCESSED_RESPONSE', dest: true },
    { key: 'map-SOURCE_MAP', label: 'Source map', contentType: 'SOURCE_MAP', dest: false },
    { key: 'map-CHANNEL_MAP', label: 'Channel map', contentType: 'CHANNEL_MAP', dest: false },
    { key: 'map-RESPONSE_MAP', label: 'Response map', contentType: 'RESPONSE_MAP', dest: false }
];

/* MessageWriterOptions archiveFormat/compressFormat pairs (ArchiveFormat enum). */
const COMPRESS_OPTIONS = [
    { key: 'none', label: 'none', archive: null, compress: null },
    { key: 'zip', label: 'zip', archive: 'zip', compress: null },
    { key: 'tar.gz', label: 'tar.gz', archive: 'tar', compress: 'gz' },
    { key: 'tar.bz2', label: 'tar.bz2', archive: 'tar', compress: 'bzip2' }
];

/* EncryptionType enum name -> display label. */
const ENCRYPTION_OPTIONS = [
    { value: 'STANDARD', label: 'Standard' },
    { value: 'AES128', label: 'AES-128' },
    { value: 'AES256', label: 'AES-256' }
];

/* Template variables for the archiver Root Path / File Pattern — the exact
   Swing MessageExportPanel list, mapped to the VELOCITY tokens the Swing
   VariableListHandler inserts on drag. Drag an item into (or click to insert
   it at the cursor of) the Root Path / File Pattern fields. */
const ARCHIVE_VARS = [
    { label: 'Message ID', token: '${message.messageId}' },
    { label: 'Server ID', token: '${message.serverId}' },
    { label: 'Channel ID', token: '${message.channelId}' },
    { label: 'Original File Name', token: '${originalFilename}' },
    { label: 'Formatted Message Date', token: "${date.format('yyyy-MM-dd',$message.getConnectorMessages().get(0).getReceivedDate())}" },
    { label: 'Formatted Current Date', token: "${date.get('yyyy-MM-dd')}" },
    { label: 'Timestamp', token: '${SYSTIME}' },
    { label: 'Unique ID', token: '${UUID}' },
    { label: 'Count', token: '${COUNT}' }
];
const ARCHIVE_VAR_MIME = 'application/x-oie-archivevar';

export function register(platform) {
    const { taskButton, toast, confirmDialog } = platform.ui;
    const api = platform.api;

    function labelCase(key) {
        const s = String(key || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    /* ---- XStream java.util.Properties / map round-tripping (verbatim) ---- */

    function propsToList(raw) {
        const list = [];
        if (!raw || typeof raw !== 'object') return list;
        if (raw.property !== undefined) {
            for (const p of api.asList(raw.property)) {
                if (!p || typeof p !== 'object') continue;
                list.push({ name: String(p['@name'] ?? p.name ?? ''), value: p.$ ?? p.value ?? '' });
            }
            return list;
        }
        if (raw.entry !== undefined) {
            for (const e of api.asList(raw.entry)) {
                if (!e || typeof e !== 'object') continue;
                const s = e.string;
                if (Array.isArray(s)) list.push({ name: String(s[0] ?? ''), value: s.length > 1 ? s[1] : '' });
                else {
                    const vals = Object.values(e);
                    list.push({ name: String(vals[0] ?? ''), value: vals.length > 1 ? vals[1] : '' });
                }
            }
            return list;
        }
        for (const [name, value] of Object.entries(raw)) {
            if (name.startsWith('@')) continue;
            list.push({ name, value });
        }
        return list;
    }

    function listToProps(list) {
        return { property: list.map(p => ({ '@name': p.name, $: String(p.value ?? '') })) };
    }

    function statusPairs(raw) {
        const pairs = [];
        if (raw && typeof raw === 'object' && raw.entry !== undefined) {
            for (const e of api.asList(raw.entry)) {
                if (!e || typeof e !== 'object') continue;
                const s = e.string;
                if (Array.isArray(s)) pairs.push([String(s[0] ?? ''), s.length > 1 ? String(s[1] ?? '') : '']);
                else if (s !== undefined) pairs.push([String(s), '']);
            }
        } else if (raw && typeof raw === 'object') {
            for (const [k, v] of Object.entries(raw)) {
                if (k.startsWith('@')) continue;
                pairs.push([k, String(v ?? '')]);
            }
        }
        pairs.sort((a, b) => {
            const ia = PRUNER_STATUS_ORDER.indexOf(a[0]), ib = PRUNER_STATUS_ORDER.indexOf(b[0]);
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        });
        return pairs;
    }

    /* ---- small inline UI atoms (JSX equivalents of the ui.js builders) ---- */

    // Yes/No inline radio group (matches yesNo()/.radio-group.inline-row markup).
    function YesNo({ value, onChange, disabled }) {
        const name = React.useMemo(() => 'datapruner-rg-' + Math.random().toString(36).slice(2), []);
        return (
            <div className="radio-group inline-row">
                <label>
                    <input type="radio" name={name} value="yes" checked={value === true}
                        disabled={disabled} onChange={() => onChange(true)} /> Yes
                </label>
                <label>
                    <input type="radio" name={name} value="no" checked={value === false}
                        disabled={disabled} onChange={() => onChange(false)} /> No
                </label>
            </div>
        );
    }

    function Field({ label, hint, children }) {
        return (
            <div className="field">
                <label>{label}</label>
                {children}
                {hint ? <div className="hint">{hint}</div> : null}
            </div>
        );
    }

    function Loading({ text = 'Loading…' }) {
        return <div className="loading-block"><div className="spinner" />{text}</div>;
    }

    /* ---- main panel component (ctx as props: { platform, setTasks }) ---- */

    function DataPrunerPanel({ platform, setTasks }) {
        const [phase, setPhase] = React.useState('loading');     // loading | ready | error
        const [errorMessage, setErrorMessage] = React.useState('');
        const [statusState, setStatusState] = React.useState({ phase: 'loading', pairs: [], message: '' });

        // The live, mutable property list (round-trips pollingProperties /
        // archiverOptions / includeAttachments and any unknown keys unchanged).
        const propListRef = React.useRef([]);
        // Parsed schedule / archiver docs: { doc, root } — only the exposed
        // child elements are mutated on save; everything else round-trips.
        const scheduleRef = React.useRef(null);
        const archiverRef = React.useRef(null);

        // Form field state (controlled inputs).
        const [enabled, setEnabled] = React.useState(false);
        const [blockSize, setBlockSize] = React.useState('');
        const [pruneEvents, setPruneEvents] = React.useState(false);
        const [maxEventAge, setMaxEventAge] = React.useState('');
        const [archiveEnabled, setArchiveEnabled] = React.useState(false);
        const [archiverBlockSize, setArchiverBlockSize] = React.useState('');
        // null when includeAttachments isn't the trivial <boolean> shape (preserved verbatim).
        const [includeAttachments, setIncludeAttachments] = React.useState(null);

        // Schedule controls (only meaningful when scheduleRef has a parsed doc).
        const [scheduleType, setScheduleType] = React.useState('INTERVAL');
        const [freqValue, setFreqValue] = React.useState('');
        const [freqUnit, setFreqUnit] = React.useState('minutes');
        const [pollTime, setPollTime] = React.useState('00:00');       // TIME: "HH:MM" (24h)
        const [cronJobs, setCronJobs] = React.useState([]);            // CRON: [{ expression, description }]
        const [scheduleDirty, setScheduleDirty] = React.useState(false);
        const [hasSchedule, setHasSchedule] = React.useState(false);

        // Advanced archiver options (archiverOptions MessageWriterOptions blob).
        const [contentKey, setContentKey] = React.useState('xml');
        const [encrypt, setEncrypt] = React.useState(false);
        const [compressKey, setCompressKey] = React.useState('none');
        const [passwordEnabled, setPasswordEnabled] = React.useState(false);
        const [password, setPassword] = React.useState('');
        const [encryptionType, setEncryptionType] = React.useState('AES128');
        const [rootFolder, setRootFolder] = React.useState('');
        const [filePattern, setFilePattern] = React.useState('');
        // Refs for the Root Path / File Pattern inputs so a dragged/clicked
        // template variable inserts at the caret of the last-focused field.
        const rootInputRef = React.useRef(null);
        const patternInputRef = React.useRef(null);
        const lastVarTargetRef = React.useRef(null);

        // Insert `token` at the caret of `input` (a Root Path / File Pattern
        // field), updating the matching state and restoring the caret after the
        // controlled re-render.
        const insertArchiveVar = (input, token) => {
            if (!input || input.disabled) return;
            const setter = input === rootInputRef.current ? setRootFolder : setFilePattern;
            const s = input.selectionStart ?? input.value.length;
            const e = input.selectionEnd ?? input.value.length;
            setter(input.value.slice(0, s) + token + input.value.slice(e));
            setArchiverDirty(true);
            const pos = s + token.length;
            requestAnimationFrame(() => {
                input.focus();
                try { input.setSelectionRange(pos, pos); } catch { /* detached */ }
            });
        };
        const onArchiveVarDragOver = (ev) => {
            if (!ev.currentTarget.disabled && Array.from(ev.dataTransfer.types).includes(ARCHIVE_VAR_MIME)) {
                ev.preventDefault();
                ev.dataTransfer.dropEffect = 'copy';
            }
        };
        const onArchiveVarDrop = (ev) => {
            const token = ev.dataTransfer.getData(ARCHIVE_VAR_MIME);
            if (!token || ev.currentTarget.disabled) return;
            ev.preventDefault();
            insertArchiveVar(ev.currentTarget, token);
        };
        const [archiverDirty, setArchiverDirty] = React.useState(false);
        const [hasArchiver, setHasArchiver] = React.useState(false);

        const getProp = (name, dflt = '') => {
            const p = propListRef.current.find(x => x.name === name);
            return p === undefined ? dflt : String(p.value ?? '');
        };
        const setProp = (name, value) => {
            const p = propListRef.current.find(x => x.name === name);
            if (p) p.value = value;
            else propListRef.current.push({ name, value });
        };

        /* pollingProperties is a serialized PollConnectorProperties XML string;
           parse it to expose pollingType and the per-type schedule fields
           (INTERVAL frequency, TIME hour/minute, CRON jobs). Only the elements for
           the selected type are mutated on save; every other child element
           (pollOnStart, pollConnectorPropertiesAdvanced, …) round-trips. */
        function buildSchedule() {
            scheduleRef.current = null;
            const xml = getProp('pollingProperties');
            if (!xml || xml.trim() === '' || xml.trim()[0] !== '<') return false;
            let doc = null;
            try {
                doc = new DOMParser().parseFromString(xml, 'text/xml');
            } catch (e) {
                return false;
            }
            if (!doc || doc.querySelector('parsererror')) return false;
            const root = doc.documentElement;
            const typeEl = childEl(root, 'pollingType');
            if (!typeEl) return false;

            scheduleRef.current = { doc, root };
            setScheduleType((typeEl.textContent || '').trim() || 'INTERVAL');

            const freqMs = parseInt(elText(childEl(root, 'pollingFrequency')), 10) || 0;
            const f = msToFreq(freqMs);
            setFreqValue(f.val);
            setFreqUnit(f.unit);

            const hour = parseInt(elText(childEl(root, 'pollingHour')), 10) || 0;
            const minute = parseInt(elText(childEl(root, 'pollingMinute')), 10) || 0;
            setPollTime(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);

            const jobs = [];
            const cronEl = childEl(root, 'cronJobs');
            if (cronEl) {
                for (const cp of cronEl.children) {
                    if (cp.tagName !== 'cronProperty') continue;
                    jobs.push({
                        expression: elText(childEl(cp, 'expression')),
                        description: elText(childEl(cp, 'description'))
                    });
                }
            }
            setCronJobs(jobs);
            setScheduleDirty(false);
            return true;
        }

        /* archiverOptions is a serialized MessageWriterOptions XML string. Parse it
           to expose the advanced archiver fields; mutate only the exposed child
           elements on save. Unknown/extra child elements round-trip verbatim. */
        function buildArchiver() {
            archiverRef.current = null;
            const xml = getProp('archiverOptions');
            if (!xml || xml.trim() === '' || xml.trim()[0] !== '<') return false;
            let doc = null;
            try {
                doc = new DOMParser().parseFromString(xml, 'text/xml');
            } catch (e) {
                return false;
            }
            if (!doc || doc.querySelector('parsererror')) return false;
            const root = doc.documentElement;
            archiverRef.current = { doc, root };

            const ctVal = (elText(childEl(root, 'contentType')) || '').trim() || null;
            const dest = elBool(childEl(root, 'destinationContent'));
            let ckey = 'xml';
            if (ctVal) {
                const opt = CONTENT_OPTIONS.find(o => o.contentType === ctVal && o.dest === dest);
                ckey = opt ? opt.key : 'xml';
            }
            setContentKey(ckey);
            setEncrypt(elBool(childEl(root, 'encrypt')));

            const af = (elText(childEl(root, 'archiveFormat')) || '').trim() || null;
            const cf = (elText(childEl(root, 'compressFormat')) || '').trim() || null;
            const copt = COMPRESS_OPTIONS.find(o => o.archive === af && o.compress === cf);
            setCompressKey(copt ? copt.key : 'none');

            setPasswordEnabled(elBool(childEl(root, 'passwordEnabled')));
            setPassword(elText(childEl(root, 'password')));
            setEncryptionType((elText(childEl(root, 'encryptionType')) || '').trim() || 'AES128');
            setRootFolder(elText(childEl(root, 'rootFolder')));
            setFilePattern(elText(childEl(root, 'filePattern')));
            setArchiverDirty(false);
            return true;
        }

        function applyPropsToForm() {
            setEnabled(getProp('enabled') === 'true');
            setBlockSize(getProp('pruningBlockSize'));
            setPruneEvents(getProp('pruneEvents') === 'true');
            setMaxEventAge(getProp('maxEventAge'));
            setArchiveEnabled(getProp('archiveEnabled') === 'true');
            setArchiverBlockSize(getProp('archiverBlockSize'));
            /* includeAttachments is a standalone plugin property holding an
               XStream-serialized Boolean ("<boolean>false</boolean>", verified in
               DataPrunerService.getDefaultProperties). Only expose it when the
               stored value is exactly that trivial shape; anything else (or the
               archiverOptions MessageWriterOptions blob, whose content/encrypt
               fields are interdependent) is preserved verbatim. */
            const incAttachMatch = /^<boolean>(true|false)<\/boolean>$/.exec(getProp('includeAttachments').trim());
            setIncludeAttachments(incAttachMatch ? incAttachMatch[1] === 'true' : null);
            setHasSchedule(buildSchedule());
            setHasArchiver(buildArchiver());
        }

        async function refreshStatus() {
            try {
                const raw = await api.get('/extensions/datapruner/status');
                setStatusState({ phase: 'ready', pairs: statusPairs(raw), message: '' });
            } catch (e) {
                setStatusState({ phase: 'error', pairs: [], message: `Status unavailable: ${e.message}` });
            }
        }

        async function load() {
            setPhase('loading');
            try {
                propListRef.current = propsToList(await api.extensions.properties('Data Pruner'));
            } catch (e) {
                toast(`Failed to load Data Pruner properties: ${e.message}`, 'error');
                setErrorMessage(String(e.message || e));
                setPhase('error');
                return;
            }
            applyPropsToForm();
            setPhase('ready');
            refreshStatus();
        }

        async function save() {
            try {
                setProp('enabled', String(enabled));
                setProp('pruningBlockSize', blockSize);
                setProp('pruneEvents', String(pruneEvents));
                setProp('maxEventAge', maxEventAge);
                setProp('archiveEnabled', String(archiveEnabled));
                setProp('archiverBlockSize', archiverBlockSize);
                // Attachments only apply to XML-serialized content (Swing forces it
                // off for extracted content types); keep the top-level flag in sync.
                const effIncludeAttachments = contentKey === 'xml' ? includeAttachments : false;
                if (includeAttachments !== null) {
                    setProp('includeAttachments', `<boolean>${effIncludeAttachments}</boolean>`);
                }

                const schedule = scheduleRef.current;
                if (schedule && scheduleDirty) {
                    const { doc, root } = schedule;
                    setChild(doc, root, 'pollingType', scheduleType);
                    if (scheduleType === 'INTERVAL') {
                        const ms = Math.round((parseFloat(freqValue) || 0) * (UNIT_MS[freqUnit] || 60000));
                        if (ms > 0) setChild(doc, root, 'pollingFrequency', String(ms));
                    } else if (scheduleType === 'TIME') {
                        const [hh, mm] = String(pollTime || '00:00').split(':');
                        setChild(doc, root, 'pollingHour', String(parseInt(hh, 10) || 0));
                        setChild(doc, root, 'pollingMinute', String(parseInt(mm, 10) || 0));
                    } else if (scheduleType === 'CRON') {
                        let cronEl = childEl(root, 'cronJobs');
                        if (!cronEl) { cronEl = doc.createElement('cronJobs'); root.appendChild(cronEl); }
                        while (cronEl.firstChild) cronEl.removeChild(cronEl.firstChild);
                        for (const job of cronJobs) {
                            if (!job.expression || !job.expression.trim()) continue;
                            const cp = doc.createElement('cronProperty');
                            const desc = doc.createElement('description');
                            desc.textContent = job.description || '';
                            const expr = doc.createElement('expression');
                            expr.textContent = job.expression;
                            cp.appendChild(desc);
                            cp.appendChild(expr);
                            cronEl.appendChild(cp);
                        }
                    }
                    setProp('pollingProperties', new XMLSerializer().serializeToString(doc));
                }

                const archiver = archiverRef.current;
                if (archiver && archiverDirty) {
                    const { doc, root } = archiver;
                    const cOpt = CONTENT_OPTIONS.find(o => o.key === contentKey) || CONTENT_OPTIONS[0];
                    setChild(doc, root, 'contentType', cOpt.contentType); // null removes the element
                    setChild(doc, root, 'destinationContent', String(!!cOpt.dest));
                    setChild(doc, root, 'encrypt', String(encrypt));
                    if (includeAttachments !== null) {
                        setChild(doc, root, 'includeAttachments', String(effIncludeAttachments));
                    }
                    const zOpt = COMPRESS_OPTIONS.find(o => o.key === compressKey) || COMPRESS_OPTIONS[0];
                    setChild(doc, root, 'archiveFormat', zOpt.archive);   // null removes
                    setChild(doc, root, 'compressFormat', zOpt.compress); // null removes
                    const passwordActive = compressKey === 'zip' && passwordEnabled;
                    setChild(doc, root, 'passwordEnabled', String(passwordActive));
                    setChild(doc, root, 'password', passwordActive ? password : '');
                    setChild(doc, root, 'encryptionType', encryptionType);
                    setChild(doc, root, 'rootFolder', rootFolder);
                    setChild(doc, root, 'filePattern', filePattern);
                    setProp('archiverOptions', new XMLSerializer().serializeToString(doc));
                }

                /* propList still carries pollingProperties / archiverOptions /
                   includeAttachments and any unknown keys — they round-trip
                   unchanged. */
                await api.extensions.setProperties('Data Pruner', listToProps(propListRef.current));
                toast('Data Pruner settings saved');
            } catch (e) {
                toast(`Save failed: ${e.message}`, 'error');
            }
        }

        async function pruneNow() {
            if (await confirmDialog('Prune Now', 'Start the Data Pruner now? Pruning may take a long time on large message stores.', { okLabel: 'Start' })) {
                try {
                    await api.post('/extensions/datapruner/_start');
                    toast('Data Pruner started');
                } catch (e) {
                    toast(`Start failed: ${e.message}`, 'error');
                }
                refreshStatus();
            }
        }

        async function stopPruner() {
            try {
                await api.post('/extensions/datapruner/_stop');
                toast('Stop requested');
            } catch (e) {
                toast(`Stop failed: ${e.message}`, 'error');
            }
            refreshStatus();
        }

        // Load once on mount.
        React.useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

        // Declare the task pane through the ctx.setTasks callback. The task items
        // are legacy DOM taskButton() nodes (the Settings TasksPane mounts those
        // into the rail). Re-declared whenever the bound save/prune state closures
        // change so the buttons always act on the latest field state.
        React.useEffect(() => {
            setTasks('Data Pruner Tasks', [
                taskButton('Refresh', 'refresh', () => { load(); }),
                taskButton('Save', 'save', save, { primary: true }),
                taskButton('View Events', 'events', () => platform.router.navigate('/events')),
                taskButton('Prune Now', 'play', pruneNow),
                taskButton('Stop Pruner', 'stop', stopPruner, { danger: true })
            ]);
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [enabled, blockSize, pruneEvents, maxEventAge, archiveEnabled, archiverBlockSize,
            includeAttachments, scheduleType, freqValue, freqUnit, pollTime, cronJobs, scheduleDirty,
            contentKey, encrypt, compressKey, passwordEnabled, password, encryptionType,
            rootFolder, filePattern, archiverDirty]);

        if (phase === 'loading') return <Loading />;
        if (phase === 'error') {
            return (
                <div className="dt-empty">
                    <div className="empty-icon">
                        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor"
                            strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 3l9 16H3zM12 10v4M12 17.5v.5" />
                        </svg>
                    </div>
                    <div>Failed to load</div>
                    <div className="text-text-faint mt-[14px]">{errorMessage}</div>
                </div>
            );
        }

        const attachmentsEnabled = archiveEnabled && contentKey === 'xml';
        const passwordSectionEnabled = archiveEnabled && compressKey === 'zip';
        const updateCronJob = (idx, key, value) => {
            setCronJobs(cronJobs.map((job, i) => (i === idx ? { ...job, [key]: value } : job)));
            setScheduleDirty(true);
        };

        return (
            <div>
                <div className="panel">
                    <div className="panel-header">Status</div>
                    <div className="panel-body">
                        {statusState.phase === 'loading' && <Loading text="Loading status…" />}
                        {statusState.phase === 'error' && <div className="text-text-faint">{statusState.message}</div>}
                        {statusState.phase === 'ready' && (
                            statusState.pairs.length
                                ? <dl className="kv">{statusState.pairs.map(([k, v], i) => (
                                    <React.Fragment key={`${k}-${i}`}>
                                        <dt>{labelCase(k)}</dt>
                                        <dd>{v}</dd>
                                    </React.Fragment>
                                ))}</dl>
                                : <div className="text-text-faint">No status reported</div>
                        )}
                    </div>
                </div>

                <div className="panel">
                    <div className="panel-header">Schedule</div>
                    <div className="panel-body">
                        <div className="field">
                            <label>Enable</label>
                            <YesNo value={enabled} onChange={setEnabled} />
                        </div>
                        {hasSchedule ? (
                            <div className="form-grid">
                                <Field label="Schedule Type">
                                    <select value={scheduleType} disabled={!enabled}
                                        onChange={(e) => { setScheduleType(e.target.value); setScheduleDirty(true); }}>
                                        <option value="INTERVAL">Interval</option>
                                        <option value="TIME">Time</option>
                                        <option value="CRON">Cron</option>
                                    </select>
                                </Field>
                                {scheduleType === 'INTERVAL' && (
                                    <Field label="Interval" hint="Must be between 1 and 24 hours when converted to milliseconds.">
                                        <div className="flex items-center gap-2">
                                            <input type="number" min="0" step="any" className="max-w-[120px]"
                                                value={freqValue} disabled={!enabled}
                                                onInput={(e) => { setFreqValue(e.target.value); setScheduleDirty(true); }}
                                                onChange={(e) => { setFreqValue(e.target.value); setScheduleDirty(true); }} />
                                            <select className="max-w-[140px]" value={freqUnit} disabled={!enabled}
                                                onChange={(e) => { setFreqUnit(e.target.value); setScheduleDirty(true); }}>
                                                <option value="milliseconds">milliseconds</option>
                                                <option value="seconds">seconds</option>
                                                <option value="minutes">minutes</option>
                                                <option value="hours">hours</option>
                                            </select>
                                        </div>
                                    </Field>
                                )}
                                {scheduleType === 'TIME' && (
                                    <Field label="Time" hint="Prune once a day at this time of day.">
                                        <input type="time" className="max-w-[140px]" value={pollTime} disabled={!enabled}
                                            onInput={(e) => { setPollTime(e.target.value); setScheduleDirty(true); }}
                                            onChange={(e) => { setPollTime(e.target.value); setScheduleDirty(true); }} />
                                    </Field>
                                )}
                                {scheduleType === 'CRON' && (
                                    <div className="field span-2">
                                        <label>Cron Jobs</label>
                                        <div className="dt-wrap">
                                            <table className="dt">
                                                <thead>
                                                    <tr><th>Expression</th><th>Description</th><th /></tr>
                                                </thead>
                                                <tbody>
                                                    {cronJobs.length === 0 && (
                                                        <tr><td colSpan="3" className="text-text-faint">No cron jobs defined.</td></tr>
                                                    )}
                                                    {cronJobs.map((job, idx) => (
                                                        <tr key={idx}>
                                                            <td>
                                                                <input type="text" className="w-full" value={job.expression}
                                                                    disabled={!enabled} placeholder="0 0 */1 * * ?"
                                                                    onInput={(e) => updateCronJob(idx, 'expression', e.target.value)}
                                                                    onChange={(e) => updateCronJob(idx, 'expression', e.target.value)} />
                                                            </td>
                                                            <td>
                                                                <input type="text" className="w-full" value={job.description}
                                                                    disabled={!enabled}
                                                                    onInput={(e) => updateCronJob(idx, 'description', e.target.value)}
                                                                    onChange={(e) => updateCronJob(idx, 'description', e.target.value)} />
                                                            </td>
                                                            <td>
                                                                <button type="button" className="btn btn-sm btn-danger" disabled={!enabled}
                                                                    onClick={() => { setCronJobs(cronJobs.filter((_, i) => i !== idx)); setScheduleDirty(true); }}>
                                                                    Delete
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        <div className="mt-[8px]">
                                            <button type="button" className="btn btn-sm" disabled={!enabled}
                                                onClick={() => { setCronJobs([...cronJobs, { expression: '', description: '' }]); setScheduleDirty(true); }}>
                                                Add
                                            </button>
                                        </div>
                                        <div className="hint mt-[6px]">
                                            Quartz cron expressions with at least 6 fields (seconds minutes hours day-of-month month day-of-week [year]).
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="hint">
                                The polling schedule (pollingProperties) could not be parsed; it will be preserved unchanged.
                            </div>
                        )}
                    </div>
                </div>

                <div className="panel">
                    <div className="panel-header">Prune Settings</div>
                    <div className="panel-body">
                        <div className="form-grid">
                            <Field label="Block Size">
                                <input type="number" min="50" value={blockSize}
                                    onInput={(e) => setBlockSize(e.target.value)}
                                    onChange={(e) => setBlockSize(e.target.value)} />
                            </Field>
                            <div className="field">
                                <label>Prune Events</label>
                                <YesNo value={pruneEvents} onChange={setPruneEvents} />
                            </div>
                            <Field label="Prune Event Age (days)">
                                <input type="number" min="1" value={maxEventAge} disabled={!pruneEvents}
                                    onInput={(e) => setMaxEventAge(e.target.value)}
                                    onChange={(e) => setMaxEventAge(e.target.value)} />
                            </Field>
                        </div>
                    </div>
                </div>

                <div className="panel">
                    <div className="panel-header">Archive Settings</div>
                    <div className="panel-body">
                        <div className="form-grid">
                            <div className="field">
                                <label>Enable Archiving</label>
                                <YesNo value={archiveEnabled} onChange={setArchiveEnabled} />
                            </div>
                            <Field label="Archiver Block Size">
                                <input type="number" min="1" value={archiverBlockSize} disabled={!archiveEnabled}
                                    onInput={(e) => setArchiverBlockSize(e.target.value)}
                                    onChange={(e) => setArchiverBlockSize(e.target.value)} />
                            </Field>
                        </div>

                        {hasArchiver ? (
                            <div className="form-grid mt-[12px]">
                                <Field label="Content">
                                    <select value={contentKey} disabled={!archiveEnabled}
                                        onChange={(e) => {
                                            const key = e.target.value;
                                            setContentKey(key);
                                            if (key !== 'xml' && includeAttachments !== null) setIncludeAttachments(false);
                                            setArchiverDirty(true);
                                        }}>
                                        {CONTENT_OPTIONS.map(o => (
                                            <option key={o.key} value={o.key}>{o.label}</option>
                                        ))}
                                    </select>
                                </Field>
                                <div className="field">
                                    <label>Encrypt</label>
                                    <label className="inline-flex items-center gap-2">
                                        <input type="checkbox" checked={encrypt} disabled={!archiveEnabled}
                                            onChange={(e) => { setEncrypt(e.target.checked); setArchiverDirty(true); }} />
                                        Encrypt exported content
                                    </label>
                                </div>
                                {includeAttachments !== null && (
                                    <div className="field">
                                        <label>Include Attachments</label>
                                        <YesNo value={includeAttachments} disabled={!attachmentsEnabled}
                                            onChange={(v) => { setIncludeAttachments(v); setArchiverDirty(true); }} />
                                    </div>
                                )}
                                <Field label="Compression">
                                    <select value={compressKey} disabled={!archiveEnabled}
                                        onChange={(e) => { setCompressKey(e.target.value); setArchiverDirty(true); }}>
                                        {COMPRESS_OPTIONS.map(o => (
                                            <option key={o.key} value={o.key}>{o.label}</option>
                                        ))}
                                    </select>
                                </Field>
                                <div className="field">
                                    <label>Password Protect</label>
                                    <YesNo value={passwordEnabled} disabled={!passwordSectionEnabled}
                                        onChange={(v) => { setPasswordEnabled(v); setArchiverDirty(true); }} />
                                </div>
                                <Field label="Password">
                                    <input type="password" value={password}
                                        disabled={!passwordSectionEnabled || !passwordEnabled}
                                        onInput={(e) => { setPassword(e.target.value); setArchiverDirty(true); }}
                                        onChange={(e) => { setPassword(e.target.value); setArchiverDirty(true); }} />
                                </Field>
                                <Field label="Encryption">
                                    <select value={encryptionType}
                                        disabled={!passwordSectionEnabled || !passwordEnabled}
                                        onChange={(e) => { setEncryptionType(e.target.value); setArchiverDirty(true); }}>
                                        {ENCRYPTION_OPTIONS.map(o => (
                                            <option key={o.value} value={o.value}>{o.label}</option>
                                        ))}
                                    </select>
                                </Field>
                                <div className="span-2 flex gap-3 items-stretch">
                                    <div className="flex-1 min-w-0 flex flex-col gap-2">
                                        <Field label="Root Path" hint="Relative paths resolve against the server home directory.">
                                            <input ref={rootInputRef} type="text" value={rootFolder} disabled={!archiveEnabled}
                                                onFocus={() => { lastVarTargetRef.current = rootInputRef.current; }}
                                                onDragOver={onArchiveVarDragOver} onDrop={onArchiveVarDrop}
                                                onInput={(e) => { setRootFolder(e.target.value); setArchiverDirty(true); }}
                                                onChange={(e) => { setRootFolder(e.target.value); setArchiverDirty(true); }} />
                                        </Field>
                                        <Field label="File Pattern" hint="Folder/filename pattern for written messages (supports ${message.*} variables).">
                                            <input ref={patternInputRef} type="text" value={filePattern} disabled={!archiveEnabled}
                                                onFocus={() => { lastVarTargetRef.current = patternInputRef.current; }}
                                                onDragOver={onArchiveVarDragOver} onDrop={onArchiveVarDrop}
                                                onInput={(e) => { setFilePattern(e.target.value); setArchiverDirty(true); }}
                                                onChange={(e) => { setFilePattern(e.target.value); setArchiverDirty(true); }} />
                                        </Field>
                                    </div>
                                    {/* Draggable template-variable list (Swing MessageExportPanel). */}
                                    <div className="border border-line rounded-[4px] py-1 min-w-[180px] max-w-[230px] bg-bg1 overflow-auto self-stretch"
                                        style={{ opacity: archiveEnabled ? 1 : 0.5 }}
                                        title="Drag a variable into Root Path / File Pattern, or click to insert it at the last-focused one">
                                        {ARCHIVE_VARS.map((v) => (
                                            <div key={v.label} draggable={archiveEnabled}
                                                className="py-[3px] px-3 text-[12px] select-none cursor-grab hover:bg-bg2"
                                                onClick={() => archiveEnabled && insertArchiveVar(lastVarTargetRef.current || rootInputRef.current, v.token)}
                                                onDragStart={(ev) => {
                                                    ev.dataTransfer.clearData();
                                                    ev.dataTransfer.setData(ARCHIVE_VAR_MIME, v.token);
                                                    ev.dataTransfer.effectAllowed = 'copy';
                                                }}>
                                                {v.label}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="hint mt-[12px]">
                                Advanced archiver options (archiverOptions) could not be parsed; they will be preserved unchanged.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    platform.registerSettingsPanel({
        label: 'Data Pruner',
        component: DataPrunerPanel
    });
}
