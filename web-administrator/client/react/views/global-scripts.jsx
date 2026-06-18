/*
 * Global Scripts view (React port of views/global-scripts.js). Four script
 * editors (Deploy/Undeploy/Preprocessor/Postprocessor) in keep-mounted tabs, via
 * the <CodeEditor> island; Save appears only once a script is edited (dirty),
 * matching the Swing Script Tasks pane. Import/export reuse the engine's own
 * XStream <map> XML.
 */

import { useState, useEffect, useRef } from 'react';
import { toast, confirmDialog, saveFile, pickFile } from '@oie/web-ui';
import api from '@oie/web-api';
import { validateScript } from '../../core/serialize.js';
import { reactView, ViewTasks } from '../mount.jsx';
import { RailPane, TaskButton, CodeEditor, Tabs } from '../ui.jsx';

export function register(platform) {
    // Reached via task buttons (Dashboard/Channels), matching the Swing client.
    platform.registerView('/global-scripts', reactView(GlobalScriptsView), { title: 'Global Scripts' });
}

/* ScriptController script keys + JavaScriptConstants default bodies */
const SCRIPTS = [
    { key: 'Deploy', label: 'Deploy', defaultValue: '// This script executes once for each deploy or redeploy task\n// You only have access to the globalMap here to persist data\nreturn;' },
    { key: 'Undeploy', label: 'Undeploy', defaultValue: '// This script executes once for each deploy, undeploy, or redeploy task\n// if at least one channel was undeployed\n// You only have access to the globalMap here to persist data\nreturn;' },
    { key: 'Preprocessor', label: 'Preprocessor', defaultValue: '// Modify the message variable below to pre process data\n// This script applies across all channels\nreturn message;' },
    { key: 'Postprocessor', label: 'Postprocessor', defaultValue: '// This script executes once after a message has been processed\n// This script applies across all channels\n// Responses returned from here will be stored as "Postprocessor" in the response map\n// You have access to "response", if returned from the channel postprocessor\nreturn;' }
];

function normalizeScripts(map) {
    const out = {};
    for (const entry of api.asList(map && map.entry)) {
        const pair = api.asList(entry.string);
        const key = String(pair[0] ?? '');
        if (key) out[key] = pair.length > 1 ? String(pair[1] ?? '') : '';
    }
    return out;
}

function GlobalScriptsView() {
    const [active, setActive] = useState(0);
    const [dirty, setDirty] = useState(false);
    const editors = useRef({});   // key -> CodeEditor imperative handle

    const markDirty = () => setDirty(true);

    const load = async () => {
        try {
            const scripts = normalizeScripts(await api.server.globalScripts());
            for (const def of SCRIPTS) {
                const value = scripts[def.key];
                editors.current[def.key]?.setValue(value === undefined || value === '' ? def.defaultValue : value);
            }
            setDirty(false);
        } catch (e) {
            toast(`Load failed: ${e.message}`, 'error');
        }
    };
    useEffect(() => { load(); }, []);

    async function save() {
        try {
            const map = { entry: SCRIPTS.map(def => ({ string: [def.key, editors.current[def.key]?.getValue() ?? ''] })) };
            await api.server.setGlobalScripts(map);
            setDirty(false);
            toast('Global scripts saved');
        } catch (e) {
            toast(`Save failed: ${e.message}`, 'error');
        }
    }

    // Validate the active tab's script via the engine's Rhino compiler check.
    async function validateActive() {
        const def = SCRIPTS[active] || SCRIPTS[0];
        const result = await validateScript(editors.current[def.key]?.getValue() ?? '');
        if (result.ok === true) toast(`${def.label} script validated successfully`);
        else if (result.ok === false) toast(`${def.label} script — ${result.message}`, 'error');
        else toast(result.message, 'warn');
    }

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

    const tabs = SCRIPTS.map((def) => ({
        label: def.label,
        content: (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, padding: '12px 16px' }}>
                <CodeEditor ref={(h) => { editors.current[def.key] = h; }}
                    language="javascript" defaultValue={def.defaultValue}
                    onChange={markDirty} style={{ flex: 1 }} />
            </div>
        )
    }));

    return (
        <div className="view">
            <ViewTasks>
                <RailPane title="Script Tasks" paneKey="tasks:Script Tasks">
                    <div className="taskbar" data-pane-title="Script Tasks">
                        {dirty && <TaskButton label="Save Scripts" icon="save" primary onClick={save} />}
                        <TaskButton label="Validate Script" icon="check" onClick={validateActive} />
                        <TaskButton label="Import Scripts" icon="import" onClick={importScripts} />
                        <TaskButton label="Export Scripts" icon="export" onClick={exportScripts} />
                    </div>
                </RailPane>
            </ViewTasks>
            <div className="view-body flush" style={{ display: 'flex', flexDirection: 'column' }}>
                <Tabs tabs={tabs} active={active} onActiveChange={setActive} />
            </div>
        </div>
    );
}
