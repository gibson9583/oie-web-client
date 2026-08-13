/*
 * Global Scripts view (React port of views/global-scripts.js). Four script
 * editors (Deploy/Undeploy/Preprocessor/Postprocessor) in keep-mounted tabs, via
 * the <CodeEditor> island; Save appears only once a script is edited (dirty),
 * matching the Swing Script Tasks pane. Import/export reuse the engine's own
 * XStream <map> XML.
 *
 * The typeahead above the tabs jumps between scripts from already-loaded editor
 * text — no engine round-trip. A tiny DLM maps phrases (deploy, preprocess, …)
 * onto the matching tab.
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { toast, confirmDialog, saveFile, pickFile, modal, h } from '@oie/web-ui';
import api from '@oie/web-api';
import * as store from '../../core/store.js';
import { validateScript } from '../../core/serialize.js';
import { ViewTasks } from '../mount.jsx';
import { platform } from '@oie/web-shell';
import { RailPane, TaskButton, CodeEditor, Tabs } from '../ui.jsx';
import { ListFilterTypeahead, parseListFilter, type ListFilterSuggestion } from '../list-filter.jsx';


/* ScriptController script keys + JavaScriptConstants default bodies */
const SCRIPTS = [
    { key: 'Deploy', label: 'Deploy', defaultValue: '// This script executes once for each deploy or redeploy task\n// You only have access to the globalMap here to persist data\nreturn;', keywords: ['deploy', 'redeploy'] },
    { key: 'Undeploy', label: 'Undeploy', defaultValue: '// This script executes once for each deploy, undeploy, or redeploy task\n// if at least one channel was undeployed\n// You only have access to the globalMap here to persist data\nreturn;', keywords: ['undeploy'] },
    { key: 'Preprocessor', label: 'Preprocessor', defaultValue: '// Modify the message variable below to pre process data\n// This script applies across all channels\nreturn message;', keywords: ['preprocess', 'preprocessor', 'pre'] },
    { key: 'Postprocessor', label: 'Postprocessor', defaultValue: '// This script executes once after a message has been processed\n// This script applies across all channels\n// Responses returned from here will be stored as "Postprocessor" in the response map\n// You have access to "response", if returned from the channel postprocessor\nreturn;', keywords: ['postprocess', 'postprocessor', 'post'] }
];

/** Deterministic jump: phrase → script index, or -1. */
function dlmResolveScriptIndex(raw: string): number {
    const { field, needle } = parseListFilter(raw);
    if (!needle) return -1;
    if (field && field !== 'script' && field !== 'name') return -1;
    for (let i = 0; i < SCRIPTS.length; i++) {
        const def = SCRIPTS[i];
        const hay = [def.key, def.label, ...(def.keywords || [])].join(' ').toLowerCase();
        if (hay.includes(needle) || def.key.toLowerCase() === needle) return i;
    }
    return -1;
}

function normalizeScripts(map: any) {
    const out: any = {};
    for (const entry of api.asList(map && map.entry)) {
        const pair = api.asList(entry.string);
        const key = String(pair[0] ?? '');
        if (key) out[key] = pair.length > 1 ? String(pair[1] ?? '') : '';
    }
    return out;
}

export function GlobalScriptsView() {
    const [active, setActive] = useState(0);
    const [dirty, setDirty] = useState(false);
    const [jumpText, setJumpText] = useState('');
    const [contentRev, setContentRev] = useState(0);   // bump when editors load / change for local suggestions
    const editors = useRef<any>({});   // key -> CodeEditor imperative handle
    // Mirror dirty into a ref so the mount-once nav guard reads the live value.
    const dirtyRef = useRef(false);
    const setDirtyState = (v: any) => { dirtyRef.current = v; setDirty(v); };

    const markDirty = () => {
        setDirtyState(true);
        setContentRev((n) => n + 1);
    };

    const load = async () => {
        try {
            const scripts = normalizeScripts(await api.server.globalScripts());
            for (const def of SCRIPTS) {
                const value = scripts[def.key];
                editors.current[def.key]?.setValue(value === undefined || value === '' ? def.defaultValue : value);
            }
            setDirtyState(false);
            setContentRev((n) => n + 1);
        } catch (e: any) {
            toast(`Load failed: ${e.message}`, 'error');
        }
    };

    // Save / Don't Save / Cancel before leaving with unsaved scripts (Swing
    // parity). Users whose role can't save (script/doSaveGlobalScripts denied)
    // must not be offered a Save the server would reject — OK-only notice.
    function promptSave() {
        return new Promise((resolve: any) => {
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
        } catch (e: any) {
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
        } catch (e: any) {
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
        } catch (e: any) {
            toast(`Import failed: ${e.message}`, 'error');
        }
    }

    const suggestions = useMemo(() => {
        void contentRev;
        const out: ListFilterSuggestion[] = SCRIPTS.map((def) => ({
            value: def.label,
            kind: 'script',
            icon: 'code'
        }));
        // Optional content hits from in-memory editors (first matching line snippet).
        for (const def of SCRIPTS) {
            const body = String(editors.current[def.key]?.getValue?.() ?? def.defaultValue);
            const line = body.split(/\r?\n/).map((l: string) => l.trim()).find((l: string) => l && !l.startsWith('//'));
            if (line && line.length > 3) {
                out.push({
                    value: `${def.label} · ${line.slice(0, 48)}${line.length > 48 ? '…' : ''}`,
                    kind: 'script',
                    icon: 'search'
                });
            }
        }
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contentRev]);

    function applyJump(raw: string) {
        const text = String(raw || '').trim();
        if (!text) return;
        const scoped = /^script:\s*(.+)$/i.exec(text);
        if (scoped) {
            const label = scoped[1].split('·')[0].trim().toLowerCase();
            const idx = SCRIPTS.findIndex((d) => d.label.toLowerCase() === label || d.key.toLowerCase() === label);
            if (idx >= 0) { setActive(idx); return; }
        }
        const idx = dlmResolveScriptIndex(text);
        if (idx >= 0) { setActive(idx); return; }
        const needle = text.toLowerCase();
        for (let i = 0; i < SCRIPTS.length; i++) {
            const body = String(editors.current[SCRIPTS[i].key]?.getValue?.() ?? '').toLowerCase();
            if (body.includes(needle)) { setActive(i); return; }
        }
    }

    function onJumpChange(raw: string) {
        setJumpText(raw);
        // Typeahead picks land as script:Label — jump immediately.
        if (/^script:/i.test(raw.trim())) applyJump(raw);
    }

    const tabs = SCRIPTS.map((def: any) => ({
        label: def.label,
        content: (
            <div className="flex flex-col flex-1 min-h-0 py-3 px-4">
                <CodeEditor ref={(h: any) => { editors.current[def.key] = h; }}
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
                <div className="filterbar panel overflow-visible mx-[13px] mt-3 mb-1">
                    <label>Jump:</label>
                    <ListFilterTypeahead
                        id="globalscripts-jump-typeahead"
                        value={jumpText}
                        onChange={onJumpChange}
                        onSubmit={applyJump}
                        suggestions={suggestions}
                        placeholder="Deploy, preprocess, or in-script text…"
                    />
                    <span className="counts">{SCRIPTS[active]?.label}</span>
                </div>
                <Tabs tabs={tabs} active={active} onActiveChange={setActive} label="Global scripts" />
            </div>
        </div>
    );
}
