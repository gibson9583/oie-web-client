/*
 * Data Pruner — web admin plugin (SettingsPanelPlugin equivalent).
 *
 * Registers a "Data Pruner" tab in Settings through platform.registerSettingsPanel
 * (the same hook a third-party settings panel would use), instead of being a
 * privileged core Settings tab. Talks to the engine's datapruner extension:
 *   GET /extensions/datapruner/status, POST _start / _stop, and the plugin's
 *   "Data Pruner" properties.
 *
 * Helpers below are small copies of the shared settings-framework helpers so
 * the plugin is self-contained (the originals stay in views/settings.js for the
 * built-in tabs).
 */

import { h, clear, icon, toast, taskButton, confirmDialog, field, numberInput, select, loading } from '/core/ui.js';
import api from '/core/api.js';

const PRUNER_STATUS_ORDER = ['currentState', 'currentProcess', 'lastProcess', 'nextProcess', 'isRunning'];

let radioSeq = 0;
function radioGroup(options, value, onChange) {
    const name = 'datapruner-rg-' + (radioSeq++);
    const inputs = options.map(o => h('input', {
        type: 'radio', name, value: o.value,
        checked: String(o.value) === String(value),
        onChange: () => onChange && onChange(o.value)
    }));
    return {
        el: h('div.radio-group.inline', options.map((o, i) => h('label', inputs[i], o.label))),
        get value() {
            const i = inputs.findIndex(x => x.checked);
            return i >= 0 ? options[i].value : value;
        },
        set value(v) { inputs.forEach((x, i) => { x.checked = String(options[i].value) === String(v); }); }
    };
}

