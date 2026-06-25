/*
 * Alerts list (React port of the list half of views/alerts.js). Multi-select
 * table + the selection-gated Alert Tasks pane. The alert EDITOR is now also
 * React (../views/alert-editor.jsx): its connector-granular channel tree and the
 * intricate AlertChannels serialization are reused verbatim there, mounted into
 * a ref'd host. Both halves register here.
 */

import { useState, useEffect, useRef } from 'react';
import { h, toast, confirmDialog, contextMenu, saveFile, pickFile } from '@oie/web-ui';
import api from '@oie/web-api';
import * as store from '../../core/store.js';
import * as router from '../../core/router.js';
import { reactView, ViewTasks } from '../mount.jsx';
import { RailPane, TaskButton, DataTableHost } from '../ui.jsx';
import { newAlert, AlertEditor } from './alert-editor.jsx';

export function register(platform) {
    platform.registerNavItem({ id: 'alerts', label: 'Alerts', icon: 'alerts', path: '/alerts', section: 'Engine', order: 4, task: 'doShowAlerts' });
    platform.registerView('/alerts', reactView(AlertsList), { title: 'Alerts' });
    platform.registerView('/alerts/:alertId/edit', reactView(AlertEditor), { title: 'Edit Alert' });
}

const COLUMNS = [
    {
        key: 'enabled', label: 'Status', width: '90px',
        sortValue: (a) => a.enabled ? 0 : 1,
        render: (a) => a.enabled
            ? h('span.status-cell', h('span.pip.ok'), 'Enabled')
            : h('span.status-cell', h('span.pip'), h('span.text-text-dim', 'Disabled'))
    },
    { key: 'name', label: 'Name', render: (a) => a.name || '' },
    { key: 'id', label: 'Id', className: 'mono', render: (a) => h('span', { style: { color: 'var(--text-faint)' } }, a.id || '') }
];

function AlertsList() {
    const [alerts, setAlerts] = useState([]);
    const [sel, setSel] = useState([]);
    const tableRef = useRef(null);
    const alertsRef = useRef([]);   // full list, for export-all

    const selectedRows = () => (tableRef.current ? tableRef.current.selectedRows() : []);

    const refresh = async () => {
        try {
            const list = (await api.alerts.list()).filter(a => a && a.id);
            alertsRef.current = list;
            setAlerts(list);
            setSel(selectedRows());
        } catch (e) {
            toast(e.message, 'error');
        }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { refresh(); }, []);

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

    function newTask() {
        const model = newAlert('', store.getState('serverVersion'));
        store.setState('editingAlert', model);
        router.navigate(`/alerts/${model.id}/edit?new=1`);
    }
    function editTask() {
        const alert = single();
        if (alert) router.navigate(`/alerts/${alert.id}/edit`);
    }
    async function setEnabledTask(enabled) {
        const rows = multi();
        if (!rows) return;
        for (const alert of rows) {
            try { await (enabled ? api.alerts.enable(alert.id) : api.alerts.disable(alert.id)); }
            catch (e) { toast(e.message, 'error'); }
        }
        refresh();
    }
    async function deleteTask() {
        const rows = multi();
        if (!rows) return;
        if (!await confirmDialog('Delete alerts', `Permanently delete ${rows.length} alert(s)? This cannot be undone.`, { danger: true, okLabel: 'Delete' })) return;
        for (const alert of rows) {
            try { await api.alerts.remove(alert.id); } catch (e) { toast(e.message, 'error'); }
        }
        refresh();
    }
    async function importTask() {
        const file = await pickFile('.xml,.json');
        if (!file) return;
        try {
            const content = String(file.content || '').trim();
            if (content.startsWith('<')) {
                await api.postXml('/alerts', content);
            } else {
                let obj = JSON.parse(content);
                if (obj && typeof obj === 'object' && obj.alertModel) obj = obj.alertModel;
                await api.alerts.create(obj);
            }
            toast(`Imported ${file.name}`);
            refresh();
        } catch (e) {
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
        } catch (e) {
            toast(`Export failed: ${e.message}`, 'error');
        }
    }
    async function exportAllTask() {
        const all = alertsRef.current;
        if (!all.length) { toast('No alerts to export', 'warn'); return; }
        try {
            let count = 0;
            await saveFile('alerts.xml', 'application/xml', async () => {
                const parts = [];
                for (const a of all) {
                    const xml = await api.getXml(`/alerts/${a.id}`);
                    if (xml && String(xml).trim()) parts.push(String(xml).replace(/^<\?xml[^>]*\?>\s*/, '').trim());
                }
                count = parts.length;
                return `<list>\n${parts.join('\n')}\n</list>`;
            });
            if (count) toast(`Exported ${count} alert(s)`);
        } catch (e) {
            toast(`Export failed: ${e.message}`, 'error');
        }
    }

    const openMenu = (a, e) => {
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
        rowKey: (a) => a.id,
        emptyText: 'No alerts',
        columnsMenu: true,
        columnsMenuKey: 'webadmin-cols-alerts',
        onActivate: (a) => router.navigate(`/alerts/${a.id}/edit`),
        onSelect: (rows) => setSel(rows),
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
                    <DataTableHost columns={COLUMNS} options={options} rows={alerts}
                        onReady={(t) => { tableRef.current = t; }} />
                </div></div>
            </div>
        </div>
    );
}
