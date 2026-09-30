import { t } from '../../core/i18n.js';
/*
 * Global Scripts view (React port of views/global-scripts.js). Four script
 * editors (Deploy/Undeploy/Preprocessor/Postprocessor) in keep-mounted tabs, via
 * the <CodeEditor> island; Save appears only once a script is edited (dirty),
 * matching the Swing Script Tasks pane. Import/export reuse the engine's own
 * XStream <map> XML.
 */

import { withEditorSave } from '../save-lock.js';
import { useState, useEffect, useRef } from 'react';
import { toast, confirmDialog, saveFile, pickFile, modal, h } from '@oie/web-ui';
import api from '@oie/web-api';
import * as store from '../../core/store.js';
import { validateScript } from '../../core/serialize.js';
import { captureEngineSession } from '../../core/engine-fetch.js';
import { registerUnsavedCheck } from '../../core/unsaved.js';
import { ViewTasks } from '../mount.jsx';
import { platform } from '@oie/web-shell';
import { RailPane, TaskButton, CodeEditor, Tabs } from '../ui.jsx';


/* ScriptController script keys + JavaScriptConstants default bodies */
const SCRIPTS = [
    { key: 'Deploy', label: t("Deploy"), defaultValue: '// This script executes once for each deploy or redeploy task\n// You only have access to the globalMap here to persist data\nreturn;' },
    { key: 'Undeploy', label: t("Undeploy"), defaultValue: '// This script executes once for each deploy, undeploy, or redeploy task\n// if at least one channel was undeployed\n// You only have access to the globalMap here to persist data\nreturn;' },
    { key: 'Preprocessor', label: t("Preprocessor"), defaultValue: '// Modify the message variable below to pre process data\n// This script applies across all channels\nreturn message;' },
    { key: 'Postprocessor', label: t("Postprocessor"), defaultValue: '// This script executes once after a message has been processed\n// This script applies across all channels\n// Responses returned from here will be stored as "Postprocessor" in the response map\n// You have access to "response", if returned from the channel postprocessor\nreturn;' }
];

function parseScripts(xml: string, importing = false): Record<string, string> {
    // XStream's JSON writer coerces script text such as "123", "false" and
    // "null" into primitives. Read the same XML string map Swing receives.
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const map = doc.documentElement;
    const hasText = (element: Element) => Array.from(element.childNodes)
        .some(node => (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) && !!node.textContent?.trim());
    if (doc.querySelector('parsererror') || doc.doctype || map.tagName !== 'map' || hasText(map)) {
        throw new Error(t("Expected a global scripts XML <map> export."));
    }
    const out: Record<string, string> = Object.create(null);
    for (const entry of map.children) {
        const pair = Array.from(entry.children);
        if (entry.tagName !== 'entry' || entry.attributes.length > 0 || hasText(entry) || pair.length !== 2
            || pair.some(node => node.tagName !== 'string' || node.attributes.length > 0 || node.children.length > 0)) {
            throw new Error(t("Invalid global script entry."));
        }
        const key = pair[0].textContent ?? '';
        if (Object.hasOwn(out, key)) throw new Error(t("Duplicate global script entry."));
        out[key] = pair[1].textContent ?? '';
    }
    if (importing) {
        // Frame.doImportGlobalScripts migrates legacy Swing exports before
        // applying the supplied scripts to the existing editor draft.
        for (const key of Object.keys(out)) out[key] = out[key].replaceAll('com.webreach.mirth', 'com.mirth.connect');
        if (Object.hasOwn(out, 'Shutdown') && !Object.hasOwn(out, 'Undeploy')) {
            out.Undeploy = out.Shutdown;
            delete out.Shutdown;
        }
    }
    if (Object.keys(out).some(key => !SCRIPTS.some(def => def.key === key))) {
        throw new Error(t("Unknown global script entry."));
    }
    if (!importing && SCRIPTS.some(def => !Object.hasOwn(out, def.key))) {
        throw new Error(t("The engine returned an incomplete global scripts map."));
    }
    return out;
}

