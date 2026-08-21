/*
 * Alerts list (React port of the list half of views/alerts.js). Multi-select
 * table + the selection-gated Alert Tasks pane. The alert EDITOR is now also
 * React (../views/alert-editor.jsx): its connector-granular channel tree and the
 * intricate AlertChannels serialization are reused verbatim there, mounted into
 * a ref'd host. Both halves register here.
 */

import { useState, useRef } from 'react';
import { h, icon, modal, toast, confirmDialog, contextMenu, saveFile, pickFile } from '@oie/web-ui';
import api from '@oie/web-api';
import * as store from '../../core/store.js';
import * as router from '../../core/router.js';
import { getPref, setPrefs } from '../../core/prefs.js';
import { useAlerts } from '../queries.js';
import { ViewTasks } from '../mount.jsx';
import { RailPane, TaskButton, DataTableHost } from '../ui.jsx';
import { Icon } from '../bridges.jsx';
import { platform } from '@oie/web-shell';
import { newAlert } from './alert-editor.jsx';
import { resolveImportName } from './import-dialogs.js';

/* Alerts carry no charset or length restriction on the name (unlike channels),
   so the shared resolver only enforces non-empty and unique. */
const ALERT_IMPORT_RULES = { title: 'Import Alert', noun: 'Alert' };


