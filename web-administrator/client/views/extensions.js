/*
 * Extensions — installed connector and plugin metadata (parity with the Swing
 * ExtensionManagerPanel), plus the web administrator's own client-side
 * plugins. Enable/disable hits /extensions/{name}/_setEnabled; like the Swing
 * client, the enabled flag is read per extension via
 * /extensions/{name}/enabled because MetaData itself has no enabled field.
 */

import { h, clear, icon, toast, taskButton, modal, confirmDialog, DataTable, loading, contextMenu } from '@oie/web-ui';
import api from '@oie/web-api';
import { toDisplayString } from '../core/xstream.js';

export function register(platform) {
    platform.registerNavItem({ id: 'extensions', label: 'Extensions', icon: 'extensions', path: '/extensions', section: 'Engine', order: 6 });
    platform.registerView('/extensions', () => renderExtensions(platform), { title: 'Extensions' });
}

/* GET /extensions/connectors and /extensions/plugins return XStream maps:
   {entry:[{string: name, connectorMetaData|pluginMetaData: {...}}]} —
   normalize defensively (singleton entries, alternate value keys, plain
   name→metadata objects). */
function metaRows(raw, typeKey) {
    const rows = [];
    if (!raw || typeof raw !== 'object') return rows;
    if (raw.entry !== undefined) {
        for (const e of api.asList(raw.entry)) {
            if (!e || typeof e !== 'object') continue;
            const name = Array.isArray(e.string) ? e.string[0] : e.string;
            let meta = e[typeKey];
            if (meta === undefined || meta === null || typeof meta !== 'object') {
                for (const [k, v] of Object.entries(e)) {
                    if (k !== 'string' && v && typeof v === 'object') { meta = v; break; }
                }
            }
            if (!meta || typeof meta !== 'object') continue;
            rows.push({ name: String(name ?? meta.name ?? ''), meta, enabled: true });
        }
        return rows;
    }
    for (const [name, meta] of Object.entries(raw)) {
        if (name.startsWith('@')) continue;
        if (meta && typeof meta === 'object') rows.push({ name, meta, enabled: true });
    }
    return rows;
}

function metaColumns() {
    return [
        { key: 'name', label: 'Name', sortValue: (r) => r.name, render: (r) => r.name || r.meta.name || '' },
        { key: 'author', label: 'Author', sortValue: (r) => r.meta.author, render: (r) => r.meta.author || '' },
        { key: 'version', label: 'Version', width: '110px', className: 'mono', sortValue: (r) => r.meta.pluginVersion, render: (r) => r.meta.pluginVersion || '' },
        {
            key: 'enabled', label: 'Enabled', width: '110px',
            sortValue: (r) => r.enabled ? 0 : 1,
            render: (r) => r.enabled
                ? h('span.status-cell', h('span.pip.ok'), 'Enabled')
                : h('span.status-cell', h('span.pip'), h('span.muted', 'Disabled'))
        }
    ];
}

