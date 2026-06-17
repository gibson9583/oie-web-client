/*
 * Global Scripts — Deploy / Undeploy / Preprocessor / Postprocessor editors
 * (parity with the Swing Administrator's global scripts panel).
 *
 * GET /server/globalScripts returns an XStream map:
 *     { entry: [{ string: ['Deploy', '<script>'] }, ...] }
 * The key strings are ScriptController's *_SCRIPT_KEY constants; the default
 * script bodies mirror JavaScriptConstants.DEFAULT_GLOBAL_*.
 */

import { h, clear, toast, taskButton, confirmDialog, tabs, loading, saveFile, pickFile } from '@oie/web-ui';
import api from '@oie/web-api';
import { validateScript } from '../core/serialize.js';

/* ScriptController script keys + JavaScriptConstants default bodies */
const SCRIPTS = [
    {
        key: 'Deploy',
        label: 'Deploy',
        defaultValue: '// This script executes once for each deploy or redeploy task\n// You only have access to the globalMap here to persist data\nreturn;'
    },
    {
        key: 'Undeploy',
        label: 'Undeploy',
        defaultValue: '// This script executes once for each deploy, undeploy, or redeploy task\n// if at least one channel was undeployed\n// You only have access to the globalMap here to persist data\nreturn;'
    },
    {
        key: 'Preprocessor',
        label: 'Preprocessor',
        defaultValue: '// Modify the message variable below to pre process data\n// This script applies across all channels\nreturn message;'
    },
    {
        key: 'Postprocessor',
        label: 'Postprocessor',
        defaultValue: '// This script executes once after a message has been processed\n// This script applies across all channels\n// Responses returned from here will be stored as "Postprocessor" in the response map\n// You have access to "response", if returned from the channel postprocessor\nreturn;'
    }
];

export function register(platform) {
    // Reached via task buttons (Dashboard/Channels), matching the Swing client.
    platform.registerView('/global-scripts', () => renderGlobalScripts(platform), { title: 'Global Scripts' });
}

function normalizeScripts(map) {
    const out = {};
    for (const entry of api.asList(map && map.entry)) {
        const pair = api.asList(entry.string);
        const key = String(pair[0] ?? '');
        if (key) out[key] = pair.length > 1 ? String(pair[1] ?? '') : '';
    }
    return out;
}

function renderGlobalScripts(platform) {
    let dirty = false;
    const editors = {};            // key -> CodeEditor

    for (const def of SCRIPTS) {
        const editor = platform.createCodeEditor({
            value: def.defaultValue,
            language: 'javascript',
            onChange: () => { dirty = true; updateTaskVisibility(); }
        });
        editor.el.style.flex = '1';
        editor.el.style.minHeight = '0';
        editors[def.key] = editor;
    }

    const body = h('div.view-body.flush', { style: { display: 'flex', flexDirection: 'column' } }, loading('Loading global scripts…'));
    let scriptTabs = null;

    function buildTabs() {
        clear(body);
        scriptTabs = tabs(SCRIPTS.map(def => ({
            label: def.label,
            render: () => h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', padding: '12px 16px' } }, editors[def.key].el)
        })));
        body.appendChild(scriptTabs.el);
    }

    // Validate the active tab's script via the engine's Rhino compiler check
    // (Swing GlobalScriptsPanel "Validate Script").
    async function validateActive() {
        const def = SCRIPTS[(scriptTabs && scriptTabs.active >= 0) ? scriptTabs.active : 0];
        const result = await validateScript(editors[def.key].getValue());
        if (result.ok === true) toast(`${def.label} script validated successfully`);
        else if (result.ok === false) toast(`${def.label} script — ${result.message}`, 'error');
        else toast(result.message, 'warn');
    }

    async function load() {
        try {
            const scripts = normalizeScripts(await api.server.globalScripts());
            for (const def of SCRIPTS) {
                const value = scripts[def.key];
                editors[def.key].setValue(value === undefined || value === '' ? def.defaultValue : value);
            }
            dirty = false;
            updateTaskVisibility();
            buildTabs();
        } catch (e) {
            toast(`Load failed: ${e.message}`, 'error');
            buildTabs();
        }
    }

    async function save() {
        try {
            const map = { entry: SCRIPTS.map(def => ({ string: [def.key, editors[def.key].getValue()] })) };
            await api.server.setGlobalScripts(map);
            dirty = false;
            updateTaskVisibility();
            toast('Global scripts saved');
        } catch (e) {
            toast(`Save failed: ${e.message}`, 'error');
        }
    }

    /* Import/export use the engine's own XStream <map> XML so the files are
       interchangeable with the Swing Administrator's global scripts export. */
    async function exportScripts() {
        try {
            await saveFile('globalScripts.xml', 'application/xml', () => api.getXml('/server/globalScripts'));
        } catch (e) {
            toast(`Export failed: ${e.message}`, 'error');
        }
    }

    async function importScripts() {
        const file = await pickFile('.xml');
        if (!file) return;
        if (!await confirmDialog('Import Scripts',
            `Import "${file.name}"? This overwrites all four global scripts on the server.`,
            { danger: true, okLabel: 'Import' })) return;
        try {
            const content = String(file.content || '').trim();
            if (!content.startsWith('<')) throw new Error('Expected a global scripts XML <map> export');
            await api.putXml('/server/globalScripts', content);
            toast(`Imported ${file.name}`);
            await load();
        } catch (e) {
            toast(`Import failed: ${e.message}`, 'error');
        }
    }

    // Swing Script Tasks pane is flat: Save Scripts only appears once a script
    // is edited (TASK_GLOBAL_SCRIPTS_SAVE, gated on the dirty flag); Validate /
    // Import / Export are always available.
    const saveBtn = taskButton('Save Scripts', 'save', save, { primary: true });
    const taskbar = h('div.taskbar', { dataset: { paneTitle: 'Script Tasks' } },
        saveBtn,
        taskButton('Validate Script', 'check', validateActive),
        taskButton('Import Scripts', 'import', importScripts),
        taskButton('Export Scripts', 'export', exportScripts));

    function updateTaskVisibility() {
        saveBtn.classList.toggle('hidden', !dirty);
    }
    updateTaskVisibility();

    load();

    const el = h('div.view', taskbar, body);
    return { el };
}
