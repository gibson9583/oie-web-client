/*
 * Extensions view — two metadata grids (Connectors / Plugins, mutually-
 * exclusive single selection) drive the selection-gated Extension Tasks pane
 * (Enable/Disable/Properties/Uninstall), plus a read-only Web Administrator
 * Plugins grid fed from the plugin loader's store key. Fully declarative: rows
 * are React state feeding controlled tables, enable/disable is an immutable
 * update, and the load-failure block is a rendered state. Actions take the row
 * EXPLICITLY (task pane passes `sel`, the context menu passes its row), so a
 * mount-captured menu can never act on a stale selection. The XStream
 * normalization (metaRows/propertyPairs) and the install/uninstall flows —
 * including the webadmin:restart-pending dispatch — are reused VERBATIM.
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { h, toast, modal, confirmDialog, contextMenu } from '@oie/web-ui';
import api from '@oie/web-api';
import { toDisplayString } from '../../core/xstream.js';
import { ViewTasks } from '../mount.jsx';
import { RailPane, TaskButton, DataTableHost } from '../ui.jsx';
import { Icon, useStoreKey } from '../bridges.jsx';
import { PanelSearch, rowMatchesFilter, type ListFilterSuggestion } from '../list-filter.jsx';


/* GET /extensions/connectors and /extensions/plugins return XStream maps:
   {entry:[{string: name, connectorMetaData|pluginMetaData: {...}}]} —
   normalize defensively (singleton entries, alternate value keys, plain
   name→metadata objects). */
function metaRows(raw: any, typeKey: any) {
    const rows: any[] = [];
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
        { key: 'name', label: 'Name', sortValue: (r: any) => r.name, render: (r: any) => r.name || r.meta.name || '' },
        { key: 'author', label: 'Author', sortValue: (r: any) => r.meta.author, render: (r: any) => r.meta.author || '' },
        { key: 'version', label: 'Version', width: '110px', className: 'mono', sortValue: (r: any) => r.meta.pluginVersion, render: (r: any) => r.meta.pluginVersion || '' },
        {
            key: 'enabled', label: 'Enabled', width: '110px',
            sortValue: (r: any) => r.enabled ? 0 : 1,
            render: (r: any) => r.enabled
                ? h('span.status-cell', h('span.pip.ok'), 'Enabled')
                : h('span.status-cell', h('span.pip'), h('span.text-text-dim', 'Disabled'))
        }
    ];
}

/* ---- web administrator plugins (client-side, from the plugin loader) ---- */

function statusTag(p: any) {
    if (p.status === 'loaded') return h('span.tag.accent', 'Loaded');
    if (p.status === 'error' || p.status === 'incompatible') {
        const label = p.status === 'incompatible' ? 'Incompatible' : 'Error';
        return h('span', h('span.tag.red', label),
            p.error ? h('span.text-err', { style: { marginLeft: '8px', fontSize: '11px' } }, String(p.error)) : null);
    }
    return h('span.tag', 'No client');
}

const WEB_COLUMNS = [
    { key: 'status', label: 'Status', width: '200px', sortValue: (p: any) => p.status, render: statusTag },
    { key: 'name', label: 'Name', render: (p: any) => p.name || p.id || '' },
    { key: 'version', label: 'Version', width: '100px', className: 'mono', render: (p: any) => p.version || '' },
    { key: 'author', label: 'Author', render: (p: any) => p.author || '' },
    { key: 'description', label: 'Description', render: (p: any) => p.description || '' }
];

const WEB_OPTIONS = {
    rowKey: (p: any) => p.id || p.name,
    emptyText: 'No web administrator plugins installed',
    columnsMenu: true,
    columnsMenuKey: 'webadmin-cols-webplugins'
};

/* java.util.Properties: {"property":[{"@name":"key","$":"value"}]} —
   fall back to {entry:...} maps and plain objects. */