function renderExtensions(platform) {
    let selected = null;   // { name, meta, enabled }

    // Right-click parity with the Swing Extensions tables.
    function extensionMenu(row, otherTable, e) {
        selected = row;
        otherTable.clearSelection();
        updateTaskVisibility();
        contextMenu(e.clientX, e.clientY, [
            { label: 'Refresh', icon: 'refresh', onClick: () => load() },
            '-',
            { label: 'Enable Extension', icon: 'check', onClick: () => setEnabled(true) },
            { label: 'Disable Extension', icon: 'x', onClick: () => setEnabled(false) },
            '-',
            { label: 'Show Properties', icon: 'eye', onClick: () => showProperties() },
            '-',
            { label: 'Uninstall Extension', icon: 'trash', danger: true, onClick: () => uninstallExtension() }
        ]);
    }

    const connTable = new DataTable(metaColumns(), {
        selectable: 'single',
        rowKey: (r) => r.name,
        emptyText: 'No connectors installed',
        columnsMenu: true,
        columnsMenuKey: 'webadmin-cols-extensions',
        onSelect: (rows) => { selected = rows[0] || null; if (rows.length) plugTable.clearSelection(); updateTaskVisibility(); },
        onContextMenu: (row, e) => extensionMenu(row, plugTable, e)
    });
    const plugTable = new DataTable(metaColumns(), {
        selectable: 'single',
        rowKey: (r) => r.name,
        emptyText: 'No plugins installed',
        columnsMenu: true,
        columnsMenuKey: 'webadmin-cols-extensions',
        onSelect: (rows) => { selected = rows[0] || null; if (rows.length) connTable.clearSelection(); updateTaskVisibility(); },
        onContextMenu: (row, e) => extensionMenu(row, connTable, e)
    });

    /* ---- web administrator plugins (client-side, from the plugin loader) ---- */

    function statusTag(p) {
        if (p.status === 'loaded') return h('span.tag.accent', 'Loaded');
        if (p.status === 'error') {
            return h('span', h('span.tag.red', 'Error'),
                p.error ? h('span.err-text', { style: { marginLeft: '8px', fontSize: '11px' } }, String(p.error)) : null);
        }
        return h('span.tag', 'No client');
    }

    const webTable = new DataTable([
        { key: 'status', label: 'Status', width: '200px', sortValue: (p) => p.status, render: statusTag },
        { key: 'name', label: 'Name', render: (p) => p.name || p.id || '' },
        { key: 'version', label: 'Version', width: '100px', className: 'mono', render: (p) => p.version || '' },
        { key: 'author', label: 'Author', render: (p) => p.author || '' },
        { key: 'description', label: 'Description', render: (p) => p.description || '' }
    ], {
        rowKey: (p) => p.id || p.name,
        emptyText: 'No web administrator plugins installed'
    });
    webTable.setRows(platform.store.getState('webPlugins') || []);
    const unsubscribe = platform.store.subscribe('webPlugins', (rows) => webTable.setRows(rows || []));

    /* ---- tasks ----------------------------------------------------------- */

    function requireSelection() {
        if (!selected) { toast('Select an extension first', 'warn'); return null; }
        return selected;
    }

    async function setEnabled(enabled) {
        const sel = requireSelection();
        if (!sel) return;
        try {
            await api.extensions.setEnabled(sel.name, enabled);
            sel.enabled = enabled;
            connTable.render();
            plugTable.render();
            toast(`${sel.name} ${enabled ? 'enabled' : 'disabled'}. Restart the engine to apply.`);
        } catch (e) {
            toast(`${enabled ? 'Enable' : 'Disable'} failed: ${e.message}`, 'error');
        }
    }

    async function showProperties() {
        const sel = requireSelection();
        if (!sel) return;
        try {
            const raw = await api.extensions.properties(sel.name);
            const pairs = propertyPairs(raw);
            modal({
                title: `${sel.name} — Properties`,
                size: 'wide',
                body: pairs.length
                    ? h('dl.kv', pairs.map(([k, v]) => [h('dt', k), h('dd', v)]))
                    : h('div.faint', 'No properties'),
                buttons: [{ label: 'Close', primary: true }]
            });
        } catch (e) {
            if (e.status === 404) toast('No properties', 'warn');
            else toast(`Failed to load properties: ${e.message}`, 'error');
        }
    }

    /* POST /extensions/_install (verified in ExtensionServletInterface):
       multipart/form-data with the zip in a part named "file"
       (@FormDataParam("file")). api.post passes FormData through untouched so
       the browser sets the multipart boundary; the X-Requested-With header is
       added by headers() as usual. */
    function installExtension() {
        const input = h('input', { type: 'file', accept: '.zip', style: { display: 'none' } });
        input.addEventListener('change', async () => {
            const file = input.files[0];
            input.remove();
            if (!file) return;
            try {
                const form = new FormData();
                form.append('file', file, file.name);
                await api.post('/extensions/_install', form);
                toast(`"${file.name}" installed — restart the engine to load it`);
                window.dispatchEvent(new CustomEvent('webadmin:restart-pending'));
            } catch (e) {
                toast(`Install failed: ${e.message}`, 'error');
            }
        });
        document.body.appendChild(input);
        input.click();
    }

    /* POST /extensions/_uninstall: the body is the extension's MetaData
       "path" attribute sent VERBATIM (the engine writes the raw body straight
       into its extensions/uninstall marker, one path per line, consumed by
       the launcher at next startup). Never wrap it in JSON/XML. */
    async function uninstallExtension() {
        const sel = requireSelection();
        if (!sel) return;
        // MetaData.path is an XML attribute, so the engine's JSON exposes it
        // as "@path" (plain "path" kept as a fallback for safety).
        const path = sel.meta && (sel.meta['@path'] ?? sel.meta.path);
        if (!path) {
            toast('The selected extension reports no install path, so it cannot be uninstalled here', 'warn');
            return;
        }
        if (await confirmDialog('Uninstall Extension',
            `Uninstall "${sel.name}"? Its server-side files will be removed on the next engine restart. This cannot be undone.`,
            { danger: true, okLabel: 'Uninstall' })) {
            try {
                // The endpoint takes the body VERBATIM as the extension path —
                // do not wrap it (a wrapped body ends up in the uninstall marker
                // file literally and the launcher then deletes nothing).
                await api.post('/extensions/_uninstall', String(path), { contentType: 'application/json' });
                toast(`${sel.name} uninstalled — restart the engine to apply`);
                window.dispatchEvent(new CustomEvent('webadmin:restart-pending'));
            } catch (e) {
                toast(`Uninstall failed: ${e.message}`, 'error');
            }
        }
    }

    /* java.util.Properties: {"property":[{"@name":"key","$":"value"}]} —
       fall back to {entry:...} maps and plain objects. */
    function propertyPairs(raw) {
        const pairs = [];
        if (!raw || typeof raw !== 'object') return pairs;
        if (raw.property !== undefined) {
            for (const p of api.asList(raw.property)) {
                if (!p || typeof p !== 'object') continue;
                pairs.push([String(p['@name'] ?? p.name ?? ''), String(p.$ ?? p.value ?? '')]);
            }
            return pairs;
        }
        if (raw.entry !== undefined) {
            for (const e of api.asList(raw.entry)) {
                if (!e || typeof e !== 'object') continue;
                const s = e.string;
                if (Array.isArray(s)) pairs.push([String(s[0] ?? ''), s.length > 1 ? String(s[1] ?? '') : '']);
                else {
                    const vals = Object.values(e);
                    pairs.push([String(vals[0] ?? ''), vals.length > 1 ? String(vals[1] ?? '') : '']);
                }
            }
            return pairs;
        }
        for (const [k, v] of Object.entries(raw)) {
            if (k.startsWith('@')) continue;
            pairs.push([k, toDisplayString(v)]);
        }
        return pairs;
    }

    /* ---- load ------------------------------------------------------------ */

    const connHost = h('div.panel-body.flush', loading('Loading connectors…'));
    const plugHost = h('div.panel-body.flush', loading('Loading plugins…'));

    async function load() {
        try {
            const [connRaw, plugRaw] = await Promise.all([api.extensions.connectors(), api.extensions.plugins()]);
            const connectors = metaRows(connRaw, 'connectorMetaData');
            const plugins = metaRows(plugRaw, 'pluginMetaData');
            await Promise.all([...connectors, ...plugins].map(async (row) => {
                try {
                    const v = await api.extensions.isEnabled(row.name);
                    row.enabled = v === true || String(v).trim() === 'true';
                } catch (e) {
                    row.enabled = true;
                }
            }));
            connTable.setRows(connectors);
            plugTable.setRows(plugins);
            // setRows prunes vanished selections — resync the tracked row + tasks.
            selected = connTable.selectedRows()[0] || plugTable.selectedRows()[0] || null;
            updateTaskVisibility();
            clear(connHost).appendChild(connTable.el);
            clear(plugHost).appendChild(plugTable.el);
        } catch (e) {
            toast(`Failed to load extensions: ${e.message}`, 'error');
            clear(connHost).appendChild(h('div.dt-empty',
                h('div.empty-icon', icon('warning', 30)),
                h('div', 'Failed to load'),
                h('div.faint.mt', String(e.message || e))));
            clear(plugHost);
        }
    }

    // Selection-dependent tasks only show when an extension row is selected
    // (classic task-pane behavior).
    const ctxTasks = h('div.ctx-tasks.hidden',
        h('span.sep'),
        taskButton('Enable', 'check', () => setEnabled(true)),
        taskButton('Disable', 'x', () => setEnabled(false)),
        h('span.sep'),
        taskButton('Properties', 'eye', showProperties),
        h('span.sep'),
        taskButton('Uninstall', 'trash', uninstallExtension, { danger: true }));

    const taskbar = h('div.taskbar', { dataset: { paneTitle: 'Extension Tasks' } },
        taskButton('Refresh', 'refresh', load),
        taskButton('Install Extension', 'import', installExtension),
        ctxTasks);

    function updateTaskVisibility() {
        ctxTasks.classList.toggle('hidden', !selected);
    }

    load();

    const el = h('div.view',
        taskbar,
        h('div.view-body',
            h('div.panel', h('div.panel-header', 'Connectors'), connHost),
            h('div.panel', h('div.panel-header', 'Plugins'), plugHost),
            h('div.panel',
                h('div.panel-header', 'Web Administrator Plugins'),
                h('div.panel-body.flush', webTable.el),
                h('div.panel-body', h('div.hint',
                    'Web administrator plugins are folders under the web administrator\'s plugins/ directory — see docs/PLUGINS.md.')))));

    return { el, teardown: () => unsubscribe() };
}