function yesNo(initial, onChange) {
    const g = radioGroup(
        [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
        initial ? 'yes' : 'no',
        onChange ? (v) => onChange(v === 'yes') : null);
    return {
        el: g.el,
        get checked() { return g.value === 'yes'; },
        set checked(v) { g.value = v ? 'yes' : 'no'; }
    };
}

function labelCase(key) {
    const s = String(key || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function loadFailed(host, e) {
    clear(host);
    host.appendChild(h('div.dt-empty',
        h('div.empty-icon', icon('warning', 30)),
        h('div', 'Failed to load'),
        h('div.faint.mt', String(e.message || e))));
}

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

function renderDataPruner(host, { platform, setTasks }) {
    host.appendChild(loading());
    let propList = [];
    let schedule = null;            // { doc, typeEl, freqEl, typeSel, freqInput, unitSel, dirty }

    const getProp = (name, dflt = '') => {
        const p = propList.find(x => x.name === name);
        return p === undefined ? dflt : String(p.value ?? '');
    };
    const setProp = (name, value) => {
        const p = propList.find(x => x.name === name);
        if (p) p.value = value;
        else propList.push({ name, value });
    };

    const statusHost = h('div', loading('Loading status…'));
    let form = null;

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

    async function refreshStatus() {
        try {
            const raw = await api.get('/extensions/datapruner/status');
            clear(statusHost);
            const pairs = statusPairs(raw);
            if (!pairs.length) {
                statusHost.appendChild(h('div.faint', 'No status reported'));
                return;
            }
            statusHost.appendChild(h('dl.kv', pairs.map(([k, v]) => [h('dt', labelCase(k)), h('dd', v)])));
        } catch (e) {
            clear(statusHost);
            statusHost.appendChild(h('div.faint', `Status unavailable: ${e.message}`));
        }
    }

    function buildSchedule() {
        /* pollingProperties is a serialized PollConnectorProperties XML string;
           parse it to expose pollingType / pollingFrequency, mutate ONLY those
           elements on save and re-serialize. Anything else round-trips. */
        schedule = null;
        const xml = getProp('pollingProperties');
        if (!xml || xml.trim() === '' || xml.trim()[0] !== '<') return null;
        let doc = null;
        try {
            doc = new DOMParser().parseFromString(xml, 'text/xml');
        } catch (e) {
            return null;
        }
        if (!doc || doc.querySelector('parsererror')) return null;
        const typeEl = doc.documentElement.querySelector('pollingType');
        if (!typeEl) return null;
        const freqEl = doc.documentElement.querySelector('pollingFrequency');

        const freqField = h('div.field');
        const typeSel = select([
            { value: 'INTERVAL', label: 'Interval' },
            { value: 'TIME', label: 'Time' },
            { value: 'CRON', label: 'Cron' }
        ], typeEl.textContent.trim(), {
            onChange: () => { schedule.dirty = true; toggleFreq(); }
        });

        const freqMs = parseInt(freqEl ? freqEl.textContent : '', 10) || 0;
        let unit = 'minutes';
        let val = freqMs / 60000;
        if (freqMs > 0 && freqMs % 3600000 === 0) { unit = 'hours'; val = freqMs / 3600000; }
        const freqInput = numberInput(val || '', {
            min: 0, step: 'any', style: { maxWidth: '120px' },
            onInput: () => { schedule.dirty = true; }
        });
        const unitSel = select([
            { value: 'minutes', label: 'minutes' },
            { value: 'hours', label: 'hours' }
        ], unit, { onChange: () => { schedule.dirty = true; }, style: { maxWidth: '120px' } });

        function toggleFreq() {
            const interval = typeSel.value === 'INTERVAL';
            clear(freqField);
            if (interval && freqEl) {
                freqField.appendChild(h('label', 'Frequency'));
                freqField.appendChild(h('div.flex', freqInput, unitSel));
            } else if (!interval) {
                freqField.appendChild(h('label', 'Frequency'));
                freqField.appendChild(h('div.hint', 'Time/cron schedule details are preserved as configured.'));
            }
        }

        schedule = { doc, typeEl, freqEl, typeSel, freqInput, unitSel, dirty: false };
        toggleFreq();
        return h('div.form-grid',
            field('Schedule Type', typeSel),
            freqField);
    }

    function build() {
        clear(host);

        const enabled = yesNo(getProp('enabled') === 'true');
        const scheduleControls = buildSchedule();

        const blockSize = numberInput(getProp('pruningBlockSize'), { min: 50 });
        const maxEventAge = numberInput(getProp('maxEventAge'), { min: 1, disabled: getProp('pruneEvents') !== 'true' });
        const pruneEvents = yesNo(getProp('pruneEvents') === 'true', (v) => { maxEventAge.disabled = !v; });

        const archiverBlockSize = numberInput(getProp('archiverBlockSize'), { min: 1, disabled: getProp('archiveEnabled') !== 'true' });
        const archiveEnabled = yesNo(getProp('archiveEnabled') === 'true', (v) => { archiverBlockSize.disabled = !v; });

        /* includeAttachments is a standalone plugin property holding an
           XStream-serialized Boolean ("<boolean>false</boolean>", verified in
           DataPrunerService.getDefaultProperties). Only expose it when the
           stored value is exactly that trivial shape; anything else (or the
           archiverOptions MessageWriterOptions blob, whose content/encrypt
           fields are interdependent) is preserved verbatim. */
        const incAttachMatch = /^<boolean>(true|false)<\/boolean>$/.exec(getProp('includeAttachments').trim());
        const includeAttachments = incAttachMatch ? yesNo(incAttachMatch[1] === 'true') : null;

        form = { enabled, blockSize, pruneEvents, maxEventAge, archiveEnabled, archiverBlockSize, includeAttachments };

        host.appendChild(h('div.panel',
            h('div.panel-header', 'Status'),
            h('div.panel-body', statusHost)));

        host.appendChild(h('div.panel',
            h('div.panel-header', 'Schedule'),
            h('div.panel-body',
                h('div.field', h('label', 'Enable'), enabled.el),
                scheduleControls || h('div.hint',
                    'The polling schedule (pollingProperties) could not be parsed; it will be preserved unchanged.'))));

        host.appendChild(h('div.panel',
            h('div.panel-header', 'Prune Settings'),
            h('div.panel-body', h('div.form-grid',
                field('Block Size', blockSize),
                h('div.field', h('label', 'Prune Events'), pruneEvents.el),
                field('Prune Event Age (days)', maxEventAge)))));

        host.appendChild(h('div.panel',
            h('div.panel-header', 'Archive Settings'),
            h('div.panel-body', h('div.form-grid',
                h('div.field', h('label', 'Enable Archiving'), archiveEnabled.el),
                field('Archiver Block Size', archiverBlockSize),
                includeAttachments ? h('div.field', h('label', 'Include Attachments'), includeAttachments.el) : null,
                h('div.field.span-2', h('div.hint',
                    'Advanced archiver options (archiverOptions: content type, encryption, file patterns, compression) are preserved as configured and can be edited in the desktop Administrator.'))))));

        refreshStatus();
    }

    async function load() {
        try {
            propList = propsToList(await api.extensions.properties('Data Pruner'));
        } catch (e) {
            toast(`Failed to load Data Pruner properties: ${e.message}`, 'error');
            loadFailed(host, e);
            return;
        }
        build();
    }

    async function save() {
        if (!form) return;
        try {
            setProp('enabled', String(form.enabled.checked));
            setProp('pruningBlockSize', form.blockSize.value);
            setProp('pruneEvents', String(form.pruneEvents.checked));
            setProp('maxEventAge', form.maxEventAge.value);
            setProp('archiveEnabled', String(form.archiveEnabled.checked));
            setProp('archiverBlockSize', form.archiverBlockSize.value);
            if (form.includeAttachments) {
                setProp('includeAttachments', `<boolean>${form.includeAttachments.checked}</boolean>`);
            }

            if (schedule && schedule.dirty) {
                schedule.typeEl.textContent = schedule.typeSel.value;
                if (schedule.freqEl && schedule.typeSel.value === 'INTERVAL') {
                    const unitMs = schedule.unitSel.value === 'hours' ? 3600000 : 60000;
                    const ms = Math.round((parseFloat(schedule.freqInput.value) || 0) * unitMs);
                    if (ms > 0) schedule.freqEl.textContent = String(ms);
                }
                setProp('pollingProperties', new XMLSerializer().serializeToString(schedule.doc));
            }

            /* propList still carries pollingProperties / archiverOptions /
               includeAttachments and any unknown keys — they round-trip
               unchanged. */
            await api.extensions.setProperties('Data Pruner', listToProps(propList));
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

    setTasks('Data Pruner Tasks', [
        taskButton('Refresh', 'refresh', () => { load(); }),
        taskButton('Save', 'check', save, { primary: true }),
        taskButton('View Events', 'events', () => platform.router.navigate('/events')),
        taskButton('Prune Now', 'play', pruneNow),
        taskButton('Stop Pruner', 'stop', stopPruner, { danger: true })
    ]);

    load();
    return host;
}

export function register(platform) {
    platform.registerSettingsPanel({
        label: 'Data Pruner',
        render: (host, ctx) => renderDataPruner(host, ctx)
    });
}
