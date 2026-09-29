import { t as translate, tx as richText } from '../../core/i18n.js';
/*
 * Alerts list (React port of the list half of views/alerts.js). Multi-select
 * table + the selection-gated Alert Tasks pane. The alert EDITOR is now also
 * React (../views/alert-editor.jsx): its connector-granular channel tree and the
 * intricate AlertChannels serialization are reused verbatim there, mounted into
 * a ref'd host. Both halves register here.
 */

import { useState, useRef } from 'react';
import { h, icon, modal, toast, confirmDialog, promptDialog, contextMenu, saveFile, pickFile } from '@oie/web-ui';
import api, { uuid } from '@oie/web-api';
import * as store from '../../core/store.js';
import { captureEngineSession } from '../../core/engine-fetch.js';
import * as router from '../../core/router.js';
import { getPref, setPrefs } from '../../core/prefs.js';
import { useAlerts } from '../queries.js';
import { ViewTasks } from '../mount.jsx';
import { RailPane, TaskButton, DataTableHost } from '../ui.jsx';
import { Icon } from '../bridges.jsx';
import { platform } from '@oie/web-shell';
import { newAlert } from './alert-editor.jsx';
import { checkImportVersion } from '../../core/import-guard.js';


const COLUMNS = [
    {
        key: 'enabled', label: translate("Status"), width: '90px',
        sortValue: (a: any) => a.enabled ? 0 : 1,
        render: (a: any) => a.enabled
            ? h('span.status-cell', h('span.pip.ok'), translate("Enabled"))
            : h('span.status-cell', h('span.pip'), h('span.text-text-dim', translate("Disabled")))
    },
    { key: 'name', label: translate("Name"), render: (a: any) => a.name || '' },
    { key: 'id', label: translate("Id"), className: 'mono', render: (a: any) => h('span', { style: { color: 'var(--text-faint)' } }, a.id || '') }
];

