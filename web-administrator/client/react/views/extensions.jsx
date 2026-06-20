/*
 * Extensions view (React port of views/extensions.js). Two metadata grids
 * (Connectors / Plugins, mutually-exclusive single selection) drive the
 * selection-gated Extension Tasks pane (Enable/Disable/Properties/Uninstall),
 * plus a read-only Web Administrator Plugins grid fed from the plugin loader's
 * store key. The XStream normalization (metaRows/propertyPairs), the enabled
 * status pip, and the install/uninstall flows — including the
 * webadmin:restart-pending dispatch — are reused VERBATIM; only the rendering
 * layer is React.
 */

import { useState, useEffect, useRef } from 'react';
import { h, clear, icon, toast, modal, confirmDialog, contextMenu } from '@oie/web-ui';
import api from '@oie/web-api';
import { toDisplayString } from '../../core/xstream.js';
import { reactView, ViewTasks } from '../mount.jsx';
import { RailPane, TaskButton, DataTableHost } from '../ui.jsx';
import { useStoreKey } from '../bridges.jsx';

export function register(platform) {
    platform.registerNavItem({ id: 'extensions', label: 'Extensions', icon: 'extensions', path: '/extensions', section: 'Engine', order: 6 });
    platform.registerView('/extensions', reactView(ExtensionsView), { title: 'Extensions' });
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

/* ---- web administrator plugins (client-side, from the plugin loader) ---- */

function statusTag(p) {
    if (p.status === 'loaded') return h('span.tag.accent', 'Loaded');
    if (p.status === 'error') {
        return h('span', h('span.tag.red', 'Error'),
            p.error ? h('span.err-text', { style: { marginLeft: '8px', fontSize: '11px' } }, String(p.error)) : null);
    }
    return h('span.tag', 'No client');
}

const WEB_COLUMNS = [
    { key: 'status', label: 'Status', width: '200px', sortValue: (p) => p.status, render: statusTag },
    { key: 'name', label: 'Name', render: (p) => p.name || p.id || '' },
    { key: 'version', label: 'Version', width: '100px', className: 'mono', render: (p) => p.version || '' },
    { key: 'author', label: 'Author', render: (p) => p.author || '' },
    { key: 'description', label: 'Description', render: (p) => p.description || '' }
];

const WEB_OPTIONS = {
    rowKey: (p) => p.id || p.name,
    emptyText: 'No web administrator plugins installed',
    columnsMenu: true,
    columnsMenuKey: 'webadmin-cols-webplugins'
};

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

function ExtensionsView() {
    const [sel, setSel] = useState(null);   // { name, meta, enabled } | null
    const connRef = useRef(null);
    const plugRef = useRef(null);
    const selRef = useRef(null);             // latest selection, read by table callbacks captured at mount
    selRef.current = sel;

    const webPlugins = useStoreKey('webPlugins') || [];

    /* ---- selection helpers --------------------------------------------- */

    // Selecting in one table clears the other (the two grids share one selection).
    function chooseFrom(rows, otherRef) {
        const row = rows[0] || null;
        if (rows.length && otherRef.current) otherRef.current.clearSelection();
        setSel(row);
    }

    function requireSelection() {
        const s = selRef.current;
        if (!s) { toast('Select an extension first', 'warn'); return null; }
        return s;
    }

    /* ---- tasks --------------------------------------------------------- */

    async function setEnabled(enabled) {
        const s = requireSelection();
        if (!s) return;
        try {
            await api.extensions.setEnabled(s.name, enabled);
            s.enabled = enabled;
            connRef.current?.render();
            plugRef.current?.render();
            setSel({ ...s });
            toast(`${s.name} ${enabled ? 'enabled' : 'disabled'}. Restart the engine to apply.`);
        } catch (e) {
            toast(`${enabled ? 'Enable' : 'Disable'} failed: ${e.message}`, 'error');
        }
    }

    async function showProperties() {
        const s = requireSelection();
        if (!s) return;
        try {
            const raw = await api.extensions.properties(s.name);
            const pairs = propertyPairs(raw);
            modal({
                title: `${s.name} — Properties`,
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
        const s = requireSelection();
        if (!s) return;
        // MetaData.path is an XML attribute, so the engine's JSON exposes it
        // as "@path" (plain "path" kept as a fallback for safety).
        const path = s.meta && (s.meta['@path'] ?? s.meta.path);
        if (!path) {
            toast('The selected extension reports no install path, so it cannot be uninstalled here', 'warn');
            return;
        }
        if (await confirmDialog('Uninstall Extension',
            `Uninstall "${s.name}"? Its server-side files will be removed on the next engine restart. This cannot be undone.`,
            { danger: true, okLabel: 'Uninstall' })) {
            try {
                // The endpoint takes the body VERBATIM as the extension path —
                // do not wrap it (a wrapped body ends up in the uninstall marker
                // file literally and the launcher then deletes nothing).
                await api.post('/extensions/_uninstall', String(path), { contentType: 'application/json' });
                toast(`${s.name} uninstalled — restart the engine to apply`);
                window.dispatchEvent(new CustomEvent('webadmin:restart-pending'));
            } catch (e) {
                toast(`Uninstall failed: ${e.message}`, 'error');
            }
        }
    }

    /* ---- load ---------------------------------------------------------- */

    const connHostRef = useRef(null);
    const plugHostRef = useRef(null);

    async function load() {
        try {
            const [connRaw, plugRaw] = await Promise.all([api.extensions.connectors(), api.extensions.plugins()]);
            const connectors = metaRows(connRaw, 'connectorMetaData');
            const plugins = metaRows(plugRaw, 'pluginMetaData');
            await Promise.all([...connectors, ...plugins].map(async (row) => {
                try {
                    const v = await api.extensions.isEnabled(row.name);
                    row.enabled = v === true || String(v).trim() === 'true';
                } catch {
                    row.enabled = true;
                }
            }));
            connRef.current?.setRows(connectors);
            plugRef.current?.setRows(plugins);
            // setRows prunes vanished selections — resync the tracked row + tasks.
            const kept = (connRef.current?.selectedRows()[0]) || (plugRef.current?.selectedRows()[0]) || null;
            setSel(kept);
        } catch (e) {
            toast(`Failed to load extensions: ${e.message}`, 'error');
            const ch = connHostRef.current;
            const ph = plugHostRef.current;
            if (ch) clear(ch).appendChild(h('div.dt-empty',
                h('div.empty-icon', icon('warning', 30)),
                h('div', 'Failed to load'),
                h('div.faint.mt', String(e.message || e))));
            if (ph) clear(ph);
        }
    }

    useEffect(() => { load(); }, []);

    /* ---- context menu (parity with the Swing Extensions tables) -------- */

    function extensionMenu(rows, otherRef, e) {
        chooseFrom(rows, otherRef);
        const row = rows[0];
        contextMenu(e.clientX, e.clientY, [
            { label: 'Refresh', icon: 'refresh', onClick: () => load() },
            '-',
            // Swing shows only the applicable action for the row's current state.
            { label: 'Enable Extension', icon: 'check', hidden: !!row.enabled, onClick: () => setEnabled(true) },
            { label: 'Disable Extension', icon: 'x', hidden: !row.enabled, onClick: () => setEnabled(false) },
            '-',
            { label: 'Show Properties', icon: 'eye', onClick: () => showProperties() },
            '-',
            { label: 'Uninstall Extension', icon: 'trash', danger: true, onClick: () => uninstallExtension() }
        ]);
    }

    const connOptions = useRef({
        selectable: 'single',
        rowKey: (r) => r.name,
        emptyText: 'No connectors installed',
        columnsMenu: true,
        columnsMenuKey: 'webadmin-cols-extensions',
        onSelect: (rows) => chooseFrom(rows, plugRef),
        onContextMenu: (row, e) => extensionMenu([row], plugRef, e)
    }).current;

    const plugOptions = useRef({
        selectable: 'single',
        rowKey: (r) => r.name,
        emptyText: 'No plugins installed',
        columnsMenu: true,
        columnsMenuKey: 'webadmin-cols-extensions',
        onSelect: (rows) => chooseFrom(rows, connRef),
        onContextMenu: (row, e) => extensionMenu([row], connRef, e)
    }).current;

    const connColumns = useRef(metaColumns()).current;
    const plugColumns = useRef(metaColumns()).current;

    return (
        <div className="view">
            <ViewTasks>
                <RailPane title="Extension Tasks" paneKey="tasks:Extension Tasks">
                    <div className="taskbar" data-pane-title="Extension Tasks">
                        <TaskButton label="Refresh" icon="refresh" onClick={load} />
                        <TaskButton label="Install Extension" icon="import" onClick={installExtension} />
                        {sel && !sel.enabled && <TaskButton label="Enable" icon="check" onClick={() => setEnabled(true)} />}
                        {sel && sel.enabled && <TaskButton label="Disable" icon="x" onClick={() => setEnabled(false)} />}
                        {sel && <TaskButton label="Properties" icon="eye" onClick={showProperties} />}
                        {sel && <TaskButton label="Uninstall" icon="trash" danger onClick={uninstallExtension} />}
                    </div>
                </RailPane>
            </ViewTasks>
            <div className="view-body">
                <div className="panel">
                    <div className="panel-header">Connectors</div>
                    <div className="panel-body flush" ref={connHostRef}>
                        <DataTableHost columns={connColumns} options={connOptions}
                            onReady={(t) => { connRef.current = t; }} />
                    </div>
                </div>
                <div className="panel">
                    <div className="panel-header">Plugins</div>
                    <div className="panel-body flush" ref={plugHostRef}>
                        <DataTableHost columns={plugColumns} options={plugOptions}
                            onReady={(t) => { plugRef.current = t; }} />
                    </div>
                </div>
                <div className="panel">
                    <div className="panel-header">Web Administrator Plugins</div>
                    <div className="panel-body flush">
                        <DataTableHost columns={WEB_COLUMNS} options={WEB_OPTIONS} rows={webPlugins} />
                    </div>
                    <div className="panel-body">
                        <div className="hint">
                            Web administrator plugins are folders under the web administrator&apos;s plugins/ directory — see docs/PLUGINS.md.
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