function propertyPairs(raw: any) {
    const pairs: any[] = [];
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

export function ExtensionsView() {
    const [sel, setSel] = useState<any>(null);            // { name, meta, enabled } | null
    const [connectors, setConnectors] = useState([] as any[]);
    const [plugins, setPlugins] = useState([] as any[]);
    const [loadError, setLoadError] = useState<any>(null);
    const [filterText, setFilterText] = useState('');
    // The table instances are kept ONLY for clearSelection(): mutually-exclusive
    // selection across two independent tables is an imperative DataTable API.
    const connRef = useRef<any>(null);
    const plugRef = useRef<any>(null);

    const webPlugins = useStoreKey('webPlugins') || [];

    const matchExt = (r: any) => rowMatchesFilter(filterText, {
        name: r.name || r.meta?.name,
        id: r.name || r.meta?.name,
        author: r.meta?.author,
        version: r.meta?.pluginVersion
    });
    const matchWeb = (p: any) => rowMatchesFilter(filterText, {
        name: p.name || p.id,
        id: p.id,
        author: p.author,
        version: p.version
    });

    const visibleConnectors = useMemo(
        () => (filterText.trim() ? connectors.filter(matchExt) : connectors),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [connectors, filterText]
    );
    const visiblePlugins = useMemo(
        () => (filterText.trim() ? plugins.filter(matchExt) : plugins),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [plugins, filterText]
    );
    const visibleWebPlugins = useMemo(() => {
        const rows = webPlugins as any[];
        return filterText.trim() ? rows.filter(matchWeb) : rows;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [webPlugins, filterText]);

    const suggestions = useMemo(() => {
        const out: ListFilterSuggestion[] = [];
        const seen = new Set<string>();
        const add = (value: string, kind: string, iconName: string) => {
            const v = value.trim();
            if (!v || seen.has(`${kind}:${v}`)) return;
            seen.add(`${kind}:${v}`);
            out.push({ value: v, kind, icon: iconName });
        };
        for (const r of [...connectors, ...plugins]) {
            add(String(r.name || r.meta?.name || ''), 'name', 'puzzle');
            add(String(r.meta?.author || ''), 'author', 'users');
        }
        for (const p of webPlugins as any[]) {
            add(String(p.name || p.id || ''), 'name', 'puzzle');
            add(String(p.id || ''), 'id', 'search');
            add(String(p.author || ''), 'author', 'users');
        }
        return out;
    }, [connectors, plugins, webPlugins]);

    /* ---- selection helpers --------------------------------------------- */

    // Selecting in one table clears the other (the two grids share one selection).
    function chooseFrom(rows: any, otherRef: any) {
        const row = rows[0] || null;
        if (rows.length && otherRef.current) otherRef.current.clearSelection();
        setSel(row);
    }

    const requireRow = (s: any) => {
        if (!s) { toast('Select an extension first', 'warn'); return false; }
        return true;
    };

    /* ---- tasks (all take the target row explicitly) --------------------- */

    async function setEnabled(enabled: any, s: any) {
        if (!requireRow(s)) return;
        try {
            await api.extensions.setEnabled(s.name, enabled);
            const update = (rows: any) => rows.map((r: any) => (r.name === s.name ? { ...r, enabled } : r));
            setConnectors(update);
            setPlugins(update);
            setSel((prev: any) => (prev && prev.name === s.name ? { ...prev, enabled } : prev));
            toast(`${s.name} ${enabled ? 'enabled' : 'disabled'}. Restart the engine to apply.`);
        } catch (e: any) {
            toast(`${enabled ? 'Enable' : 'Disable'} failed: ${e.message}`, 'error');
        }
    }

    async function showProperties(s: any) {
        if (!requireRow(s)) return;
        try {
            const raw = await api.extensions.properties(s.name);
            const pairs = propertyPairs(raw);
            modal({
                title: `${s.name} — Properties`,
                size: 'wide',
                body: pairs.length
                    ? h('dl.kv', pairs.map(([k, v]) => [h('dt', k), h('dd', v)]))
                    : h('div.text-text-faint', 'No properties'),
                buttons: [{ label: 'Close', primary: true }]
            });
        } catch (e: any) {
            if (e.status === 404) toast('No properties', 'warn');
            else toast(`Failed to load properties: ${e.message}`, 'error');
        }
    }

    /* Engine-gated install: the zip is forwarded to the engine's own installer,
       which enforces EXTENSIONS_MANAGE, installs the extension, and serves any
       webadmin/ UI it carries (via /api/webplugins) — the web admin keeps no local
       copy. multipart/form-data, "file" part (the engine's @FormDataParam
       contract); api.post passes FormData through untouched and headers() adds
       X-Requested-With (the CSRF + cookie the server forwards). */
    function installExtension() {
        const input = h('input', { type: 'file', accept: '.zip', style: { display: 'none' } });
        input.addEventListener('change', async () => {
            const file = (input as any).files[0];
            input.remove();
            if (!file) return;
            try {
                const form = new FormData();
                form.append('file', file, file.name);
                // The engine installs the extension and serves any web UI it carries
                // (via /api/webplugins); both load after the engine restarts.
                await api.post('/_webadmin/plugins/_install', form);
                toast(`"${file.name}" installed — restart the engine to load it.`);
                window.dispatchEvent(new CustomEvent('webadmin:restart-pending'));
            } catch (e: any) {
                toast(`Install failed: ${e.message}`, 'error');
            }
        });
        document.body.appendChild(input);
        input.click();
    }

    /* Engine-gated uninstall: the extension's MetaData "path" is forwarded to the
       engine's _uninstall (which enforces EXTENSIONS_MANAGE and writes its uninstall
       marker, applied on the next engine restart). The engine owns the web half too,
       so removing the extension removes its UI — nothing is stored web-admin-side. */
    async function uninstallExtension(s: any) {
        if (!requireRow(s)) return;
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
                await api.post('/_webadmin/plugins/_uninstall',
                    JSON.stringify({ path: String(path) }),
                    { contentType: 'application/json' });
                toast(`${s.name} uninstalled — restart the engine to apply.`);
                window.dispatchEvent(new CustomEvent('webadmin:restart-pending'));
            } catch (e: any) {
                toast(`Uninstall failed: ${e.message}`, 'error');
            }
        }
    }

    /* ---- load ---------------------------------------------------------- */

    // load() also runs after installs/uninstalls; if the response lands after
    // the user navigated away, don't write state into the unmounted view.
    const aliveRef = useRef(true);
    useEffect(() => () => { aliveRef.current = false; }, []);

    async function load() {
        try {
            const [connRaw, plugRaw] = await Promise.all([api.extensions.connectors(), api.extensions.plugins()]);
            const conns = metaRows(connRaw, 'connectorMetaData');
            const plugs = metaRows(plugRaw, 'pluginMetaData');
            await Promise.all([...conns, ...plugs].map(async (row: any) => {
                try {
                    const v = await api.extensions.isEnabled(row.name);
                    row.enabled = v === true || String(v).trim() === 'true';
                } catch {
                    row.enabled = true;
                }
            }));
            if (!aliveRef.current) return;
            setConnectors(conns);
            setPlugins(plugs);
            setLoadError(null);
            // A reload prunes a vanished selection — resync the tracked row + tasks.
            setSel((prev: any) => (prev ? [...conns, ...plugs].find(r => r.name === prev.name) ?? null : null));
        } catch (e: any) {
            if (!aliveRef.current) return;
            toast(`Failed to load extensions: ${e.message}`, 'error');
            setLoadError(String(e.message || e));
        }
    }

    useEffect(() => { load(); }, []);

    /* ---- context menu (parity with the Swing Extensions tables) -------- */

    function extensionMenu(rows: any, otherRef: any, e: any) {
        chooseFrom(rows, otherRef);
        const row = rows[0];
        contextMenu(e.clientX, e.clientY, [
            { label: 'Refresh', icon: 'refresh', task: 'doRefreshExtensions', group: 'extensions', onClick: () => load() },
            '-',
            // Swing shows only the applicable action for the row's current state.
            // Each action targets THIS row explicitly (no selection-state read).
            { label: 'Enable Extension', icon: 'check', task: 'doEnableExtension', group: 'extensions', hidden: !!row.enabled, onClick: () => setEnabled(true, row) },
            { label: 'Disable Extension', icon: 'x', task: 'doDisableExtension', group: 'extensions', hidden: !row.enabled, onClick: () => setEnabled(false, row) },
            '-',
            { label: 'Show Properties', icon: 'eye', task: 'doShowExtensionProperties', group: 'extensions', onClick: () => showProperties(row) },
            '-',
            { label: 'Uninstall Extension', icon: 'trash', task: 'doUninstallExtension', group: 'extensions', danger: true, onClick: () => uninstallExtension(row) }
        ]);
    }

    const connOptions = useRef({
        selectable: 'single',
        rowKey: (r: any) => r.name,
        emptyText: 'No connectors installed',
        columnsMenu: true,
        columnsMenuKey: 'webadmin-cols-extensions',
        onSelect: (rows: any) => chooseFrom(rows, plugRef),
        onContextMenu: (row: any, e: any) => extensionMenu([row], plugRef, e)
    }).current;

    const plugOptions = useRef({
        selectable: 'single',
        rowKey: (r: any) => r.name,
        emptyText: 'No plugins installed',
        columnsMenu: true,
        columnsMenuKey: 'webadmin-cols-extensions',
        onSelect: (rows: any) => chooseFrom(rows, connRef),
        onContextMenu: (row: any, e: any) => extensionMenu([row], connRef, e)
    }).current;

    const connColumns = useRef(metaColumns()).current;
    const plugColumns = useRef(metaColumns()).current;

    return (
        <div className="view">
            <ViewTasks>
                <RailPane title="Extension Tasks" paneKey="tasks:Extension Tasks" group="extensions">
                    <div className="taskbar" data-pane-title="Extension Tasks">
                        <TaskButton label="Refresh" icon="refresh" task="doRefreshExtensions" onClick={load} />
                        {/* No Swing constant for Install — rides doRefreshExtensions
                            (every extensions task maps to manageExtensions anyway). */}
                        <TaskButton label="Install Extension" icon="import" task="doRefreshExtensions" onClick={installExtension} />
                        {sel && !sel.enabled && <TaskButton label="Enable" icon="check" task="doEnableExtension" onClick={() => setEnabled(true, sel)} />}
                        {sel && sel.enabled && <TaskButton label="Disable" icon="x" task="doDisableExtension" onClick={() => setEnabled(false, sel)} />}
                        {sel && <TaskButton label="Properties" icon="eye" task="doShowExtensionProperties" onClick={() => showProperties(sel)} />}
                        {sel && <TaskButton label="Uninstall" icon="trash" danger task="doUninstallExtension" onClick={() => uninstallExtension(sel)} />}
                    </div>
                </RailPane>
            </ViewTasks>
            <div className="view-body">
                <div className="panel">
                    <div className="panel-header">
                        <span>Connectors</span>
                        <PanelSearch
                            id="extensions-search"
                            value={filterText}
                            onChange={setFilterText}
                            suggestions={suggestions}
                            placeholder="Name, author…"
                            counts={filterText.trim()
                                ? `${visibleConnectors.length + visiblePlugins.length + visibleWebPlugins.length} shown`
                                : `${connectors.length + plugins.length + (webPlugins as any[]).length}`}
                        />
                    </div>
                    <div className="panel-body flush">
                        {loadError ? (
                            <div className="dt-empty">
                                <div className="empty-icon"><Icon name="warning" size={30} /></div>
                                <div>Failed to load</div>
                                <div className="text-text-faint mt-[13px]">{loadError}</div>
                            </div>
                        ) : (
                            <DataTableHost columns={connColumns} options={connOptions} rows={visibleConnectors}
                                onReady={(t: any) => { connRef.current = t; }} />
                        )}
                    </div>
                </div>
                <div className="panel">
                    <div className="panel-header">Plugins</div>
                    <div className="panel-body flush">
                        {loadError ? null : (
                            <DataTableHost columns={plugColumns} options={plugOptions} rows={visiblePlugins}
                                onReady={(t: any) => { plugRef.current = t; }} />
                        )}
                    </div>
                </div>
                <div className="panel">
                    <div className="panel-header">Web Administrator Plugins</div>
                    <div className="panel-body flush">
                        <DataTableHost columns={WEB_COLUMNS} options={WEB_OPTIONS} rows={visibleWebPlugins} />
                    </div>
                </div>
            </div>
        </div>
    );
}