export function AlertsList() {
    // Server state + Swing-parity polling via TanStack Query — useAlerts'
    // refetchInterval replaces the hand-rolled setTimeout loop (and the
    // destroyed/timer refs). Manual Refresh toasts on error; background polls
    // stay quiet — they self-heal on the next tick and Query keeps the last data.
    const alertsQuery = useAlerts();
    const alerts = alertsQuery.data ?? [];
    const [sel, setSel] = useState([] as any[]);
    const tableRef = useRef<any>(null);
    const importInFlight = useRef(false);

    const selectedRows = () => (tableRef.current ? tableRef.current.selectedRows() : []);

    const refresh = async () => {
        const r = await alertsQuery.refetch();
        if (r.error) toast(r.error.message, 'error');
        setSel(selectedRows());
    };

    function single() {
        const rows = selectedRows();
        if (rows.length !== 1) { toast(translate("Select a single alert"), 'warn'); return null; }
        return rows[0];
    }
    function multi() {
        const rows = selectedRows();
        if (!rows.length) { toast(translate("Select an alert first"), 'warn'); return null; }
        return rows;
    }

    function startClassicAlert() {
        const model = newAlert('', store.getState('serverVersion'));
        store.setState('editingAlert', model);
        router.navigate(`/alerts/${model.id}/edit?new=1`);
    }
    const startGuidedAlert = () => router.navigate('/alerts/new/guided');

    // New Alert: honor the saved default (Settings → Administrator), else show a
    // Classic-vs-Wizard chooser. "Remember" writes the pick to the default.
    function newTask() {
        const pref = getPref('newAlertDefault');
        if (pref === 'classic') return startClassicAlert();
        if (pref === 'guided') return startGuidedAlert();
        let remember = false;
        const card = (mode: any, iconName: any, title: any, desc: any) => h('button', {
            class: 'panel !mt-0 appearance-none text-[var(--text)] text-left p-3 flex gap-3 items-start cursor-pointer w-full hover:border-accent',
            style: { font: 'inherit' },
            onClick: () => {
                if (remember) setPrefs({ newAlertDefault: mode });
                m.close();
                if (mode === 'guided') startGuidedAlert(); else startClassicAlert();
            }
        }, icon(iconName, 20),
            h('div', h('div', { class: 'font-semibold' }, title), h('div.hint', desc)));
        const m = modal({
            title: translate("New Alert"),
            body: h('div', { class: 'flex flex-col gap-2.5 min-w-[396px]' },
                card('classic', 'edit', translate("Classic editor"), translate("The full editor — all options on one screen.")),
                card('guided', 'wand', translate("Wizard"), translate("A step-by-step guided builder: basics, trigger, channels, actions.")),
                h('label', { class: 'flex items-center gap-2 mt-2 text-text-dim' },
                    h('input', { type: 'checkbox', onChange: (e: any) => { remember = e.target.checked; } }),
                    translate("Remember my choice (set as default)"))),
            buttons: [{ label: translate("Cancel") }]
        });
    }
    function editTask() {
        const alert = single();
        if (alert) router.navigate(`/alerts/${alert.id}/edit`);
    }
    async function setEnabledTask(enabled: any) {
        const rows = multi();
        if (!rows) return;
        for (const alert of rows) {
            try { await (enabled ? api.alerts.enable(alert.id) : api.alerts.disable(alert.id)); }
            catch (e: any) { toast(e.message, 'error'); }
        }
        refresh();
    }
    async function deleteTask() {
        const rows = multi();
        if (!rows) return;
        if (!await confirmDialog(translate("Delete alerts"), translate("Permanently delete {value1} alert(s)? This cannot be undone.", { value1: String(rows.length) }), { danger: true, okLabel: translate("Delete") })) return;
        for (const alert of rows) {
            try { await api.alerts.remove(alert.id); } catch (e: any) { toast(e.message, 'error'); }
        }
        refresh();
    }
    async function importTask() {
        if (importInFlight.current) return;
        let assertSession: () => void;
        try { assertSession = captureEngineSession(); } catch { return; }
        importInFlight.current = true;
        let imported = 0;
        const refreshImported = async () => {
            const result = await alertsQuery.refetch();
            assertSession();
            if (result.error) toast(result.error.message, 'error');
            setSel(selectedRows());
        };
        try {
            const file = await pickFile('.xml,.json');
            assertSession();
            if (!file) return;
            const content = String(file.content || '').trim();
            // Resolve names against the server after the picker closes, and
            // remember each successful item while importing an exported list.
            const currentAlerts = await api.alerts.list();
            assertSession();
            const known = currentAlerts.map(alert => ({ id: String(alert.id), name: String(alert.name ?? '') }));
            const nameError = (name: string): string | null => {
                if (!name) return translate("Alert name cannot be empty.");
                if (!/^[a-zA-Z_0-9\- \t\n\r\f\v]*$/.test(name)) return translate("Alert name cannot have special characters besides hyphen, underscore, and space.");
                if (known.some(alert => alert.name.toLowerCase() === name.toLowerCase())) return translate("Alert \"{value1}\" already exists.", { value1: String(name) });
                return null;
            };
            const resolveIdentity = async (nameValue: any, idValue: any) => {
                let name = String(nameValue ?? '');
                let id = String(idValue || uuid());
                const warning = nameError(name);
                if (warning) {
                    // Swing validates every imported name. Its overwrite branch
                    // may explicitly proceed even when the warning is about an
                    // invalid name rather than an existing alert.
                    const choice = await new Promise<'overwrite' | 'create' | null>(resolve => modal({
                        title: translate("Import Alert"),
                        body: h('div', h('p', warning), h('p', translate("Would you like to overwrite the existing alert? Choose Create New to enter a valid, unique name."))),
                        onClose: () => resolve(null),
                        buttons: [
                            { label: translate("Cancel"), onClick: () => resolve(null) },
                            { label: translate("Create New"), onClick: () => resolve('create') },
                            { label: translate("Overwrite"), primary: true, onClick: () => resolve('overwrite') }
                        ]
                    }));
                    assertSession();
                    if (choice === null) return null;
                    if (choice === 'overwrite') {
                        const clash = known.find(alert => alert.name.toLowerCase() === name.toLowerCase());
                        if (clash) id = clash.id;
                    } else {
                        let error: string | null;
                        do {
                            const next = await promptDialog(translate("Import Alert"), translate("Please enter a new name for the alert."), name);
                            assertSession();
                            if (next == null) return null;
                            name = next;
                            error = nameError(name);
                            if (error) toast(error, 'warn');
                        } while (error);
                        id = uuid();
                    }
                }
                return { id, name };
            };
            const allowVersion = (version: any) => {
                const verdict = checkImportVersion(version, 'alert');
                if (verdict.action === 'ok') return Promise.resolve(true);
                return new Promise<boolean>(resolve => modal({
                    title: verdict.action === 'block' ? translate("Information") : translate("Select an Option"),
                    body: h('div', { style: 'white-space: pre-line' }, verdict.message),
                    onClose: () => resolve(false),
                    buttons: verdict.action === 'block'
                        ? [{ label: translate("OK"), primary: true, onClick: () => resolve(false) }]
                        : [
                            { label: translate("No"), onClick: () => resolve(false) },
                            { label: translate("Yes"), primary: true, onClick: () => resolve(true) }
                        ]
                }));
            };
            const allowVersions = async (versions: any[]) => {
                for (const version of [...new Set(versions.map(value => String(value || '')))]) {
                    const allowed = await allowVersion(version || undefined);
                    assertSession();
                    if (!allowed) return false;
                }
                return true;
            };

            if (content.startsWith('<')) {
                const doc = new DOMParser().parseFromString(content, 'text/xml');
                if (doc.querySelector('parsererror')) throw new Error(translate("Not a valid XML file"));
                const root = doc.documentElement;
                const elements = root.tagName === 'alertModel' ? [root] : [...root.querySelectorAll(':scope > alertModel')];
                if (!elements.length) throw new Error(translate("No alerts found in the file"));
                const rootVersion = root.getAttribute('version');
                if (!await allowVersions(rootVersion ? [rootVersion] : elements.map(element => element.getAttribute('version')))) return;
                for (const element of elements) {
                    const direct = (tag: string) => [...element.children].find(child => child.tagName === tag);
                    const identity = await resolveIdentity(direct('name')?.textContent, direct('id')?.textContent);
                    if (!identity) break;
                    for (const [tag, value] of Object.entries(identity)) {
                        let child = direct(tag);
                        if (!child) { child = doc.createElement(tag); element.appendChild(child); }
                        child.textContent = value;
                    }
                    try {
                        assertSession();
                        await api.postXml('/alerts', new XMLSerializer().serializeToString(element));
                        assertSession();
                        known.splice(0, known.length, ...known.filter(alert => alert.id !== identity.id), identity);
                        imported++;
                    } catch (e: any) {
                        assertSession();
                        toast(translate("Error importing alert: {value1}", { value1: String(e.message || e) }), 'error');
                    }
                }
            } else {
                let parsed = JSON.parse(content);
                if (parsed && typeof parsed === 'object' && parsed.list) parsed = parsed.list;
                const objects = api.asList(parsed && parsed.alertModel !== undefined ? parsed.alertModel : parsed);
                if (!objects.length) throw new Error(translate("No alerts found in the file"));
                if (!await allowVersions(parsed?.['@version'] ? [parsed['@version']] : objects.map(object => object?.['@version']))) return;
                for (const object of objects) {
                    const identity = await resolveIdentity(object?.name, object?.id);
                    if (!identity) break;
                    try {
                        assertSession();
                        await api.alerts.create({ ...object, ...identity });
                        assertSession();
                        known.splice(0, known.length, ...known.filter(alert => alert.id !== identity.id), identity);
                        imported++;
                    } catch (e: any) {
                        assertSession();
                        toast(translate("Error importing alert: {value1}", { value1: String(e.message || e) }), 'error');
                    }
                }
            }
            if (imported) toast(translate("{value2, plural, one {Imported {value1} alert from {value3}} other {Imported {value1} alerts from {value3}}}", { value1: String(imported), value2: imported, value3: String(file.name) }));
            await refreshImported();
        } catch (e: any) {
            try { assertSession(); } catch { return; }
            toast(imported
                ? translate("Import failed: {error} ({count, plural, one {# alert already imported} other {# alerts already imported}})", { error: String(e.message), count: imported })
                : translate("Import failed: {error}", { error: String(e.message) }), 'error');
            if (imported) {
                try { await refreshImported(); } catch { /* The session may have ended while refreshing. */ }
            }
        } finally {
            importInFlight.current = false;
        }
    }
    async function exportTask() {
        let assertSession: () => void;
        try { assertSession = captureEngineSession(); } catch { return; }
        const alert = single();
        if (!alert) return;
        try {
            await saveFile(`${alert.name || alert.id}.xml`, 'application/xml', async () => {
                const xml = await api.getXml(`/alerts/${alert.id}`);
                if (!xml || !String(xml).trim()) throw new Error(translate("Alert not found on the server"));
                return xml;
            }, assertSession);
            assertSession();
        } catch (e: any) {
            try { assertSession(); } catch { return; }
            toast(translate("Export failed: {value1}", { value1: String(e.message) }), 'error');
        }
    }
    async function exportAllTask() {
        let assertSession: () => void;
        try { assertSession = captureEngineSession(); } catch { return; }
        const all = alerts;
        if (!all.length) { toast(translate("No alerts to export"), 'warn'); return; }
        try {
            let count = 0;
            await saveFile('alerts.xml', 'application/xml', async () => {
                const parts: any[] = [];
                for (const a of all) {
                    const xml = await api.getXml(`/alerts/${a.id}`);
                    assertSession();
                    if (xml && String(xml).trim()) parts.push(String(xml).replace(/^<\?xml[^>]*\?>\s*/, '').trim());
                }
                count = parts.length;
                return `<list>\n${parts.join('\n')}\n</list>`;
            }, assertSession);
            assertSession();
            if (count) toast(translate("Exported {value1} alert(s)", { value1: String(count) }));
        } catch (e: any) {
            try { assertSession(); } catch { return; }
            toast(translate("Export failed: {value1}", { value1: String(e.message) }), 'error');
        }
    }

    const openMenu = (a: any, e: any) => {
        const rows = selectedRows();
        setSel(rows);
        const one = rows.length === 1 ? rows[0] : null;
        contextMenu(e.clientX, e.clientY, [
            { label: translate("Refresh"), icon: 'refresh', task: 'doRefreshAlerts', group: 'alert', onClick: () => refresh() },
            { label: translate("New Alert"), icon: 'plus', task: 'doNewAlert', group: 'alert', onClick: () => newTask() },
            { label: translate("Import Alert"), icon: 'import', task: 'doImportAlert', group: 'alert', onClick: () => importTask() },
            { label: translate("Export All Alerts"), icon: 'export', task: 'doExportAlerts', group: 'alert', onClick: () => exportAllTask() },
            '-',
            { label: translate("Export Alert"), icon: 'export', task: 'doExportAlert', group: 'alert', hidden: !one, onClick: () => exportTask() },
            { label: translate("Delete Alert"), icon: 'trash', task: 'doDeleteAlert', group: 'alert', danger: true, onClick: () => deleteTask() },
            { label: translate("Edit Alert"), icon: 'edit', task: 'doEditAlert', group: 'alert', hidden: !one, onClick: () => editTask() },
            { label: translate("Enable Alert"), icon: 'check', task: 'doEnableAlert', group: 'alert', hidden: !one || one.enabled, onClick: () => setEnabledTask(true) },
            { label: translate("Disable Alert"), icon: 'x', task: 'doDisableAlert', group: 'alert', hidden: !one || !one.enabled, onClick: () => setEnabledTask(false) }
        ]);
    };

    const options = useRef({
        selectable: 'multi',
        rowKey: (a: any) => a.id,
        emptyText: translate("No alerts"),
        columnsMenu: true,
        columnsMenuKey: 'webadmin-cols-alerts',
        onActivate: (a: any) => router.navigate(`/alerts/${a.id}/edit`),
        onSelect: (rows: any) => setSel(rows),
        onContextMenu: openMenu
    }).current;

    // Selection-gated visibility (Swing Alert Tasks pane): Export/Edit need a
    // single selection; Delete any; Enable/Disable show only the applicable one.
    const one = sel.length === 1 ? sel[0] : null;
    const showExport = !!one;
    const showEdit = !!one;
    const showDelete = sel.length > 0;
    const showEnable = sel.some(a => !a.enabled);
    const showDisable = sel.some(a => a.enabled);

    return (
        <div className="view">
            <ViewTasks>
                <RailPane title={translate("Alert Tasks")} paneKey="tasks:Alert Tasks" group="alert">
                    <div className="taskbar" data-pane-title="Alert Tasks">
                        <TaskButton label={translate("Refresh")} icon="refresh" task="doRefreshAlerts" onClick={refresh} />
                        <TaskButton label={translate("New Alert")} icon="plus" primary task="doNewAlert" onClick={newTask} />
                        <TaskButton label={translate("Import Alert")} icon="import" task="doImportAlert" onClick={importTask} />
                        <TaskButton label={translate("Export All Alerts")} icon="export" task="doExportAlerts" onClick={exportAllTask} />
                        {showExport && <TaskButton label={translate("Export Alert")} icon="export" task="doExportAlert" onClick={exportTask} />}
                        {showDelete && <TaskButton label={translate("Delete Alert")} icon="trash" danger task="doDeleteAlert" onClick={deleteTask} />}
                        {showEdit && <TaskButton label={translate("Edit Alert")} icon="edit" task="doEditAlert" onClick={editTask} />}
                        {showEnable && <TaskButton label={translate("Enable Alert")} icon="check" task="doEnableAlert" onClick={() => setEnabledTask(true)} />}
                        {showDisable && <TaskButton label={translate("Disable Alert")} icon="x" task="doDisableAlert" onClick={() => setEnabledTask(false)} />}
                    </div>
                </RailPane>
            </ViewTasks>
            <div className="view-body">
                <div className="panel"><div className="panel-body flush">
                    {alertsQuery.data === undefined ? (
                        <div className="loading-block">{richText("{value1}Loading alerts…", { value1: <div className="spinner" /> })}</div>
                    ) : alerts.length === 0 ? (
                        /* Empty landing state: explain what alerts do and offer the two
                           ways in (RBAC-gated like their task buttons). */
                        <div className="dt-empty">
                            <div className="empty-icon"><Icon name="alerts" size={30} /></div>
                            <div>{translate("No Alerts Configured")}</div>
                            <div className="mt-[14px] flex items-center justify-center gap-2">
                                {platform.checkTask('alert', 'doNewAlert') && (
                                    <button type="button" className="btn btn-primary" onClick={newTask}>{richText("{value1}Create Alert", { value1: <Icon name="plus" size={14} /> })}</button>
                                )}
                                {platform.checkTask('alert', 'doImportAlert') && (
                                    <button type="button" className="btn" onClick={importTask}>{richText("{value1}Import Alert", { value1: <Icon name="import" size={14} /> })}</button>
                                )}
                            </div>
                        </div>
                    ) : (
                        <DataTableHost columns={COLUMNS} options={options} rows={alerts}
                            onReady={(t: any) => { tableRef.current = t; }} />
                    )}
                </div></div>
            </div>
        </div>
    );
}
