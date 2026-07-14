/*
 * Global Scripts view (React port of views/global-scripts.js). Four script
 * editors (Deploy/Undeploy/Preprocessor/Postprocessor) in keep-mounted tabs, via
 * the <CodeEditor> island; Save appears only once a script is edited (dirty),
 * matching the Swing Script Tasks pane. Import/export reuse the engine's own
 * XStream <map> XML.
 */

import { useState, useEffect, useRef } from 'react';
import { toast, confirmDialog, saveFile, pickFile, modal, h } from '@oie/web-ui';
import api from '@oie/web-api';
import * as store from '../../core/store.js';
import { validateScript } from '../../core/serialize.js';
import { reactView, ViewTasks } from '../mount.jsx';
import { platform } from '@oie/web-shell';
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
    // Mirror dirty into a ref so the mount-once nav guard reads the live value.
    const dirtyRef = useRef(false);
    const setDirtyState = (v) => { dirtyRef.current = v; setDirty(v); };

    const markDirty = () => setDirtyState(true);

    const load = async () => {
        try {
            const scripts = normalizeScripts(await api.server.globalScripts());
            for (const def of SCRIPTS) {
                const value = scripts[def.key];
                editors.current[def.key]?.setValue(value === undefined || value === '' ? def.defaultValue : value);
            }
            setDirtyState(false);
        } catch (e) {
            toast(`Load failed: ${e.message}`, 'error');
        }
    };

    // Save / Don't Save / Cancel before leaving with unsaved scripts (Swing
    // parity). Users whose role can't save (script/doSaveGlobalScripts denied)
    // must not be offered a Save the server would reject — OK-only notice.
    function promptSave() {
        return new Promise((resolve) => {
            if (!platform.checkTask('script', 'doSaveGlobalScripts')) {
                modal({
                    title: 'Unsaved Changes',
                    body: h('div', "You don't have permission to save the global scripts. Your changes will be discarded."),
                    onClose: () => resolve('cancel'),
                    buttons: [{ label: 'OK', primary: true, onClick: () => resolve('discard') }]
                });
                return;
            }
            modal({
                title: 'Unsaved Changes',
                body: h('div', 'You have unsaved changes to the global scripts. Would you like to save them?'),
                onClose: () => resolve('cancel'),
                buttons: [
                    { label: 'Cancel', onClick: () => resolve('cancel') },
                    { label: "Don't Save", danger: true, onClick: () => resolve('discard') },
                    { label: 'Save Changes', primary: true, onClick: () => resolve('save') }
                ]
            });
        });
    }

    useEffect(() => {
        load();
        store.setState('navGuard', async () => {
            if (!dirtyRef.current) return;
            const choice = await promptSave();
            if (choice === 'cancel') return false;
            // save() clears dirty on success; if it's still dirty the request
            // failed, so keep the user here rather than dropping their edits.
            if (choice === 'save') { await save(); if (dirtyRef.current) return false; }
            return undefined;
        });
        return () => store.setState('navGuard', null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function save() {
        try {
            const map = { entry: SCRIPTS.map(def => ({ string: [def.key, editors.current[def.key]?.getValue() ?? ''] })) };
            await api.server.setGlobalScripts(map);
            setDirtyState(false);
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
            <div className="flex flex-col flex-1 min-h-0 py-3 px-4">
                <CodeEditor ref={(h) => { editors.current[def.key] = h; }}
                    language="javascript" defaultValue={def.defaultValue}
                    onChange={markDirty} style={{ flex: 1 }} />
            </div>
        )
    }));

    return (
        <div className="view">
            <ViewTasks>
                <RailPane title="Script Tasks" paneKey="tasks:Script Tasks" group="script">
                    <div className="taskbar" data-pane-title="Script Tasks">
                        {dirty && <TaskButton label="Save Scripts" icon="save" primary task="doSaveGlobalScripts" onClick={save} />}
                        <TaskButton label="Validate Script" icon="check" task="doValidateCurrentGlobalScript" onClick={validateActive} />
                        <TaskButton label="Import Scripts" icon="import" task="doImportGlobalScripts" onClick={importScripts} />
                        <TaskButton label="Export Scripts" icon="export" task="doExportGlobalScripts" onClick={exportScripts} />
                    </div>
                </RailPane>
            </ViewTasks>
            <div className="view-body flush flex flex-col">
                <Tabs tabs={tabs} active={active} onActiveChange={setActive} />
            </div>
        </div>
    );
}
