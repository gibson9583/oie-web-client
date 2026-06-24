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
        // Parsed schedule: { doc, typeEl, freqEl } — only pollingType /
        // pollingFrequency are mutated on save; everything else round-trips.
        const scheduleRef = React.useRef(null);

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
        const [scheduleDirty, setScheduleDirty] = React.useState(false);
        const [hasSchedule, setHasSchedule] = React.useState(false);

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
           parse it to expose pollingType / pollingFrequency, mutate ONLY those
           elements on save and re-serialize. Anything else round-trips. */
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
            const typeEl = doc.documentElement.querySelector('pollingType');
            if (!typeEl) return false;
            const freqEl = doc.documentElement.querySelector('pollingFrequency');

            const freqMs = parseInt(freqEl ? freqEl.textContent : '', 10) || 0;
            let unit = 'minutes';
            let val = freqMs / 60000;
            if (freqMs > 0 && freqMs % 3600000 === 0) { unit = 'hours'; val = freqMs / 3600000; }

            scheduleRef.current = { doc, typeEl, freqEl };
            setScheduleType(typeEl.textContent.trim());
            setFreqValue(val || '');
            setFreqUnit(unit);
            setScheduleDirty(false);
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
                if (includeAttachments !== null) {
                    setProp('includeAttachments', `<boolean>${includeAttachments}</boolean>`);
                }

                const schedule = scheduleRef.current;
                if (schedule && scheduleDirty) {
                    schedule.typeEl.textContent = scheduleType;
                    if (schedule.freqEl && scheduleType === 'INTERVAL') {
                        const unitMs = freqUnit === 'hours' ? 3600000 : 60000;
                        const ms = Math.round((parseFloat(freqValue) || 0) * unitMs);
                        if (ms > 0) schedule.freqEl.textContent = String(ms);
                    }
                    setProp('pollingProperties', new XMLSerializer().serializeToString(schedule.doc));
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
            includeAttachments, scheduleType, freqValue, freqUnit, scheduleDirty]);

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

        const schedule = scheduleRef.current;
        const showFreq = hasSchedule && scheduleType === 'INTERVAL' && schedule && schedule.freqEl;
        const showFreqHint = hasSchedule && scheduleType !== 'INTERVAL';

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
                                    <select value={scheduleType}
                                        onChange={(e) => { setScheduleType(e.target.value); setScheduleDirty(true); }}>
                                        <option value="INTERVAL">Interval</option>
                                        <option value="TIME">Time</option>
                                        <option value="CRON">Cron</option>
                                    </select>
                                </Field>
                                <div className="field">
                                    {showFreq && <label>Frequency</label>}
                                    {showFreq && (
                                        <div className="flex items-center gap-2">
                                            <input type="number" min="0" step="any" className="max-w-[120px]"
                                                value={freqValue}
                                                onInput={(e) => { setFreqValue(e.target.value); setScheduleDirty(true); }}
                                                onChange={(e) => { setFreqValue(e.target.value); setScheduleDirty(true); }} />
                                            <select className="max-w-[120px]" value={freqUnit}
                                                onChange={(e) => { setFreqUnit(e.target.value); setScheduleDirty(true); }}>
                                                <option value="minutes">minutes</option>
                                                <option value="hours">hours</option>
                                            </select>
                                        </div>
                                    )}
                                    {showFreqHint && <label>Frequency</label>}
                                    {showFreqHint && (
                                        <div className="hint">Time/cron schedule details are preserved as configured.</div>
                                    )}
                                </div>
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
                            {includeAttachments !== null && (
                                <div className="field">
                                    <label>Include Attachments</label>
                                    <YesNo value={includeAttachments} onChange={setIncludeAttachments} />
                                </div>
                            )}
                            <div className="field span-2">
                                <div className="hint">
                                    Advanced archiver options (archiverOptions: content type, encryption, file patterns, compression) are preserved as configured and can be edited in the desktop Administrator.
                                </div>
                            </div>
                        </div>
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