const COLUMNS = [
    {
        key: 'enabled', label: 'Status', width: '90px',
        sortValue: (a: any) => a.enabled ? 0 : 1,
        render: (a: any) => a.enabled
            ? h('span.status-cell', h('span.pip.ok'), 'Enabled')
            : h('span.status-cell', h('span.pip'), h('span.text-text-dim', 'Disabled'))
    },
    { key: 'name', label: 'Name', render: (a: any) => a.name || '' },
    { key: 'id', label: 'Id', className: 'mono', render: (a: any) => h('span', { style: { color: 'var(--text-faint)' } }, a.id || '') }
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

    const selectedRows = () => (tableRef.current ? tableRef.current.selectedRows() : []);

    const refresh = async () => {
        const r = await alertsQuery.refetch();
        if (r.error) toast(r.error.message, 'error');
        setSel(selectedRows());
    };

    function single() {
        const rows = selectedRows();
        if (rows.length !== 1) { toast('Select a single alert', 'warn'); return null; }
        return rows[0];
    }
    function multi() {
        const rows = selectedRows();
        if (!rows.length) { toast('Select an alert first', 'warn'); return null; }
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
            title: 'New Alert',
            body: h('div', { class: 'flex flex-col gap-2.5 min-w-[396px]' },
                card('classic', 'edit', 'Classic editor', 'The full editor — all options on one screen.'),
                card('guided', 'wand', 'Wizard', 'A step-by-step guided builder: basics, trigger, channels, actions.'),
                h('label', { class: 'flex items-center gap-2 mt-2 text-text-dim' },
                    h('input', { type: 'checkbox', onChange: (e: any) => { remember = e.target.checked; } }),
                    'Remember my choice (set as default)')),
            buttons: [{ label: 'Cancel' }]
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
        if (!await confirmDialog('Delete alerts', `Permanently delete ${rows.length} alert(s)? This cannot be undone.`, { danger: true, okLabel: 'Delete' })) return;
        for (const alert of rows) {
            try { await api.alerts.remove(alert.id); } catch (e: any) { toast(e.message, 'error'); }
        }
        refresh();
    }
    /* Resolve the incoming alert's identity against what's already here before
       posting anything (Swing Frame.importAlert). The engine's createAlert
       delegates to updateAlert, so it is create-or-replace by id: posting a file
       as-is silently replaced an existing alert whenever the ids matched. A name
       clash under a different id was rejected engine-side and surfaced as a raw
       error toast with no way forward.

       No version gate here, deliberately: Swing guards channels, groups and
       server configuration with promptObjectMigration but not alerts, whose
       import relies on the serializer's forward migration (see core/import-guard). */
    async function importTask() {
        const file = await pickFile('.xml,.json');
        if (!file) return;
        try {
            const content = String(file.content || '').trim();
            if (content.startsWith('<')) {
                const doc = new DOMParser().parseFromString(content, 'text/xml');
                if (doc.querySelector('parsererror')) throw new Error('Not a valid alert XML file');
                const root = doc.documentElement;
                const childOf = (tag: string) => [...root.children].find(c => c.tagName === tag);
                const setChild = (tag: string, value: string) => {
                    let el = childOf(tag);
                    if (!el) { el = doc.createElement(tag); root.appendChild(el); }
                    el.textContent = value;
                };
                const resolved = await resolveImportName(
                    childOf('name')?.textContent || '', childOf('id')?.textContent || '', alerts, ALERT_IMPORT_RULES);
                if (!resolved) return;                       // cancelled
                setChild('id', resolved.id);
                setChild('name', resolved.name);
                await api.postXml('/alerts', new XMLSerializer().serializeToString(doc));
            } else {
                let obj = JSON.parse(content);
                if (obj && typeof obj === 'object' && obj.alertModel) obj = obj.alertModel;
                const resolved = await resolveImportName(obj.name || '', obj.id || '', alerts, ALERT_IMPORT_RULES);
                if (!resolved) return;                       // cancelled
                obj.id = resolved.id;
                obj.name = resolved.name;
                await api.alerts.create(obj);
            }
            toast(`Imported ${file.name}`);
            refresh();
        } catch (e: any) {
            toast(`Import failed: ${e.message}`, 'error');
        }
    }
    async function exportTask() {
        const alert = single();
        if (!alert) return;
        try {
            await saveFile(`${alert.name || alert.id}.xml`, 'application/xml', async () => {
                const xml = await api.getXml(`/alerts/${alert.id}`);
                if (!xml || !String(xml).trim()) throw new Error('Alert not found on the server');
                return xml;
            });
        } catch (e: any) {
            toast(`Export failed: ${e.message}`, 'error');
        }
    }
    async function exportAllTask() {
        const all = alerts;
        if (!all.length) { toast('No alerts to export', 'warn'); return; }
        try {
            let count = 0;
            await saveFile('alerts.xml', 'application/xml', async () => {
                const parts: any[] = [];
                for (const a of all) {
                    const xml = await api.getXml(`/alerts/${a.id}`);
                    if (xml && String(xml).trim()) parts.push(String(xml).replace(/^<\?xml[^>]*\?>\s*/, '').trim());
                }
                count = parts.length;
                return `<list>\n${parts.join('\n')}\n</list>`;
            });
            if (count) toast(`Exported ${count} alert(s)`);
        } catch (e: any) {
            toast(`Export failed: ${e.message}`, 'error');
        }
    }

    const openMenu = (a: any, e: any) => {
        const rows = selectedRows();
        setSel(rows);
        const one = rows.length === 1 ? rows[0] : null;
        contextMenu(e.clientX, e.clientY, [
            { label: 'Refresh', icon: 'refresh', task: 'doRefreshAlerts', group: 'alert', onClick: () => refresh() },
            { label: 'New Alert', icon: 'plus', task: 'doNewAlert', group: 'alert', onClick: () => newTask() },
            { label: 'Import Alert', icon: 'import', task: 'doImportAlert', group: 'alert', onClick: () => importTask() },
            { label: 'Export All Alerts', icon: 'export', task: 'doExportAlerts', group: 'alert', onClick: () => exportAllTask() },
            '-',
            { label: 'Export Alert', icon: 'export', task: 'doExportAlert', group: 'alert', hidden: !one, onClick: () => exportTask() },
            { label: 'Delete Alert', icon: 'trash', task: 'doDeleteAlert', group: 'alert', danger: true, onClick: () => deleteTask() },
            { label: 'Edit Alert', icon: 'edit', task: 'doEditAlert', group: 'alert', hidden: !one, onClick: () => editTask() },
            { label: 'Enable Alert', icon: 'check', task: 'doEnableAlert', group: 'alert', hidden: !one || one.enabled, onClick: () => setEnabledTask(true) },
            { label: 'Disable Alert', icon: 'x', task: 'doDisableAlert', group: 'alert', hidden: !one || !one.enabled, onClick: () => setEnabledTask(false) }
        ]);
    };

    const options = useRef({
        selectable: 'multi',
        rowKey: (a: any) => a.id,
        emptyText: 'No alerts',
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
                <RailPane title="Alert Tasks" paneKey="tasks:Alert Tasks" group="alert">
                    <div className="taskbar" data-pane-title="Alert Tasks">
                        <TaskButton label="Refresh" icon="refresh" task="doRefreshAlerts" onClick={refresh} />
                        <TaskButton label="New Alert" icon="plus" primary task="doNewAlert" onClick={newTask} />
                        <TaskButton label="Import Alert" icon="import" task="doImportAlert" onClick={importTask} />
                        <TaskButton label="Export All Alerts" icon="export" task="doExportAlerts" onClick={exportAllTask} />
                        {showExport && <TaskButton label="Export Alert" icon="export" task="doExportAlert" onClick={exportTask} />}
                        {showDelete && <TaskButton label="Delete Alert" icon="trash" danger task="doDeleteAlert" onClick={deleteTask} />}
                        {showEdit && <TaskButton label="Edit Alert" icon="edit" task="doEditAlert" onClick={editTask} />}
                        {showEnable && <TaskButton label="Enable Alert" icon="check" task="doEnableAlert" onClick={() => setEnabledTask(true)} />}
                        {showDisable && <TaskButton label="Disable Alert" icon="x" task="doDisableAlert" onClick={() => setEnabledTask(false)} />}
                    </div>
                </RailPane>
            </ViewTasks>
            <div className="view-body">
                <div className="panel"><div className="panel-body flush">
                    {alertsQuery.data === undefined ? (
                        <div className="loading-block"><div className="spinner" />Loading alerts…</div>
                    ) : alerts.length === 0 ? (
                        /* Empty landing state: explain what alerts do and offer the two
                           ways in (RBAC-gated like their task buttons). */
                        <div className="dt-empty">
                            <div className="empty-icon"><Icon name="alerts" size={30} /></div>
                            <div>No Alerts Configured</div>
                            <div className="mt-[14px] flex items-center justify-center gap-2">
                                {platform.checkTask('alert', 'doNewAlert') && (
                                    <button type="button" className="btn btn-primary" onClick={newTask}>
                                        <Icon name="plus" size={14} />Create Alert
                                    </button>
                                )}
                                {platform.checkTask('alert', 'doImportAlert') && (
                                    <button type="button" className="btn" onClick={importTask}>
                                        <Icon name="import" size={14} />Import Alert
                                    </button>
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