export function GlobalScriptsView() {
    const [active, setActive] = useState(0);
    const [dirty, setDirty] = useState(false);
    const [loadStatus, setLoadStatus] = useState('loading');
    const [scripts, setScripts] = useState<any>({});
    const readyRef = useRef(false);
    const loadGeneration = useRef(0);
    const editors = useRef<any>({});   // key -> CodeEditor imperative handle
    // Mirror dirty into a ref so the mount-once nav guard reads the live value.
    const dirtyRef = useRef(false);
    const setDirtyState = (v: any) => { dirtyRef.current = v; setDirty(v); };

    const markDirty = () => setDirtyState(true);
    useEffect(() => registerUnsavedCheck(() => dirtyRef.current), []);

    const load = async () => {
        const generation = ++loadGeneration.current;
        readyRef.current = false;
        setLoadStatus('loading');
        try {
            const scripts = parseScripts(await api.getXml('/server/globalScripts'));
            if (generation !== loadGeneration.current) return;
            setScripts(scripts);
            readyRef.current = true;
            setLoadStatus('loaded');
            setDirtyState(false);
        } catch (e: any) {
            if (generation !== loadGeneration.current) return;
            setLoadStatus('failed');
            toast(t("Load failed: {value1}", { value1: String(e.message) }), 'error');
        }
    };

    // Save / Don't Save / Cancel before leaving with unsaved scripts (Swing
    // parity). Users whose role can't save (script/doSaveGlobalScripts denied)
    // must not be offered a Save the server would reject — OK-only notice.
    function promptSave() {
        return new Promise((resolve: any) => {
            if (!platform.checkTask('script', 'doSaveGlobalScripts')) {
                modal({
                    title: t("Unsaved Changes"),
                    body: h('div', t("You don''t have permission to save the global scripts. Your changes will be discarded.")),
                    onClose: () => resolve('cancel'),
                    buttons: [{ label: t("OK"), primary: true, onClick: () => resolve('discard') }]
                });
                return;
            }
            modal({
                title: t("Unsaved Changes"),
                body: h('div', t("You have unsaved changes to the global scripts. Would you like to save them?")),
                onClose: () => resolve('cancel'),
                buttons: [
                    { label: t("Cancel"), onClick: () => resolve('cancel') },
                    { label: t("Don''t Save"), danger: true, onClick: () => resolve('discard') },
                    { label: t("Save Changes"), primary: true, onClick: () => resolve('save') }
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
        // This is a request counter, not a DOM ref: invalidate the latest generation at teardown.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        return () => { ++loadGeneration.current; readyRef.current = false; store.setState('navGuard', null); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function save() { return withEditorSave(saveUnlocked); }

    async function saveUnlocked() {
        if (!readyRef.current) return;
        const generation = loadGeneration.current;
        const token = store.getState('editorSave');
        const user = store.getState('user');
        const isCurrent = () => readyRef.current && generation === loadGeneration.current
            && !!user && store.getState('user') === user && store.getState('editorSave') === token;
        let assertSession: (() => void) | undefined;
        try {
            assertSession = captureEngineSession();
            const map = { entry: SCRIPTS.map(def => ({ string: [def.key, editors.current[def.key]?.getValue() ?? ''] })) };
            // Swing validates every global script in a Rhino function wrapper
            // before either Save or Save-and-Export can persist the map.
            const results = await Promise.all(map.entry.map(entry => validateScript(entry.string[1])));
            assertSession();
            if (!isCurrent()) return;
            const errors = results.flatMap((result, index) => result.ok === true ? [] : [
                result.ok === false
                    ? t("Error in global script \"{value1}\": {value2}", { value1: String(SCRIPTS[index].label), value2: String(result.message) })
                    : t("Validation unavailable for \"{value1}\": {value2}", { value1: String(SCRIPTS[index].label), value2: String(result.message || t("Try again when the engine validator is available.")) })
            ]);
            if (errors.length) throw new Error(errors.join('\n\n'));
            await api.server.setGlobalScripts(map);
            assertSession();
            if (!isCurrent()) return;
            setDirtyState(false);
            toast(t("Global scripts saved"));
        } catch (e: any) {
            if (!isCurrent()) return;
            try { assertSession?.(); } catch { return; }
            toast(t("Save failed: {value1}", { value1: String(e.message) }), 'error');
        }
    }

    // Validate the active tab's script via the engine's Rhino compiler check.
    async function validateActive() {
        const generation = loadGeneration.current;
        let assertSession: () => void;
        try { assertSession = captureEngineSession(); }
        catch { return; }
        const def = SCRIPTS[active] || SCRIPTS[0];
        const result = await validateScript(editors.current[def.key]?.getValue() ?? '');
        try { assertSession(); } catch { return; }
        if (!readyRef.current || generation !== loadGeneration.current) return;
        if (result.ok === true) toast(t("{value1} script validated successfully", { value1: String(def.label) }));
        else if (result.ok === false) toast(t("{value1} script — {value2}", { value1: String(def.label), value2: String(result.message) }), 'error');
        else toast(result.message, 'warn');
    }

    async function exportScripts() {
        return withEditorSave(async () => {
            let assertSession: () => void;
            try { assertSession = captureEngineSession(); }
            catch { return; }
            const generation = loadGeneration.current;
            const token = store.getState('editorSave');
            const user = store.getState('user');
            const isCurrent = () => {
                try { assertSession(); } catch { return false; }
                return generation === loadGeneration.current
                    && !!user && store.getState('user') === user && store.getState('editorSave') === token;
            };
            const assertCurrent = () => {
                assertSession();
                if (!isCurrent()) throw new Error(t("Export cancelled."));
            };
            if (dirtyRef.current) {
                if (!platform.checkTask('script', 'doSaveGlobalScripts')) {
                    toast(t("You don''t have permission to save the global scripts before exporting."), 'error');
                    return;
                }
                if (!await confirmDialog(t("Export Scripts"),
                    t("You must save your global scripts before exporting. Would you like to save them now?"),
                    { okLabel: t("Save and Export") }) || !isCurrent()) return;
                await saveUnlocked();
                if (!isCurrent() || dirtyRef.current) return;
            }
            try {
                await saveFile('globalScripts.xml', 'application/xml', async () => {
                    // A native file picker may outlive a forced sign-out. Do
                    // not fetch/export scripts for a later session when it closes.
                    assertCurrent();
                    const xml = await api.getXml('/server/globalScripts');
                    assertCurrent();
                    return xml;
                }, assertCurrent);
            } catch (e: any) {
                if (!isCurrent()) return;
                toast(t("Export failed: {value1}", { value1: String(e.message) }), 'error');
            }
        }, t("Exporting global scripts…"));
    }

    async function importScripts() {
        if (!readyRef.current) return;
        return withEditorSave(async () => {
            let assertSession: () => void;
            try { assertSession = captureEngineSession(); }
            catch { return; }
            const generation = loadGeneration.current;
            const token = store.getState('editorSave');
            const user = store.getState('user');
            // Pending file work belongs to this session, view and editor operation.
            const isCurrent = () => {
                try { assertSession(); } catch { return false; }
                return readyRef.current && generation === loadGeneration.current
                    && !!user && store.getState('user') === user && store.getState('editorSave') === token;
            };
            try {
                const file = await pickFile('.xml');
                if (!file || !isCurrent()) return;
                const imported = parseScripts(file.content, true);
                if (!await confirmDialog(t("Import Scripts"),
                    t("Import \"{value1}\" into the editor? Included scripts will replace your current drafts. Save Scripts applies the changes to the server.", { value1: String(file.name) }),
                    { danger: true, okLabel: t("Import") })) return;
                if (!isCurrent()) return;
                for (const [key, value] of Object.entries(imported)) editors.current[key]?.setValue(value);
                setDirtyState(true);
                toast(t("Imported {value1}", { value1: String(file.name) }));
            } catch (e: any) {
                if (!isCurrent()) return;
                toast(t("Import failed: {value1}", { value1: String(e.message) }), 'error');
            }
        }, t("Importing global scripts…"));
    }

    const tabs = SCRIPTS.map((def: any) => ({
        label: def.label,
        content: (
            <div className="flex flex-col flex-1 min-h-0 py-3 px-4">
                <CodeEditor ref={(h: any) => { editors.current[def.key] = h; }}
                    language="javascript" defaultValue={scripts[def.key] ?? def.defaultValue}
                    onChange={markDirty} style={{ flex: 1 }} />
            </div>
        )
    }));

    return (
        <div className="view">
            <ViewTasks>
                <RailPane title={t("Script Tasks")} paneKey="tasks:Script Tasks" group="script">
                    <div className="taskbar" data-pane-title="Script Tasks">
                        {dirty && loadStatus === 'loaded' && <TaskButton label={t("Save Scripts")} icon="save" primary task="doSaveGlobalScripts" onClick={save} />}
                        <TaskButton label={t("Validate Script")} icon="check" task="doValidateCurrentGlobalScript" disabled={loadStatus !== 'loaded'} onClick={validateActive} />
                        <TaskButton label={t("Import Scripts")} icon="import" task="doImportGlobalScripts" disabled={loadStatus !== 'loaded'} onClick={importScripts} />
                        <TaskButton label={t("Export Scripts")} icon="export" task="doExportGlobalScripts" onClick={exportScripts} />
                    </div>
                </RailPane>
            </ViewTasks>
            <div className="view-body flush flex flex-col">
                {loadStatus === 'loaded'
                    ? <Tabs tabs={tabs} active={active} onActiveChange={setActive} label={t("Global scripts")} />
                    : <div className="p-4" role="status">{loadStatus === 'loading' ? t("Loading global scripts…") : <>{t("Global scripts could not be loaded.")}<button className="btn" onClick={load}>{t("Retry")}</button>
                    </>}</div>}
            </div>
        </div>
    );
}
