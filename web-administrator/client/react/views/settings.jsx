/*
 * Settings view — server configuration with the same tabs as the Swing
 * Administrator's Settings panel: Server, Administrator, Tags, Configuration
 * Map, Database Tasks, Resources, plus any panels registered through
 * platform.registerSettingsPanel (e.g. Data Pruner), which append after the
 * built-ins.
 *
 * Every built-in tab body is a React component (controlled forms/grids +
 * DataTableHost tables), mounted through the SAME mountReact wrapper the
 * plugin panels use — the ctx contract (setTasks with DOM taskButton items,
 * markDirty/markClean/setSave) is unchanged, so plugin settings panels are
 * unaffected. The per-tab task pane is portaled into the rail via <ViewTasks>;
 * switching tabs swaps the pane (and title) reactively, no route change. Only
 * the active tab is mounted, and re-activating a tab reloads it.
 *
 * All writes round-trip the object shapes fetched from the engine so that XStream
 * "@class"/"@version" attributes and unknown keys survive. The per-tab Save lives
 * inside each tab's own task pane (Server/Tags/Configuration Map/Resources/Data
 * Pruner save; Administrator is localStorage-only; Database Tasks has no Save).
 */

import { useState, useEffect, useRef, useReducer, useMemo } from 'react';
import { h, clear, icon, toast, taskButton, confirmDialog, promptDialog, modal, DataTable, field, textInput, numberInput, select, checkbox, loading, saveFile, pickFile, contextMenu } from '@oie/web-ui';
import api from '@oie/web-api';
import { platform } from '@oie/web-shell';
import { getPref, setPrefs, resetPrefs } from '../../core/prefs.js';
import { checkImportVersionFromDoc } from '../../core/import-guard.js';
import { setTheme, getState, setState } from '../../core/store.js';
import { reactView, ViewTasks, mountReact } from '../mount.jsx';
import { applyEnvironmentColor, environmentColorVars, darkSurfaceTint, parseColorPref, serializeColorPref } from '../bridges.jsx';
import { PluginSlot } from '../plugin-slot.jsx';
import { RailPane, DataTableHost } from '../ui.jsx';

const DIRECTORY_RESOURCE_CLASS = 'com.mirth.connect.plugins.directoryresource.DirectoryResourceProperties';
const CONFIGURATION_PROPERTY_CLASS = 'com.mirth.connect.util.ConfigurationProperty';

export function register(platform) {
    platform.registerNavItem({ id: 'settings', label: 'Settings', icon: 'settings', path: '/settings', section: 'Engine', order: 3, task: 'doShowSettings' });
    platform.registerView('/settings', reactView(SettingsView), { title: 'Settings' });
}

/* ---- java.util.Properties helpers --------------------------------------------
   XStream serializes Properties as {"property":[{"@name":"key","$":"value"}]}.
   Be defensive about singletons, {entry:...} maps and plain objects, and keep
   every property (known or not) so saves never drop server-side keys. */

function listToProps(list) {
    return { property: list.map(p => ({ '@name': p.name, $: String(p.value ?? '') })) };
}

/* ---- java.awt.Color helpers ({red, green, blue, alpha}) ---- */

function colorCss(c) {
    if (c && typeof c === 'object' && c.red !== undefined) {
        return `rgb(${Number(c.red) || 0}, ${Number(c.green) || 0}, ${Number(c.blue) || 0})`;
    }
    return 'rgb(192, 192, 192)';
}

function colorToHex(c, fallback = '#c0c0c0') {
    const part = (v) => Math.max(0, Math.min(255, Number(v) || 0)).toString(16).padStart(2, '0');
    if (!c || typeof c !== 'object') return fallback;
    return '#' + part(c.red) + part(c.green) + part(c.blue);
}

function hexToColor(hex, alpha = 255) {
    const m = String(hex || '').match(/^#?([0-9a-f]{6})$/i);
    if (!m) return { red: 192, green: 192, blue: 192, alpha };
    return {
        red: parseInt(m[1].slice(0, 2), 16),
        green: parseInt(m[1].slice(2, 4), 16),
        blue: parseInt(m[1].slice(4, 6), 16),
        alpha
    };
}

function randomPastel() {
    const c = () => 140 + Math.floor(Math.random() * 116);
    return { red: c(), green: c(), blue: c(), alpha: 255 };
}

function swatch(color) {
    return h('span', {
        class: 'inline-block w-[14px] h-[14px] rounded-[3px] border border-line-strong align-middle',
        style: {
            background: colorCss(color)
        }
    });
}

/* ---- misc helpers ---- */

let radioSeq = 0;

function radioGroup(options, value, onChange) {
    const name = 'settings-rg-' + (radioSeq++);
    const inputs = options.map(o => h('input', {
        type: 'radio', name, value: o.value,
        checked: String(o.value) === String(value),
        onChange: () => onChange && onChange(o.value)
    }));
    return {
        el: h('div.radio-group.inline-row', options.map((o, i) => h('label', inputs[i], o.label))),
        get value() {
            const i = inputs.findIndex(x => x.checked);
            return i >= 0 ? options[i].value : value;
        },
        set value(v) { inputs.forEach((x, i) => { x.checked = String(options[i].value) === String(v); }); }
    };
}

function yesNo(initial, onChange) {
    const g = radioGroup(
        [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
        initial ? 'yes' : 'no',
        onChange ? (v) => onChange(v === 'yes') : null);
    return {
        el: g.el,
        get checked() { return g.value === 'yes'; },
        set checked(v) { g.value = v ? 'yes' : 'no'; }
    };
}

function loadFailed(host, e) {
    clear(host);
    host.appendChild(h('div.dt-empty',
        h('div.empty-icon', icon('warning', 30)),
        h('div', 'Failed to load'),
        h('div.text-text-faint.mt-[14px]', String(e.message || e))));
}

function tabHost() {
    return h('div', { class: 'p-3.5 overflow-auto flex-1' });
}

/* ---- React tab scaffolding ----------------------------------------------------
   Ported tab bodies are React components hosted through the SAME mountReact
   wrapper the plugin settings panels use (teardown tracked on the host node so
   SettingsTab unmounts the root on tab switch). The ctx contract is unchanged:
   React inputs dispatch native input/change events, so SettingsTab's host
   listeners keep driving markDirty; task panes still receive DOM taskButton
   items via ctx.setTasks (the one contract plugin panels share). */

function reactTab(ctx, Component) {
    const hostEl = tabHost();
    hostEl.__teardown = mountReact(hostEl, <Component ctx={ctx} />);
    return hostEl;
}

/* React twins of the radioGroup/yesNo builders (same DOM: .radio-group.inline-row). */
let reactRadioSeq = 0;
function RadioGroup({ options, value, onChange }) {
    const nameRef = useRef(null);
    if (!nameRef.current) nameRef.current = 'settings-rg-' + (reactRadioSeq++);
    return (
        <div className="radio-group inline-row">
            {options.map((o) => (
                <label key={String(o.value)}>
                    <input type="radio" name={nameRef.current} value={o.value}
                        checked={String(o.value) === String(value)}
                        onChange={() => onChange(o.value)} />
                    {o.label}
                </label>
            ))}
        </div>
    );
}

function YesNo({ value, onChange }) {
    return <RadioGroup value={value ? 'yes' : 'no'} onChange={(v) => onChange(v === 'yes')}
        options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />;
}

function TabLoadFailed({ error }) {
    return (
        <div className="dt-empty">
            <div className="empty-icon">{/* warning glyph, same as loadFailed() */}
                <span className="inline-flex" ref={(el) => { if (el && !el.firstChild) el.appendChild(icon('warning', 30)); }} />
            </div>
            <div>Failed to load</div>
            <div className="text-text-faint mt-[14px]">{String(error)}</div>
        </div>
    );
}

function Field({ label, children, className = '' }) {
    return <div className={'field ' + className}><label>{label}</label>{children}</div>;
}

/* Stacked label-left / control-right row (Swing settings layout; one preference
   per line). Module scope on purpose: defining it inside a tab would mint a new
   component type every render and remount each row — dropping input focus per
   keystroke and closing the native color picker mid-adjustment. */
function PrefRow({ label, children }) {
    return (
        <div className="flex items-center gap-4 py-2.5 px-0 border-b border-line">
            <label className="flex-1 m-0">{label}</label>
            <div className="flex-none">{children}</div>
        </div>
    );
}

/* =============================================================================
   Tab 1 — Server settings
   ServerSettings fields (verified in server/src/.../model/ServerSettings.java):
   environmentName, serverName, clearGlobalMap, queueBufferSize,
   defaultMetaDataColumns (List<MetaDataColumn> {name,type,mappingName}),
   defaultAdministratorBackgroundColor (java.awt.Color), smtpHost, smtpPort,
   smtpTimeout, smtpFrom, smtpSecure ('none'|'tls'|'ssl'), smtpAuth,
   smtpUsername, smtpPassword, loginNotificationEnabled,
   loginNotificationMessage, administratorAutoLogoutIntervalEnabled,
   administratorAutoLogoutIntervalField.
   ============================================================================ */

const DEFAULT_META_COLUMNS = {
    SOURCE: { name: 'SOURCE', type: 'STRING', mappingName: 'mirth_source' },
    TYPE: { name: 'TYPE', type: 'STRING', mappingName: 'mirth_type' },
    VERSION: { name: 'VERSION', type: 'STRING', mappingName: 'mirth_version' }
};

function ServerTab({ ctx }) {
    // Round-trip objects (mutated on save; unknown fields survive).
    const settingsRef = useRef(null);        // ServerSettings
    const updateSettingsRef = useRef(null);  // UpdateSettings {statsEnabled,...} | null
    const [form, setForm] = useState(null);  // null = loading
    const [loadError, setLoadError] = useState(null);
    const patch = (p) => setForm(f => ({ ...f, ...p }));

    async function load() {
        setForm(null);
        setLoadError(null);
        try {
            settingsRef.current = (await api.server.settings()) || {};
        } catch (e) {
            toast(`Failed to load server settings: ${e.message}`, 'error');
            setLoadError(String(e.message || e));
            return;
        }
        /* GET /server/updateSettings (verified in ConfigurationServletInterface;
           model UpdateSettings.statsEnabled). Best effort — the radios are
           simply omitted if it cannot be loaded. */
        try {
            updateSettingsRef.current = (await api.server.updateSettings()) || {};
        } catch {
            updateSettingsRef.current = null;
        }
        const s = settingsRef.current;
        const metaCols = api.asList(s.defaultMetaDataColumns, 'metaDataColumn')
            .filter(c => c && typeof c === 'object');
        const hasCol = (n) => metaCols.some(c => String(c.name || '').toUpperCase() === n);
        setForm({
            envName: s.environmentName ?? '',
            srvName: s.serverName ?? '',
            bgColor: colorToHex(s.defaultAdministratorBackgroundColor, '#2a75b2'),
            autoLogout: s.administratorAutoLogoutIntervalEnabled === true,
            autoLogoutInterval: String(s.administratorAutoLogoutIntervalField ?? 5),
            /* Default is "yes" when statsEnabled is null/absent, matching the
               Swing SettingsPanelServer behavior. */
            usageStats: updateSettingsRef.current ? updateSettingsRef.current.statsEnabled !== false : null,
            clearMap: s.clearGlobalMap === true,
            queueBuffer: String(s.queueBufferSize ?? ''),
            metaCols,
            metaSource: hasCol('SOURCE'), metaType: hasCol('TYPE'), metaVersion: hasCol('VERSION'),
            smtpHost: s.smtpHost ?? '', smtpPort: s.smtpPort ?? '',
            smtpTimeout: s.smtpTimeout ?? '', smtpFrom: s.smtpFrom ?? '',
            smtpSecure: String(s.smtpSecure || 'none').toLowerCase(),
            smtpAuth: s.smtpAuth === true,
            smtpUsername: s.smtpUsername ?? '', smtpPassword: s.smtpPassword ?? '',
            loginNotification: s.loginNotificationEnabled === true,
            loginNotificationMessage: s.loginNotificationMessage ?? ''
        });
    }

    async function save() {
        const settings = settingsRef.current;
        const f = formRef.current;
        if (!f || !settings) return;
        try {
            settings.environmentName = f.envName;
            settings.serverName = f.srvName;
            const alpha = settings.defaultAdministratorBackgroundColor?.alpha ?? 255;
            settings.defaultAdministratorBackgroundColor = hexToColor(f.bgColor, alpha);
            settings.administratorAutoLogoutIntervalEnabled = f.autoLogout;
            const interval = parseInt(f.autoLogoutInterval, 10);
            settings.administratorAutoLogoutIntervalField = isNaN(interval) ? 5 : interval;

            settings.clearGlobalMap = f.clearMap;
            if (String(f.queueBuffer) !== '') settings.queueBufferSize = parseInt(f.queueBuffer, 10);
            else delete settings.queueBufferSize;

            /* Rebuild defaultMetaDataColumns: known columns follow the
               checkboxes, unknown entries are preserved untouched. */
            const next = [];
            for (const name of ['SOURCE', 'TYPE', 'VERSION']) {
                const on = { SOURCE: f.metaSource, TYPE: f.metaType, VERSION: f.metaVersion }[name];
                if (!on) continue;
                next.push(f.metaCols.find(c => String(c.name || '').toUpperCase() === name) || DEFAULT_META_COLUMNS[name]);
            }
            for (const c of f.metaCols) {
                const n = String(c.name || '').toUpperCase();
                if (n !== 'SOURCE' && n !== 'TYPE' && n !== 'VERSION') next.push(c);
            }
            settings.defaultMetaDataColumns = Array.isArray(settings.defaultMetaDataColumns)
                ? next : { metaDataColumn: next };

            settings.smtpHost = f.smtpHost;
            settings.smtpPort = f.smtpPort;
            settings.smtpTimeout = f.smtpTimeout;
            settings.smtpFrom = f.smtpFrom;
            settings.smtpSecure = f.smtpSecure;
            settings.smtpAuth = f.smtpAuth;
            settings.smtpUsername = f.smtpUsername;
            settings.smtpPassword = f.smtpPassword;

            settings.loginNotificationEnabled = f.loginNotification;
            settings.loginNotificationMessage = f.loginNotificationMessage;

            await api.server.setSettings(settings);
            if (f.usageStats !== null && updateSettingsRef.current) {
                updateSettingsRef.current.statsEnabled = f.usageStats;
                await api.server.setUpdateSettings(updateSettingsRef.current);
            }
            // Re-tint the rail + topbar live with the saved color.
            applyEnvironmentColor(settings.defaultAdministratorBackgroundColor);
            toast('Server settings saved');
            ctx.markClean();
            return true;
        } catch (e) {
            toast(`Save failed: ${e.message}`, 'error');
            return false;
        }
    }

    // The task pane + ctx.setSave are registered ONCE (mount); they run the
    // LATEST load/save/form through refs.
    const formRef = useRef(null);
    formRef.current = form;
    const loadRef = useRef(load);
    loadRef.current = load;
    const saveRef = useRef(save);
    saveRef.current = save;

    function sendTestEmail() {
        const f = formRef.current;
        if (!f) return;
        /* Properties keys verified against SettingsPanelServer.sendTestEmail():
           port, encryption, host, timeout, authentication, username,
           password, toAddress, fromAddress. */
        const toInput = textInput(f.smtpFrom);
        modal({
            title: 'Send Test Email',
            body: field('To address', toInput),
            buttons: [
                { label: 'Cancel' },
                {
                    label: 'Send', primary: true,
                    onClick: async () => {
                        try {
                            const props = listToProps([
                                { name: 'port', value: f.smtpPort },
                                { name: 'encryption', value: f.smtpSecure },
                                { name: 'host', value: f.smtpHost },
                                { name: 'timeout', value: f.smtpTimeout },
                                { name: 'authentication', value: String(f.smtpAuth) },
                                { name: 'username', value: f.smtpUsername },
                                { name: 'password', value: f.smtpPassword },
                                { name: 'toAddress', value: toInput.value },
                                { name: 'fromAddress', value: f.smtpFrom }
                            ]);
                            const response = await api.server.testEmail(props);
                            const message = (response && typeof response === 'object' ? response.message : response) || 'Test email sent';
                            const failed = response && typeof response === 'object' && response.type && response.type !== 'SUCCESS';
                            toast(String(message), failed ? 'error' : 'info');
                        } catch (e) {
                            toast(`Test email failed: ${e.message}`, 'error');
                            return false;
                        }
                    }
                }
            ]
        });
    }

    async function backupConfig() {
        try {
            // Open the Save dialog within the click gesture; fetch inside the callback.
            await saveFile('server-configuration.xml', 'application/xml', async () => {
                const res = await fetch('/api/server/configuration', {
                    headers: { 'Accept': 'application/xml', 'X-Requested-With': 'OpenIntegrationEngine-WebAdmin' },
                    credentials: 'same-origin'
                });
                if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
                return res.text();
            });
        } catch (e) {
            toast(`Backup failed: ${e.message}`, 'error');
        }
    }

    // Swing alertInformation / "Select an Option" dialogs (pre-line renders \n).
    function migrationDialog(verdict) {
        if (verdict.action === 'block') {
            return new Promise((resolve) => modal({
                title: 'Information',
                body: h('div', { style: 'white-space: pre-line' }, verdict.message),
                onClose: () => resolve(false),
                buttons: [{ label: 'OK', primary: true, onClick: () => resolve(false) }]
            }));
        }
        return new Promise((resolve) => modal({
            title: 'Select an Option',
            body: h('div', { style: 'white-space: pre-line' }, verdict.message),
            onClose: () => resolve(false),
            buttons: [
                { label: 'No', onClick: () => resolve(false) },
                { label: 'Yes', primary: true, onClick: () => resolve(true) }
            ]
        }));
    }

    async function restoreConfig() {
        const file = await pickFile('.xml');
        if (!file) return;
        // Swing promptObjectMigration("server configuration") before the restore prompt.
        const verdict = checkImportVersionFromDoc(
            new DOMParser().parseFromString(String(file.content || '').trim(), 'text/xml'), 'server configuration');
        if (verdict.action !== 'ok' && !await migrationDialog(verdict)) return;
        // Match the Swing import prompt: deploy ON by default, overwrite config map OFF.
        const deployCheck = checkbox('Deploy all channels after import', true);
        const overwriteCheck = checkbox('Overwrite Configuration Map', false);
        // Swing labels the prompt with the configuration's saved date; fall back to the file name.
        const dateMatch = String(file.content || '').match(/<date>([^<]*)<\/date>/);
        const source = (dateMatch && dateMatch[1].trim()) || file.name;
        modal({
            title: 'Restore Server Configuration',
            body: h('div',
                h('div.mb-[14px]',
                    `Import configuration from ${source}? WARNING: This will overwrite all current channels, ` +
                    'alerts, server properties, and plugin properties.'),
                deployCheck.el,
                overwriteCheck.el),
            buttons: [
                { label: 'Cancel' },
                {
                    label: 'Restore', danger: true,
                    onClick: async () => {
                        try {
                            await api.put('/server/configuration', file.content, {
                                contentType: 'application/xml',
                                params: {
                                    deploy: deployCheck.input.checked,
                                    overwriteConfigMap: overwriteCheck.input.checked
                                }
                            });
                            toast('Server configuration restored');
                            loadRef.current();
                        } catch (e) {
                            toast(`Restore failed: ${e.message}`, 'error');
                            return false;
                        }
                    }
                }
            ]
        });
    }

    async function clearAllStatistics() {
        if (await confirmDialog('Clear All Statistics',
            'Clear the statistics (received, filtered, sent, errored) for all channels and connectors? This cannot be undone.',
            { danger: true, okLabel: 'Clear' })) {
            try {
                await api.statistics.clearAll();
                toast('All statistics cleared');
            } catch (e) {
                toast(`Clear failed: ${e.message}`, 'error');
            }
        }
    }

    useEffect(() => {
        ctx.setSave(() => saveRef.current());
        ctx.setTasks('Server Tasks', [
            taskButton('Refresh', 'refresh', () => loadRef.current(), { task: 'doRefresh', group: 'settings_Server' }),
            taskButton('Save', 'save', () => saveRef.current(), { primary: true, task: 'doSave', group: 'settings_Server' }),
            '-',
            taskButton('Backup Config', 'export', backupConfig, { task: 'doBackup', group: 'settings_Server' }),
            taskButton('Restore Config', 'import', restoreConfig, { task: 'doRestore', group: 'settings_Server' }),
            taskButton('Clear All Statistics', 'clear', clearAllStatistics, { danger: true, task: 'doClearAllStats', group: 'settings_Server' })
        ]);
        loadRef.current();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (loadError) return <TabLoadFailed error={loadError} />;
    if (!form) return <div className="loading-block"><div className="spinner" />Loading…</div>;

    /* Live preview of the rail + topbar tint in both light and dark mode
       (Swing's color-chooser Preview panel), updating as the color changes. */
    const previewColor = hexToColor(form.bgColor, 255);
    const miniPreview = (dark) => {
        const v = environmentColorVars(previewColor, dark);
        const surf = dark ? darkSurfaceTint(previewColor) : null;
        const paneBg = surf ? surf['--bg1'] : (dark ? '#111922' : '#f4f7fa');
        return (
            <div className="w-[190px]">
                <div className="text-[10px] text-text-faint mb-[3px] uppercase tracking-[0.1em]">{dark ? 'Dark mode' : 'Light mode'}</div>
                <div className="border border-line rounded overflow-hidden">
                    <div className="py-[5px] px-[9px] text-[11px] font-[650]" style={{ background: v.topbarBg, color: v.fg }}>Dashboard</div>
                    <div className="flex min-h-16">
                        <div className="py-[7px] px-2 w-16 text-[10px]" style={{ background: v.railBg }}>
                            <div className="font-bold tracking-[0.1em] mb-[3px]" style={{ color: v.fgDim }}>TASKS</div>
                            <div style={{ color: v.fg }}>Channels</div>
                            <div style={{ color: v.fgDim }}>Messages</div>
                            <div style={{ color: v.fgDim }}>Settings</div>
                        </div>
                        <div className="flex-1 p-2 text-[11px]" style={{ color: dark ? '#c8d4e0' : '#33414f', background: paneBg }}>Sample Text</div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <>
            <div className="panel">
                <div className="panel-header">General</div>
                <div className="panel-body"><div className="form-grid">
                    <Field label="Environment name">
                        <input type="text" value={form.envName} onChange={(e) => patch({ envName: e.target.value })} />
                    </Field>
                    <Field label="Server name">
                        <input type="text" value={form.srvName} onChange={(e) => patch({ srvName: e.target.value })} />
                    </Field>
                    <Field label="Default Background Color">
                        <div className="flex items-center">
                            <input type="color" className="w-[60px] p-0.5 h-8" value={form.bgColor}
                                onChange={(e) => patch({ bgColor: e.target.value })} />
                            {/* Reset the picker to the engine default (ServerSettings.DEFAULT_COLOR = 0x2A75B2). */}
                            <button type="button" className="btn ml-2" title="Reset to the default background color"
                                onClick={() => patch({ bgColor: '#2a75b2' })}>Restore Default</button>
                        </div>
                    </Field>
                    <div className="field span-2">
                        <label>Preview</label>
                        <div className="flex gap-3.5 flex-wrap">{miniPreview(false)}{miniPreview(true)}</div>
                    </div>
                    <Field label="Enable Auto Logout">
                        <YesNo value={form.autoLogout} onChange={(v) => patch({ autoLogout: v })} />
                    </Field>
                    <Field label="Auto Logout Interval (minutes)">
                        <input type="number" min="1" disabled={!form.autoLogout} value={form.autoLogoutInterval}
                            onChange={(e) => patch({ autoLogoutInterval: e.target.value })} />
                    </Field>
                    {form.usageStats !== null && (
                        <Field label="Provide usage statistics">
                            <YesNo value={form.usageStats} onChange={(v) => patch({ usageStats: v })} />
                        </Field>
                    )}
                </div></div>
            </div>
            <div className="panel">
                <div className="panel-header">Channel</div>
                <div className="panel-body"><div className="form-grid">
                    <Field label="Clear global map on redeploy">
                        <YesNo value={form.clearMap} onChange={(v) => patch({ clearMap: v })} />
                    </Field>
                    <Field label="Default Queue Buffer Size">
                        <input type="number" min="1" value={form.queueBuffer}
                            onChange={(e) => patch({ queueBuffer: e.target.value })} />
                    </Field>
                    <Field label="Default Metadata Columns">
                        <div className="radio-group inline-row">
                            <label className="check"><input type="checkbox" checked={form.metaSource} onChange={(e) => patch({ metaSource: e.target.checked })} />Source</label>
                            <label className="check"><input type="checkbox" checked={form.metaType} onChange={(e) => patch({ metaType: e.target.checked })} />Type</label>
                            <label className="check"><input type="checkbox" checked={form.metaVersion} onChange={(e) => patch({ metaVersion: e.target.checked })} />Version</label>
                        </div>
                    </Field>
                </div></div>
            </div>
            <div className="panel">
                <div className="panel-header">Email</div>
                <div className="panel-body"><div className="form-grid">
                    <Field label="SMTP Host">
                        <div className="flex items-center gap-2">
                            <input type="text" value={form.smtpHost} onChange={(e) => patch({ smtpHost: e.target.value })} />
                            <button type="button" className="btn whitespace-nowrap" onClick={sendTestEmail}>
                                <span className="inline-flex" ref={(el) => { if (el && !el.firstChild) el.appendChild(icon('mail')); }} />Send Test Email
                            </button>
                        </div>
                    </Field>
                    <Field label="SMTP Port">
                        <input type="text" value={form.smtpPort} onChange={(e) => patch({ smtpPort: e.target.value })} />
                    </Field>
                    <Field label="Send Timeout (ms)">
                        <input type="text" value={form.smtpTimeout} onChange={(e) => patch({ smtpTimeout: e.target.value })} />
                    </Field>
                    <Field label="Default From Address">
                        <input type="text" value={form.smtpFrom} onChange={(e) => patch({ smtpFrom: e.target.value })} />
                    </Field>
                    <Field label="Secure Connection">
                        <RadioGroup value={form.smtpSecure} onChange={(v) => patch({ smtpSecure: v })} options={[
                            { value: 'none', label: 'None' },
                            { value: 'tls', label: 'STARTTLS' },
                            { value: 'ssl', label: 'SSL' }
                        ]} />
                    </Field>
                    <Field label="Require Authentication">
                        <YesNo value={form.smtpAuth} onChange={(v) => patch({ smtpAuth: v })} />
                    </Field>
                    <Field label="Username">
                        <input type="text" disabled={!form.smtpAuth} value={form.smtpUsername}
                            onChange={(e) => patch({ smtpUsername: e.target.value })} />
                    </Field>
                    <Field label="Password">
                        <input type="password" disabled={!form.smtpAuth} value={form.smtpPassword}
                            onChange={(e) => patch({ smtpPassword: e.target.value })} />
                    </Field>
                </div></div>
            </div>
            <div className="panel">
                <div className="panel-header">Notification</div>
                <div className="panel-body">
                    <Field label="Require Login Notification and Consent">
                        <YesNo value={form.loginNotification} onChange={(v) => patch({ loginNotification: v })} />
                    </Field>
                    <Field label="Login Notification">
                        <textarea disabled={!form.loginNotification} value={form.loginNotificationMessage}
                            onChange={(e) => patch({ loginNotificationMessage: e.target.value })} />
                    </Field>
                </div>
            </div>
        </>
    );
}

/* =============================================================================
   Tab 2 — Channel tags
   ChannelTag: { id, name, channelIds (set of string), backgroundColor (Color) }
   ============================================================================ */

function fixTagName(name) {
    const fixed = String(name || '').replace(/[^a-zA-Z_0-9\-\s]/g, '').slice(0, 24);
    return fixed.trim() === '' ? '_' : fixed;
}

function channelIdNamePairs(raw) {
    const out = [];
    if (raw && typeof raw === 'object' && raw.entry !== undefined) {
        for (const e of api.asList(raw.entry)) {
            if (!e || typeof e !== 'object') continue;
            const s = e.string;
            if (Array.isArray(s)) out.push({ id: String(s[0] ?? ''), name: String(s[1] ?? s[0] ?? '') });
            else if (s !== undefined) out.push({ id: String(s), name: String(s) });
        }
    } else if (raw && typeof raw === 'object') {
        for (const [id, name] of Object.entries(raw)) {
            if (id.startsWith('@')) continue;
            out.push({ id, name: String(name ?? id) });
        }
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
}

/* =============================================================================
   Tab 2 — Administrator (browser preferences)
   The web-admin equivalent of the Swing SettingsPanelAdministrator, slimmed to
   the settings that actually apply to a browser client (System / User
   Preferences); stored per-browser via core/prefs.js.
   ============================================================================ */

function AdministratorTab({ ctx }) {
    const [form, setForm] = useState(null);
    const patch = (p) => setForm(f => ({ ...f, ...p }));
    const serverDefaultColorRef = useRef(null);   // loaded async, for the live re-tint on save
    const userId = getState('user')?.id;

    const yesNoAskValue = (val) => (['yes', 'no', 'ask'].includes(val) ? val : 'ask');
    const builderValue = (val) => (['ask', 'classic', 'guided'].includes(val) ? val : 'ask');

    function load() {
        setForm({
            dashRefresh: String(getPref('dashboardRefreshSeconds') ?? ''),
            msgPageSize: String(Number(getPref('messagePageSize')) || 20),
            evtPageSize: String(Number(getPref('eventPageSize')) || 20),
            formatMsgs: getPref('formatMessages') !== false,
            confirmReprocess: getPref('confirmReprocessRemove') !== false,
            importLibs: yesNoAskValue(getPref('importLibrariesWithChannels')),
            exportLibs: yesNoAskValue(getPref('exportLibrariesWithChannels')),
            newChannelDefault: builderValue(getPref('newChannelDefault')),
            newAlertDefault: builderValue(getPref('newAlertDefault')),
            showViewSwitch: getPref('showViewSwitch') !== false,
            theme: document.documentElement.dataset.theme || 'light',
            bgMode: 'default',
            bgColor: '#2a75b2'
        });
        // Per-user background-color override (Swing SettingsPanelAdministrator):
        // "Server Default" uses the server's color; "Custom" overrides it for
        // this user. Stored as the server user preference "backgroundColor".
        (async () => {
            try {
                const [srv, bgPref] = await Promise.all([
                    api.server.settings().catch(() => null),
                    // Single-key RAW read (see bridges.jsx / welcome.js): the bulk
                    // getPreferences collapses/mangles the <awt-color> value.
                    userId != null ? api.users.getPreference(userId, 'backgroundColor', { raw: true }).catch(() => null) : Promise.resolve(null)
                ]);
                serverDefaultColorRef.current = srv && srv.defaultAdministratorBackgroundColor;
                const override = parseColorPref(bgPref);
                if (override) patch({ bgMode: 'custom', bgColor: colorToHex(override, '#2a75b2') });
            } catch { /* ignore */ }
        })();
    }

    async function save() {
        const f = formRef.current;
        if (!f) return;
        setPrefs({
            dashboardRefreshSeconds: Math.max(1, parseInt(f.dashRefresh, 10) || 5),
            messagePageSize: Number(f.msgPageSize) || 20,
            eventPageSize: Number(f.evtPageSize) || 20,
            formatMessages: f.formatMsgs,
            confirmReprocessRemove: f.confirmReprocess,
            importLibrariesWithChannels: f.importLibs,
            exportLibrariesWithChannels: f.exportLibs,
            newChannelDefault: f.newChannelDefault,
            newAlertDefault: f.newAlertDefault,
            showViewSwitch: f.showViewSwitch
        });
        setTheme(f.theme);
        // Persist the per-user color override (or clear it) and re-tint live.
        // Swing (SettingsPanelAdministrator.doSave) writes this as a single
        // preference: setUserPreference(id, "backgroundColor", <awt-color xml>).
        // The whole-map PUT deserializes to a Java Properties server-side and
        // 500s on the <awt-color> value (issue #10), so mirror Swing exactly
        // and set just the one key (stored verbatim, no server-side parsing).
        if (userId != null) {
            try {
                let effective, value;
                if (f.bgMode === 'custom') {
                    const c = hexToColor(f.bgColor, 255);
                    value = serializeColorPref(c);   // <awt-color> XML (Swing-compatible)
                    effective = c;
                } else {
                    // Swing clears the override by writing ObjectXMLSerializer
                    // .serialize(null) === "<null/>" (NOT an empty string). Match
                    // it: both tools read a non-<awt-color> value as server
                    // default, and a non-empty value avoids an Oracle edge case
                    // where '' -> NULL breaks the insert/update existence check
                    // and can duplicate the preference row.
                    value = '<null/>';
                    effective = serverDefaultColorRef.current;
                }
                await api.users.setPreference(userId, 'backgroundColor', value);
                applyEnvironmentColor(effective);
            } catch (e) {
                toast(`Could not save background color: ${e.message}`, 'error');
            }
        }
        ctx.markClean();
        toast('Preferences saved');
        return true;
    }

    const formRef = useRef(null);
    formRef.current = form;
    const loadRef = useRef(load);
    loadRef.current = load;
    const saveRef = useRef(save);
    saveRef.current = save;

    useEffect(() => {
        ctx.setSave(() => saveRef.current());
        ctx.setTasks('Administrator Tasks', [
            taskButton('Refresh', 'refresh', () => loadRef.current(), { task: 'doRefresh', group: 'settings_Administrator' }),
            taskButton('Save', 'save', () => saveRef.current(), { primary: true, task: 'doSave', group: 'settings_Administrator' }),
            taskButton('Restore Defaults', 'refresh', () => { resetPrefs(); loadRef.current(); toast('Preferences reset to defaults'); }, { task: 'doSetAdminDefaults', group: 'settings_Administrator' })
        ]);
        loadRef.current();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (!form) return <div className="loading-block"><div className="spinner" />Loading…</div>;

    const pageSizeOptions = [20, 50, 100].map((n) => <option key={n} value={String(n)}>{n}</option>);

    return (
        <>
            <div className="panel">
                <div className="panel-header">System Preferences</div>
                <div className="panel-body">
                    <PrefRow label="Dashboard refresh interval (seconds)">
                        <input type="number" min="1" value={form.dashRefresh}
                            onChange={(e) => patch({ dashRefresh: e.target.value })} />
                    </PrefRow>
                    <PrefRow label="Message browser page size">
                        <select value={form.msgPageSize} onChange={(e) => patch({ msgPageSize: e.target.value })}>{pageSizeOptions}</select>
                    </PrefRow>
                    <PrefRow label="Event browser page size">
                        <select value={form.evtPageSize} onChange={(e) => patch({ evtPageSize: e.target.value })}>{pageSizeOptions}</select>
                    </PrefRow>
                    <PrefRow label="Format text in message browser">
                        <YesNo value={form.formatMsgs} onChange={(v) => patch({ formatMsgs: v })} />
                    </PrefRow>
                    <PrefRow label="Reprocess/remove messages confirmation">
                        <YesNo value={form.confirmReprocess} onChange={(v) => patch({ confirmReprocess: v })} />
                    </PrefRow>
                    <PrefRow label="Import code template libraries with channels">
                        <select value={form.importLibs} onChange={(e) => patch({ importLibs: e.target.value })}>
                            <option value="yes">Yes</option><option value="no">No</option><option value="ask">Ask</option>
                        </select>
                    </PrefRow>
                    <PrefRow label="Export code template libraries with channels">
                        <select value={form.exportLibs} onChange={(e) => patch({ exportLibs: e.target.value })}>
                            <option value="yes">Yes</option><option value="no">No</option><option value="ask">Ask</option>
                        </select>
                    </PrefRow>
                    <PrefRow label="Default new-channel builder">
                        <select value={form.newChannelDefault} onChange={(e) => patch({ newChannelDefault: e.target.value })}>
                            <option value="ask">Ask each time</option><option value="classic">Classic editor</option><option value="guided">Wizard</option>
                        </select>
                    </PrefRow>
                    <PrefRow label="Default new-alert builder">
                        <select value={form.newAlertDefault} onChange={(e) => patch({ newAlertDefault: e.target.value })}>
                            <option value="ask">Ask each time</option><option value="classic">Classic editor</option><option value="guided">Wizard</option>
                        </select>
                    </PrefRow>
                    <PrefRow label={'Show "switch view" in the channel/alert editor'}>
                        <YesNo value={form.showViewSwitch} onChange={(v) => patch({ showViewSwitch: v })} />
                    </PrefRow>
                </div>
            </div>
            <div className="panel">
                <div className="panel-header">User Preferences</div>
                <div className="panel-body">
                    <PrefRow label="Theme">
                        <select value={form.theme} onChange={(e) => patch({ theme: e.target.value })}>
                            <option value="light">Light</option>
                            <option value="dark">Dark</option>
                        </select>
                    </PrefRow>
                    <PrefRow label="Background color">
                        <div className="flex items-center">
                            <select value={form.bgMode} onChange={(e) => patch({ bgMode: e.target.value })}>
                                <option value="default">Server Default</option>
                                <option value="custom">Custom</option>
                            </select>
                            <input type="color" className="w-[60px] p-0.5 h-8 ml-2" disabled={form.bgMode !== 'custom'}
                                value={form.bgColor} onChange={(e) => patch({ bgColor: e.target.value })} />
                        </div>
                    </PrefRow>
                </div>
            </div>
        </>
    );
}

function TagsTab({ ctx }) {
    /* Edit-session model: tag objects are mutated in place (their identity is
       the setChannelTags payload); mutations bump the container to repaint.
       Modal-driven mutations (add/edit/remove) call ctx.markDirty() explicitly —
       modals live outside the tab host, so their edits never bubble into the
       auto-dirty listeners (the legacy builder silently missed them). */
    const [tags, setTags] = useState(null);          // null = loading
    const tagsNowRef = useRef(tags);
    tagsNowRef.current = tags;
    const [allChannels, setAllChannels] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [chFilter, setChFilter] = useState('');
    const [loadError, setLoadError] = useState(null);
    const tableRef = useRef(null);

    const tagChannelIds = (tag) => api.asList(tag.channelIds, 'string').map(String);
    const setTagChannelIds = (tag, ids) => { tag.channelIds = ids.length ? { string: ids } : ''; };
    const channelCount = (tag) => tagChannelIds(tag).length;
    const touch = () => setTags(prev => (prev ? prev.slice() : prev));

    const currentTag = (tags || []).find(t => t.id === selectedId) || null;

    async function load() {
        setLoadError(null);
        try {
            const [tagList, idsAndNames] = await Promise.all([
                api.server.channelTags(),
                api.channels.idsAndNames()
            ]);
            setTags(tagList);
            setAllChannels(channelIdNamePairs(idsAndNames));
            setSelectedId(null);
            tableRef.current?.clearSelection();
        } catch (e) {
            toast(`Failed to load tags: ${e.message}`, 'error');
            setLoadError(String(e.message || e));
        }
    }

    function visibleChannels() {
        const filter = chFilter.trim().toLowerCase();
        return filter ? allChannels.filter(c => c.name.toLowerCase().includes(filter)) : allChannels;
    }

    function toggleChannel(tag, id, on) {
        const cur = new Set(tagChannelIds(tag));
        if (on) cur.add(id); else cur.delete(id);
        setTagChannelIds(tag, [...cur]);
        touch();
    }

    function bulkSelect(checked) {
        const tag = tagsNowRef.current?.find(t => t.id === selectedId) || null;
        if (!tag) { toast('Select a tag first', 'warn'); return; }
        const cur = new Set(tagChannelIds(tag));
        for (const ch of visibleChannels()) {
            if (checked) cur.add(ch.id); else cur.delete(ch.id);
        }
        setTagChannelIds(tag, [...cur]);
        touch();
        ctx.markDirty();
    }

    async function addTag() {
        const name = await promptDialog('New Tag', 'Tag name');
        if (name === null || name.trim() === '') return;
        setTags(prev => [...(prev || []), {
            id: crypto.randomUUID(),
            name: fixTagName(name),
            channelIds: '',
            backgroundColor: randomPastel()
        }]);
        ctx.markDirty();
    }

    function editTag(tag) {
        const nameInput = textInput(tag.name || '', { maxlength: 24, title: 'Letters, numbers, spaces, - and _ only (max 24 chars)' });
        const colorInput = h('input', { type: 'color', value: colorToHex(tag.backgroundColor), class: 'w-[60px] p-0.5' });
        modal({
            title: 'Edit Tag',
            body: h('div',
                field('Name', nameInput),
                field('Color', colorInput)),
            buttons: [
                { label: 'Cancel' },
                {
                    label: 'OK', primary: true,
                    onClick: () => {
                        tag.name = fixTagName(nameInput.value);
                        const alpha = tag.backgroundColor && tag.backgroundColor.alpha !== undefined
                            ? tag.backgroundColor.alpha : 255;
                        tag.backgroundColor = hexToColor(colorInput.value, alpha);
                        touch();
                        ctx.markDirty();
                    }
                }
            ]
        });
    }

    async function removeTag(tagArg) {
        const tag = tagArg || tagsNowRef.current?.find(t => t.id === selectedId) || null;
        if (!tag) { toast('Select a tag first', 'warn'); return; }
        if (await confirmDialog('Remove Tag', `Remove tag "${tag.name}"? Save to apply.`, { danger: true, okLabel: 'Remove' })) {
            setTags(prev => prev.filter(t => t !== tag));
            setSelectedId(prev => (prev === tag.id ? null : prev));
            ctx.markDirty();
        }
    }

    async function save() {
        try {
            await api.server.setChannelTags(tagsNowRef.current || []);
            ctx.markClean();
            toast('Tags saved');
            loadRef.current();
            return true;
        } catch (e) {
            toast(`Save failed: ${e.message}`, 'error');
            return false;
        }
    }

    const loadRef = useRef(load);
    loadRef.current = load;
    const saveRef = useRef(save);
    saveRef.current = save;
    const addRef = useRef(addTag);
    addRef.current = addTag;
    const editRef = useRef(editTag);
    editRef.current = editTag;
    const removeRef = useRef(removeTag);
    removeRef.current = removeTag;

    // Table config is mount-captured by DataTableHost — every callback routes
    // through the refs above so it always runs the latest closure.
    const columns = useRef([
        { key: 'color', label: '', width: '36px', sortable: false, render: (t) => swatch(t.backgroundColor) },
        { key: 'name', label: 'Name', render: (t) => t.name || '' },
        { key: 'channels', label: 'Channel Count', className: 'num', width: '130px', sortValue: (t) => channelCount(t), render: (t) => String(channelCount(t)) }
    ]).current;
    const options = useRef({
        selectable: 'single',
        rowKey: (t) => t.id,
        emptyText: 'No tags defined',
        columnsMenu: true,
        columnsMenuKey: 'webadmin-cols-tags',
        onSelect: (rows) => setSelectedId(rows[0] ? rows[0].id : null),
        onActivate: (t) => editRef.current(t),
        onContextMenu: (t, e) => {
            setSelectedId(t.id);
            if (tableRef.current) { tableRef.current.selected = new Set([t.id]); tableRef.current.render(); }
            // Tag mutations ride settings_Tags/doSave (no Swing constants —
            // same convention as the Config Map Add Row, RBAC.md §3).
            contextMenu(e.clientX, e.clientY, [
                { label: 'New Tag', icon: 'plus', task: 'doSave', group: 'settings_Tags', onClick: () => addRef.current() },
                { label: 'Edit Tag', icon: 'edit', task: 'doSave', group: 'settings_Tags', onClick: () => editRef.current(t) },
                '-',
                { label: 'Remove Tag', icon: 'trash', danger: true, task: 'doSave', group: 'settings_Tags', onClick: () => removeRef.current(t) }
            ]);
        }
    }).current;

    useEffect(() => {
        ctx.setSave(() => saveRef.current());
        loadRef.current();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Selection-dependent tasks only show when a tag is selected.
    useEffect(() => {
        ctx.setTasks('Tag Tasks', [
            taskButton('Refresh', 'refresh', () => loadRef.current(), { task: 'doRefresh', group: 'settings_Tags' }),
            taskButton('Save', 'save', () => saveRef.current(), { primary: true, task: 'doSave', group: 'settings_Tags' }),
            taskButton('Add Tag', 'plus', () => addRef.current(), { task: 'doSave', group: 'settings_Tags' }),
            selectedId ? taskButton('Remove Tag', 'trash', () => removeRef.current(), { danger: true, task: 'doSave', group: 'settings_Tags' }) : null
        ]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId]);

    if (loadError) return <TabLoadFailed error={loadError} />;
    if (!tags) return <div className="loading-block"><div className="spinner" />Loading…</div>;

    const ids = currentTag ? new Set(tagChannelIds(currentTag)) : null;
    const visible = visibleChannels();

    return (
        <>
            <div className="panel"><div className="panel-body flush">
                <DataTableHost columns={columns} options={options} rows={tags}
                    onReady={(t) => { tableRef.current = t; }} />
            </div></div>
            <div className="panel">
                <div className="panel-header">Channels</div>
                <div className="panel-body">
                    <div className="hint mb-[14px]">Channel selections will be applied to the currently selected tag.</div>
                    <div className="flex items-center gap-2 mb-[14px]">
                        <input type="text" placeholder="Filter channels" className="max-w-[280px]"
                            value={chFilter} onChange={(e) => setChFilter(e.target.value)} />
                        <button type="button" className="btn" onClick={() => bulkSelect(true)}>Select All</button>
                        <button type="button" className="btn" onClick={() => bulkSelect(false)}>Deselect All</button>
                    </div>
                    <div className="max-h-[260px] overflow-auto flex flex-col gap-1.5">
                        {!currentTag ? (
                            <div className="text-text-faint">Select a tag above to edit its channel assignments</div>
                        ) : visible.length === 0 ? (
                            <div className="text-text-faint">No channels match the filter</div>
                        ) : (
                            visible.map((ch) => (
                                <label key={ch.id} className="check">
                                    <input type="checkbox" checked={ids.has(ch.id)}
                                        onChange={(e) => toggleChannel(currentTag, ch.id, e.target.checked)} />
                                    {ch.name}
                                </label>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}

/* =============================================================================
   Tab 3 — Configuration Map
   {entry:[{string: key, 'com.mirth.connect.util.ConfigurationProperty':
            {value, comment}}]}
   ============================================================================ */

let cfgRowSeq = 0;
const newCfgRow = (key = '', value = '', comment = '', propKey = CONFIGURATION_PROPERTY_CLASS, prop = null) =>
    ({ _id: ++cfgRowSeq, key, value, comment, propKey, prop });

function ConfigurationMapTab({ ctx }) {
    /* Rows are plain state; inputs are controlled with STABLE per-row keys so
       typing keeps focus across re-renders and insert/delete never re-binds a
       neighboring row's value. Insert/delete positions use the ORIGINAL index
       (the filter only hides rows), exactly like the legacy grid. */
    const [rows, setRows] = useState(null);          // null = loading
    const rowsNowRef = useRef(rows);
    rowsNowRef.current = rows;
    const [filterText, setFilterText] = useState('');
    const [showValues, setShowValues] = useState(false);
    const [loadError, setLoadError] = useState(null);
    // Bumped on structural changes only (load/insert/delete/add/import). The
    // content filter re-applies on FILTER or STRUCTURE changes — never on a
    // value keystroke, so the row being edited can't vanish under the cursor
    // (and a just-added blank row survives its first characters), matching the
    // legacy grid's re-filter timing.
    const [structureVersion, setStructureVersion] = useState(0);
    const bumpStructure = () => setStructureVersion(v => v + 1);

    async function load() {
        setLoadError(null);
        try {
            const raw = await api.server.configurationMap();
            const next = [];
            for (const entry of api.asList(raw && raw.entry)) {
                if (!entry || typeof entry !== 'object') continue;
                const key = Array.isArray(entry.string) ? entry.string[0] : entry.string;
                let propKey = CONFIGURATION_PROPERTY_CLASS;
                let prop = entry[CONFIGURATION_PROPERTY_CLASS];
                if (prop === undefined || prop === null || typeof prop !== 'object') {
                    for (const [k, v] of Object.entries(entry)) {
                        if (k !== 'string' && v && typeof v === 'object') { propKey = k; prop = v; break; }
                    }
                }
                next.push(newCfgRow(
                    String(key ?? ''),
                    String(prop?.value ?? ''),
                    String(prop?.comment ?? ''),
                    propKey,
                    (prop && typeof prop === 'object') ? prop : null));
            }
            setRows(next);
            bumpStructure();
        } catch (e) {
            toast(`Failed to load configuration map: ${e.message}`, 'error');
            setLoadError(String(e.message || e));
        }
    }

    async function save() {
        try {
            /* Round-trip each entry's property-class key and any extra fields
               the engine put on the ConfigurationProperty. */
            const entry = (rowsNowRef.current || []).filter(r => r.key.trim() !== '').map(r => ({
                string: r.key.trim(),
                [r.propKey || CONFIGURATION_PROPERTY_CLASS]: { ...(r.prop || {}), value: r.value, comment: r.comment }
            }));
            await api.server.setConfigurationMap({ entry });
            ctx.markClean();
            toast('Configuration map saved');
            return true;
        } catch (e) {
            toast(`Save failed: ${e.message}`, 'error');
            return false;
        }
    }

    async function importMap() {
        if (!rowsNowRef.current) { toast('The configuration map has not loaded yet', 'warn'); return; }
        const file = await pickFile('.properties');
        if (!file) return;
        const imported = [];
        let pendingComment = [];
        for (const line of String(file.content).split(/\r?\n/)) {
            const t = line.trim();
            if (t === '') { pendingComment = []; continue; }
            if (t.startsWith('#') || t.startsWith('!')) { pendingComment.push(t.replace(/^[#!]\s?/, '')); continue; }
            const idx = t.indexOf('=');
            if (idx <= 0) { pendingComment = []; continue; }
            imported.push({ key: t.slice(0, idx).trim(), value: t.slice(idx + 1), comment: pendingComment.join(' ') });
            pendingComment = [];
        }
        if (!imported.length) { toast('No properties found in file', 'warn'); return; }
        const current = rowsNowRef.current || [];
        const existing = new Set(current.map(r => r.key));
        const overlap = imported.filter(i => existing.has(i.key)).length;
        const ok = await confirmDialog('Import Configuration Map',
            `Import ${imported.length} propert${imported.length === 1 ? 'y' : 'ies'} from "${file.name}"?` +
            (overlap ? ` ${overlap} existing key(s) will be overwritten.` : ''),
            { okLabel: 'Import' });
        if (!ok) return;
        setRows(prev => {
            const next = prev.slice();
            for (const imp of imported) {
                const row = next.find(r => r.key === imp.key);
                if (row) {
                    row.value = imp.value;
                    if (imp.comment) row.comment = imp.comment;
                } else {
                    next.push(newCfgRow(imp.key, imp.value, imp.comment));
                }
            }
            return next;
        });
        bumpStructure();
        ctx.markDirty();
        toast(`Imported ${imported.length} propert${imported.length === 1 ? 'y' : 'ies'} — Save to apply`);
    }

    function exportMap() {
        const lines = [];
        for (const r of rowsNowRef.current || []) {
            if (r.key.trim() === '') continue;
            if (r.comment && String(r.comment).trim() !== '') {
                for (const c of String(r.comment).split(/\r?\n/)) lines.push('# ' + c);
            }
            lines.push(`${r.key.trim()}=${r.value ?? ''}`);
        }
        saveFile('configuration.properties', 'text/plain', lines.join('\n') + '\n');
    }

    const loadRef = useRef(load);
    loadRef.current = load;
    const saveRef = useRef(save);
    saveRef.current = save;
    const importRef = useRef(importMap);
    importRef.current = importMap;
    const exportRef = useRef(exportMap);
    exportRef.current = exportMap;

    useEffect(() => {
        ctx.setSave(() => saveRef.current());
        ctx.setTasks('Configuration Map Tasks', [
            taskButton('Refresh', 'refresh', () => loadRef.current(), { task: 'doRefresh', group: 'settings_Configuration Map' }),
            taskButton('Save', 'save', () => saveRef.current(), { primary: true, task: 'doSave', group: 'settings_Configuration Map' }),
            taskButton('Import Map', 'import', () => importRef.current(), { task: 'doImportMap', group: 'settings_Configuration Map' }),
            taskButton('Export Map', 'export', () => exportRef.current(), { task: 'doExportMap', group: 'settings_Configuration Map' })
        ]);
        loadRef.current();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* Visible-row set, frozen between filter/structure changes (see above). */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const visibleIds = useMemo(() => {
        const q = filterText.trim().toLowerCase();
        const matches = (row) => {
            if (!q) return true;
            // Blank rows (e.g. a just-added row) always show so adding while
            // filtering isn't hidden.
            if (!row.key && !row.value && !row.comment) return true;
            return row.key.toLowerCase().includes(q)
                || row.value.toLowerCase().includes(q)
                || row.comment.toLowerCase().includes(q);
        };
        return new Set((rowsNowRef.current || []).filter(matches).map(r => r._id));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filterText, structureVersion]);

    if (loadError) return <TabLoadFailed error={loadError} />;
    if (!rows) return <div className="loading-block"><div className="spinner" />Loading…</div>;

    const shown = rows.filter(r => visibleIds.has(r._id)).length;
    const patchRow = (id, patch) => setRows(prev => prev.map(r => (r._id === id ? { ...r, ...patch } : r)));
    const insertAt = (i) => { setRows(prev => { const next = prev.slice(); next.splice(i, 0, newCfgRow()); return next; }); bumpStructure(); ctx.markDirty(); };
    const deleteAt = (i) => { setRows(prev => { const next = prev.slice(); next.splice(i, 1); return next; }); bumpStructure(); ctx.markDirty(); };
    const addRow = () => { setRows(prev => [...prev, newCfgRow()]); bumpStructure(); ctx.markDirty(); };

    const valueType = showValues ? 'text' : 'password';

    return (
        <div className="panel">
            {/* Controls live in the panel header (this app's convention — panels carry
                their tools in .panel-tools), so the filter attaches to the table it acts on. */}
            <div className="panel-header">Configuration Map
                <div className="panel-tools">
                    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius)] border border-line-strong bg-bg2 text-text-dim min-w-[260px]">
                        <span className="inline-flex" ref={(el) => { if (el && !el.firstChild) el.appendChild(icon('search', 15)); }} />
                        <input type="search" placeholder="Filter entries…" autoComplete="off"
                            className="flex-1 min-w-0 bg-transparent border-0 outline-none text-text"
                            value={filterText} onChange={(e) => setFilterText(e.target.value)} />
                    </div>
                    <label className="check">
                        <input type="checkbox" checked={showValues} onChange={(e) => setShowValues(e.target.checked)} />
                        Show values
                    </label>
                    {/* Add Row rides the tab's doSave permission — adding a row is
                        meaningless without save rights, so no separate identifier. */}
                    {platform.checkTask('settings_Configuration Map', 'doSave') && (
                        <button type="button" className="btn" onClick={addRow}>
                            <span className="inline-flex" ref={(el) => { if (el && !el.firstChild) el.appendChild(icon('plus')); }} />Add Row
                        </button>
                    )}
                </div>
            </div>
            <div className="panel-body flush">
                <div className="dt-wrap">
                    <table className="dt">
                        <thead><tr><th>Key</th><th>Value</th><th>Comment</th><th className="w-10"></th></tr></thead>
                        <tbody>
                            {rows.map((row, i) => visibleIds.has(row._id) && (
                                <tr key={row._id}
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        // Row edits ride doSave like the Add Row button (RBAC.md §3).
                                        contextMenu(e.clientX, e.clientY, [
                                            { label: 'Insert Row Above', icon: 'plus', task: 'doSave', group: 'settings_Configuration Map', onClick: () => insertAt(i) },
                                            { label: 'Insert Row Below', icon: 'plus', task: 'doSave', group: 'settings_Configuration Map', onClick: () => insertAt(i + 1) },
                                            '-',
                                            { label: 'Delete Row', icon: 'trash', task: 'doSave', group: 'settings_Configuration Map', onClick: () => deleteAt(i) }
                                        ]);
                                    }}>
                                    <td><input type="text" value={row.key} onChange={(e) => patchRow(row._id, { key: e.target.value })} /></td>
                                    <td><input type={valueType} value={row.value} onChange={(e) => patchRow(row._id, { value: e.target.value })} /></td>
                                    <td><input type="text" value={row.comment} onChange={(e) => patchRow(row._id, { comment: e.target.value })} /></td>
                                    <td>
                                        <button type="button" className="icon-btn" title="Remove row" onClick={() => deleteAt(i)}>
                                            <span className="inline-flex" ref={(el) => { if (el && !el.firstChild) el.appendChild(icon('trash')); }} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {rows.length === 0 ? (
                                <tr><td colSpan={4}><span className="text-text-faint">No configuration map entries</span></td></tr>
                            ) : shown === 0 ? (
                                <tr><td colSpan={4}><span className="text-text-faint">{`No entries match “${filterText.trim().toLowerCase()}”`}</span></td></tr>
                            ) : null}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

/* =============================================================================
   Tab 4 — Database tasks
   DatabaseTask: { id, name, description, status (IDLE/RUNNING),
                   confirmationMessage, affectedChannels, startDateTime }
   ============================================================================ */

function DatabaseTasksTab({ ctx }) {
    const [taskRows, setTaskRows] = useState(null);   // null = loading
    const [selectedId, setSelectedId] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const tableRef = useRef(null);

    // Status-driven gating (Swing parity): Run only when no task is running;
    // Cancel only for the running task.
    const isRunning = (t) => String((t && t.status) || '').toUpperCase() === 'RUNNING';
    const anyRunning = () => (taskRowsNowRef.current || []).some(isRunning);
    const taskRowsNowRef = useRef(taskRows);
    taskRowsNowRef.current = taskRows;

    function normalize(raw) {
        const tasks = [];
        if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.entry !== undefined) {
            for (const e of api.asList(raw.entry)) {
                if (!e || typeof e !== 'object') continue;
                let task = e.databaseTask;
                if (task === undefined || task === null || typeof task !== 'object') {
                    for (const [k, v] of Object.entries(e)) {
                        if (k !== 'string' && v && typeof v === 'object') { task = v; break; }
                    }
                }
                if (task && typeof task === 'object') tasks.push(task);
            }
            return tasks;
        }
        return api.asList(raw, 'databaseTask').filter(t => t && typeof t === 'object');
    }

    async function load() {
        try {
            setTaskRows(normalize(await api.databaseTasks.list()));
            setLoadError(null);
        } catch (e) {
            toast(`Failed to load database tasks: ${e.message}`, 'error');
            if (taskRowsNowRef.current === null) setLoadError(String(e.message || e));
        }
    }

    async function runTask(task) {
        if (!task) { toast('Select a task first', 'warn'); return; }
        const message = task.confirmationMessage || `Run "${task.name}"? This task may take a long time to complete.`;
        if (await confirmDialog('Run Database Task', message, { okLabel: 'Run' })) {
            try {
                const result = await api.databaseTasks.run(task.id);
                toast(typeof result === 'string' && result ? result : 'Task started');
            } catch (e) {
                toast(`Run failed: ${e.message}`, 'error');
            }
            loadRef.current();
        }
    }

    async function cancelTask(task) {
        if (!task) { toast('Select a task first', 'warn'); return; }
        if (!isRunning(task)) { toast(`Task "${task.name}" is not currently running.`, 'warn'); return; }
        try {
            await api.databaseTasks.cancel(task.id);
            toast('Cancel requested');
        } catch (e) {
            toast(`Cancel failed: ${e.message}`, 'error');
        }
        loadRef.current();
    }

    const loadRef = useRef(load);
    loadRef.current = load;
    const runRef = useRef(runTask);
    runRef.current = runTask;
    const cancelRef = useRef(cancelTask);
    cancelRef.current = cancelTask;

    // Table config is mount-captured by DataTableHost — callbacks route through refs.
    const columns = useRef([
        { key: 'name', label: 'Name', render: (t) => t.name || '' },
        { key: 'description', label: 'Description', render: (t) => t.description || '' },
        {
            key: 'status', label: 'Status', width: '120px',
            render: (t) => {
                const running = String(t.status || '').toUpperCase() === 'RUNNING';
                return h('span.status-cell', h(`span.pip${running ? '.busy' : ''}`), running ? 'Running' : 'Idle');
            }
        }
    ]).current;
    const options = useRef({
        selectable: 'single',
        rowKey: (t) => t.id,
        emptyText: 'No database tasks — the engine has no cleanup work to do',
        columnsMenu: true,
        columnsMenuKey: 'webadmin-cols-dbtasks',
        onSelect: (rows) => setSelectedId(rows[0] ? rows[0].id : null),
        onContextMenu: (row, e) => {
            setSelectedId(row.id);
            if (tableRef.current) { tableRef.current.selected = new Set([row.id]); tableRef.current.render(); }
            contextMenu(e.clientX, e.clientY, [
                { label: 'Run Task', icon: 'play', hidden: anyRunning(), task: 'doRunDatabaseTask', group: 'settings_Database Tasks', onClick: () => runRef.current(row) },
                { label: 'Cancel Task', icon: 'stop', danger: true, hidden: !isRunning(row), task: 'doCancelDatabaseTask', group: 'settings_Database Tasks', onClick: () => cancelRef.current(row) }
            ]);
        }
    }).current;

    useEffect(() => {
        loadRef.current();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Selection/status-gated task pane (no Save — this tab is read/run only).
    const selected = (taskRows || []).find(t => t.id === selectedId) || null;
    useEffect(() => {
        ctx.setTasks('Database Task Tasks', [
            taskButton('Refresh', 'refresh', () => loadRef.current(), { task: 'doRefresh', group: 'settings_Database Tasks' }),
            selected && !anyRunning() ? taskButton('Run Task', 'play', () => runRef.current(selected), { task: 'doRunDatabaseTask', group: 'settings_Database Tasks' }) : null,
            selected && isRunning(selected) ? taskButton('Cancel Task', 'stop', () => cancelRef.current(selected), { danger: true, task: 'doCancelDatabaseTask', group: 'settings_Database Tasks' }) : null
        ]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId, taskRows]);

    if (loadError) return <TabLoadFailed error={loadError} />;
    if (!taskRows) return <div className="loading-block"><div className="spinner" />Loading…</div>;

    return (
        <div className="panel"><div className="panel-body flush">
            <DataTableHost columns={columns} options={options} rows={taskRows}
                onReady={(t) => { tableRef.current = t; }} />
        </div></div>
    );
}

/* =============================================================================
   Tab 5 — Resources
   GET /server/resources returns a list of ResourceProperties subclasses. In
   XStream JSON the entries are keyed by class name (or carry '@class' in an
   array) — normalize to [{className, obj}] and rebuild the same container
   shape on save. DirectoryResourceProperties fields (verified):
   pluginPointName 'Directory Resource', type 'Directory', id, name,
   description, includeWithGlobalScripts, loadParentFirst, directory,
   directoryRecursion (the "include subdirectories" flag).
   Loaded libraries: GET /extensions/directoryresource/resources/{id}/libraries
   (verified in DirectoryResourceServletInterface.java).
   ============================================================================ */

function ResourcesTab({ ctx }) {
    /* Edit-session model: [{ className, obj }] — resource objects are mutated
       in place (checkbox columns, the plugin detail editor) and the container
       identity bumps to repaint; save rebuilds the fetched container shape.
       The detail editor for each resource type comes from a registered
       ResourceClientPlugin (e.g. plugins/directoryresource) — rendered as a
       plain <PluginSlot> child now (no nested mountReact/teardown dance), with
       the SAME ctx contract: { entry, locked, platform, refreshTable }. */
    const [entries, setEntries] = useState(null);        // null = loading
    const entriesNowRef = useRef(entries);
    entriesNowRef.current = entries;
    const containerIsArrayRef = useRef(false);           // round-trip the fetched container shape
    const [selectedId, setSelectedId] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const tableRef = useRef(null);

    const isDefault = (entry) => entry && entry.obj.id === 'Default Resource';
    const touch = () => setEntries(prev => (prev ? prev.slice() : prev));

    function normalize(raw) {
        const next = [];
        containerIsArrayRef.current = Array.isArray(raw);
        if (containerIsArrayRef.current) {
            for (const obj of raw) {
                if (obj && typeof obj === 'object') next.push({ className: obj['@class'] || DIRECTORY_RESOURCE_CLASS, obj });
            }
        } else if (raw && typeof raw === 'object') {
            for (const [className, value] of Object.entries(raw)) {
                if (className.startsWith('@')) continue;
                for (const obj of api.asList(value)) {
                    if (obj && typeof obj === 'object') next.push({ className, obj });
                }
            }
        }
        return next;
    }

    function container() {
        const list = entriesNowRef.current || [];
        if (containerIsArrayRef.current) return list.map(e => e.obj);
        const out = {};
        for (const e of list) {
            if (!out[e.className]) out[e.className] = [];
            out[e.className].push(e.obj);
        }
        return out;
    }

    async function load() {
        setLoadError(null);
        try {
            setEntries(normalize(await api.server.resources()));
            setSelectedId(null);
            tableRef.current?.clearSelection();
        } catch (e) {
            toast(`Failed to load resources: ${e.message}`, 'error');
            setLoadError(String(e.message || e));
        }
    }

    // Create a new resource of the (only, for now) registered type, then edit it
    // in the detail panel below — the type plugin supplies the factory + editor.
    function addResource() {
        const def = platform.resourceTypes()[0];
        if (!def || !def.create) { toast('No resource types are registered', 'warn'); return; }
        const list = entriesNowRef.current || [];
        const template = list.find(e => e.obj && e.obj['@version']);
        const obj = def.create({ version: template ? template.obj['@version'] : undefined, containerIsArray: containerIsArrayRef.current });
        const entry = { className: def.propertiesClass || DIRECTORY_RESOURCE_CLASS, obj };
        setEntries(prev => [...(prev || []), entry]);
        // Adding SELECTS the new resource everywhere — table highlight, detail
        // pane, and the selection-gated tasks (the legacy opened the detail
        // without selecting the row, leaving the task pane out of sync).
        setSelectedId(obj.id);
        if (tableRef.current) { tableRef.current.selected = new Set([obj.id]); tableRef.current.render(); }
        ctx.markDirty();
    }

    async function removeResource(entryArg) {
        const entry = entryArg || (entriesNowRef.current || []).find(e => e.obj.id === selectedId) || null;
        if (!entry) { toast('Select a resource first', 'warn'); return; }
        if (isDefault(entry)) { toast('The Default Resource cannot be removed', 'warn'); return; }
        if (await confirmDialog('Remove Resource', `Remove resource "${entry.obj.name}"? Save to apply.`, { danger: true, okLabel: 'Remove' })) {
            setEntries(prev => prev.filter(e => e !== entry));
            setSelectedId(prev => (prev === entry.obj.id ? null : prev));
            ctx.markDirty();
        }
    }

    async function reloadResource(entryArg) {
        const entry = entryArg || (entriesNowRef.current || []).find(e => e.obj.id === selectedId) || null;
        if (!entry) { toast('Select a resource first', 'warn'); return; }
        try {
            await api.server.reloadResource(entry.obj.id);
            toast(`Resource "${entry.obj.name}" reloaded`);
        } catch (e) {
            toast(`Reload failed: ${e.message}`, 'error');
        }
    }

    async function save() {
        try {
            await api.server.setResources(container());
            ctx.markClean();
            toast('Resources saved');
            loadRef.current();
            return true;
        } catch (e) {
            toast(`Save failed: ${e.message}`, 'error');
            return false;
        }
    }

    const loadRef = useRef(load);
    loadRef.current = load;
    const saveRef = useRef(save);
    saveRef.current = save;
    const addRef = useRef(addResource);
    addRef.current = addResource;
    const removeRef = useRef(removeResource);
    removeRef.current = removeResource;
    const reloadRef = useRef(reloadResource);
    reloadRef.current = reloadResource;

    // Table config is mount-captured by DataTableHost — callbacks route through refs.
    const columns = useRef([
        { key: 'name', label: 'Name', sortValue: (e) => e.obj.name, render: (e) => e.obj.name || '' },
        { key: 'type', label: 'Type', width: '120px', sortValue: (e) => e.obj.type, render: (e) => e.obj.type || '' },
        {
            key: 'globalScripts', label: 'Global Scripts', width: '110px',
            sortValue: (e) => e.obj.includeWithGlobalScripts === true ? 1 : 0,
            render: (e) => h('input', {
                type: 'checkbox', checked: e.obj.includeWithGlobalScripts === true,
                onClick: (ev) => ev.stopPropagation(),
                onChange: (ev) => { e.obj.includeWithGlobalScripts = ev.target.checked; }
            })
        },
        {
            key: 'loadParentFirst', label: 'Load Parent-First', width: '130px',
            sortValue: (e) => e.obj.loadParentFirst === true ? 1 : 0,
            render: (e) => h('input', {
                type: 'checkbox', checked: e.obj.loadParentFirst === true,
                onClick: (ev) => ev.stopPropagation(),
                onChange: (ev) => { e.obj.loadParentFirst = ev.target.checked; }
            })
        }
    ]).current;
    const options = useRef({
        selectable: 'single',
        rowKey: (e) => e.obj.id,
        emptyText: 'No resources',
        columnsMenu: true,
        columnsMenuKey: 'webadmin-cols-resources',
        onSelect: (rows) => setSelectedId(rows[0] ? rows[0].obj.id : null),
        onContextMenu: (row, e) => {
            setSelectedId(row.obj.id);
            if (tableRef.current) { tableRef.current.selected = new Set([row.obj.id]); tableRef.current.render(); }
            contextMenu(e.clientX, e.clientY, [
                { label: 'Add Resource', icon: 'plus', task: 'doAddResource', group: 'settings_Resources', onClick: () => addRef.current() },
                { label: 'Remove Resource', icon: 'trash', danger: true, hidden: isDefault(row), task: 'doRemoveResource', group: 'settings_Resources', onClick: () => removeRef.current(row) },
                { label: 'Reload Resource', icon: 'refresh', task: 'doReloadResource', group: 'settings_Resources', onClick: () => reloadRef.current(row) }
            ]);
        }
    }).current;

    useEffect(() => {
        ctx.setSave(() => saveRef.current());
        loadRef.current();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Selection-gated task pane (the Default Resource cannot be removed).
    const selected = (entries || []).find(e => e.obj.id === selectedId) || null;
    useEffect(() => {
        ctx.setTasks('Resource Tasks', [
            taskButton('Refresh', 'refresh', () => loadRef.current(), { task: 'doRefresh', group: 'settings_Resources' }),
            taskButton('Save', 'save', () => saveRef.current(), { primary: true, task: 'doSave', group: 'settings_Resources' }),
            taskButton('Add Resource', 'plus', () => addRef.current(), { task: 'doAddResource', group: 'settings_Resources' }),
            selected && !isDefault(selected) ? taskButton('Remove Resource', 'trash', () => removeRef.current(selected), { danger: true, task: 'doRemoveResource', group: 'settings_Resources' }) : null,
            selected ? taskButton('Reload Resource', 'refresh', () => reloadRef.current(selected), { task: 'doReloadResource', group: 'settings_Resources' }) : null
        ]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId, entries]);

    if (loadError) return <TabLoadFailed error={loadError} />;
    if (!entries) return <div className="loading-block"><div className="spinner" />Loading…</div>;

    const types = platform.resourceTypes();
    const detailDef = selected ? (types.find(t => t.type === selected.obj.type) || types[0]) : null;

    return (
        <>
            <div className="panel"><div className="panel-body flush">
                <DataTableHost columns={columns} options={options} rows={entries}
                    onReady={(t) => { tableRef.current = t; }} />
            </div></div>
            <div className="panel">
                <div className="panel-header">{(types[0] || {}).detailHeader || 'Resource Settings'}</div>
                <div className="panel-body">
                    {!selected ? (
                        <div className="text-text-faint">Select a resource above to edit its settings</div>
                    ) : detailDef && detailDef.component ? (
                        <PluginSlot key={selected.obj.id} def={detailDef} ctx={{
                            entry: selected, locked: isDefault(selected), platform,
                            refreshTable: () => touch()
                        }} />
                    ) : (
                        <div className="text-text-faint">{`No editor registered for resource type "${selected.obj.type || '?'}"`}</div>
                    )}
                </div>
            </div>
        </>
    );
}

/* =============================================================================
   View shell — React tabs + per-tab task pane via <ViewTasks>
   Each tab BODY is a React component mounted via reactTab() (the same wrapper
   plugin panels use); it declares its task pane by calling setTasks(title,
   items) with DOM taskButton items — the one task-pane contract shared with
   plugin panels. The active tab's taskbar DOM is portaled into the rail
   through <RailPane> + <ViewTasks>, with the pane title following the active
   tab — switching tabs swaps the pane (and title) reactively, no route change.
   Only the active tab is mounted; re-activating a tab reloads it.
   ============================================================================ */

const BUILTIN_TABS = [
    { label: 'Server', render: (ctx) => reactTab(ctx, ServerTab) },
    { label: 'Administrator', render: (ctx) => reactTab(ctx, AdministratorTab) },
    { label: 'Tags', render: (ctx) => reactTab(ctx, TagsTab) },
    { label: 'Configuration Map', render: (ctx) => reactTab(ctx, ConfigurationMapTab) },
    { label: 'Database Tasks', render: (ctx) => reactTab(ctx, DatabaseTasksTab) },
    { label: 'Resources', render: (ctx) => reactTab(ctx, ResourcesTab) }
    // Data Pruner is a settings-panel plugin (plugins/datapruner), appended
    // below via platform.settingsPanels().
];

// Build the full tab list once: built-ins + plugin-contributed settings panels
// (Data Pruner). A plugin panel renders into the tab host via panel.render(host,
// ctx); if it returns a detached Node, append it (matching the vanilla shell).
function buildTabDefs(plat) {
    const defs = BUILTIN_TABS.slice();
    for (const panel of plat.settingsPanels()) {
        defs.push({
            label: panel.label,
            render: (ctx) => {
                const tabHostEl = tabHost();
                ctx.setTasks(`${panel.label} Tasks`, []);   // initial pane; the panel calls setTasks itself
                // Host the panel's React component; teardown is tracked on the
                // node so SettingsTab can unmount the root on tab switch.
                tabHostEl.__teardown = mountReact(tabHostEl, <PluginSlot def={panel} ctx={ctx} />);
                return tabHostEl;
            }
        });
    }
    return defs;
}

/* Save/Discard/Cancel prompt for unsaved settings changes (Swing parity).
   Users whose role can't save the tab (settings_<Tab>/doSave denied) must not
   be offered a Save the server would reject — OK-only notice instead. */
function promptSaveSettings(canSave) {
    return new Promise((resolve) => {
        if (canSave === false) {
            modal({
                title: 'Unsaved Changes',
                body: h('div', "You don't have permission to save this settings tab. Your changes will be discarded."),
                onClose: () => resolve('cancel'),
                buttons: [{ label: 'OK', primary: true, onClick: () => resolve('discard') }]
            });
            return;
        }
        modal({
            title: 'Unsaved Changes',
            body: h('div', 'You have unsaved changes on this settings tab. Would you like to save them?'),
            onClose: () => resolve('cancel'),
            buttons: [
                { label: 'Cancel', onClick: () => resolve('cancel') },
                { label: "Don't Save", danger: true, onClick: () => resolve('discard') },
                { label: 'Save Changes', primary: true, onClick: () => resolve('save') }
            ]
        });
    });
}

// Mounts the active tab's legacy builder once and tracks its declared task pane.
// The builder's setTasks(title, items) writes into tasksRef; notify() forces a
// re-render so the portaled <RailPane> reflects the new title + buttons.
function SettingsTab({ def, ctx }) {
    const ref = useRef(null);
    useEffect(() => {
        const host = ref.current;
        if (!host) return;
        host.replaceChildren();
        ctx.setSave(null);               // reset; the builder re-registers its own save
        const node = def.render(ctx);
        if (node instanceof Node && node !== host) host.appendChild(node);
        ctx.markClean();                 // a freshly built tab starts clean
        // Any user edit marks the tab dirty. Programmatic value sets during the
        // builder's load() don't dispatch input/change, so they don't false-trip.
        const onEdit = () => ctx.markDirty();
        host.addEventListener('input', onEdit);
        host.addEventListener('change', onEdit);
        return () => {
            host.removeEventListener('input', onEdit);
            host.removeEventListener('change', onEdit);
            if (node && node.__teardown) node.__teardown();
            host.replaceChildren();
        };
        // Build once per tab activation (keyed by label in the parent); the
        // legacy builder owns its own load()/setTasks() lifecycle.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // Hand the task-pane host back so the parent can portal its taskbar DOM.
    return <div ref={ref} className="flex flex-col flex-1 min-h-0" />;
}

// Hosts the legacy taskbar DOM (built by the active tab via setTasks) inside the
// rail. Rebuilds the .taskbar children whenever the tab's task spec changes.
function TasksPane({ title, items }) {
    const ref = useRef(null);
    useEffect(() => {
        const host = ref.current;
        if (!host) return;
        host.replaceChildren();
        const bar = h('div.taskbar', { 'data-pane-title': title });
        for (const item of items) {
            if (item === '-') bar.appendChild(h('span.sep'));
            else if (item) bar.appendChild(item);
        }
        host.appendChild(bar);
        return () => host.replaceChildren();
    }, [title, items]);
    return (
        <RailPane title={title} paneKey={'tasks:' + title}>
            <div ref={ref} className="[display:contents]" />
        </RailPane>
    );
}

function SettingsView({ query }) {
    // Tab defs (built-ins + plugin panels) are stable for the view's lifetime.
    const defsRef = useRef(null);
    if (!defsRef.current) defsRef.current = buildTabDefs(platform);
    const defs = defsRef.current;

    // Deep-link: /settings?tab=<label> opens that tab (e.g. the account menu's
    // "Settings" → Administrator preferences). Unknown/absent → Server (0).
    const [active, setActive] = useState(() => {
        const want = String(query?.tab || '').trim().toLowerCase();
        const i = want ? defs.findIndex((d) => d.label.toLowerCase() === want) : -1;
        return i >= 0 ? i : 0;
    });
    const [dirty, setDirtyState] = useState(false);   // drives the unsaved-tab indicator
    const [, force] = useReducer((x) => x + 1, 0);
    // The active tab's declared task pane (title + legacy DOM items).
    const tasksRef = useRef({ title: 'Server Tasks', items: [] });
    const dirtyRef = useRef(false);
    const saveRef = useRef(null);   // the active tab's save(), if it supports saving
    const activeLabelRef = useRef(null);   // active tab label, for its settings_<Tab> RBAC group

    // setTasks is what each legacy builder calls; it captures the task spec and
    // forces a re-render of the portaled pane. ctx mirrors the vanilla shell ctx,
    // plus dirty-tracking hooks (markDirty/markClean/setSave) used by the tabs.
    const ctxRef = useRef(null);
    if (!ctxRef.current) {
        // When dirty, install a route-leave guard that prompts to save/discard.
        function refreshGuard() {
            if (dirtyRef.current) {
                setState('navGuard', async () => {
                    const choice = await promptSaveSettings(
                        platform.checkTask(`settings_${activeLabelRef.current}`, 'doSave'));
                    if (choice === 'cancel') return false;
                    if (choice === 'save' && saveRef.current && (await saveRef.current()) === false) return false;
                    setClean();
                });
            } else {
                setState('navGuard', null);
            }
        }
        function setDirty() {
            // Only tabs that registered a save() participate in dirty tracking.
            if (!saveRef.current || dirtyRef.current) return;
            dirtyRef.current = true; setDirtyState(true); refreshGuard();
        }
        function setClean() {
            dirtyRef.current = false; setDirtyState(false); setState('navGuard', null);
        }
        ctxRef.current = {
            platform,
            setTasks(title, items) { tasksRef.current = { title, items }; force(); },
            markDirty: setDirty,
            markClean: setClean,
            setSave(fn) { saveRef.current = fn || null; }
        };
    }
    const ctx = ctxRef.current;

    const def = defs[active] || defs[0];

    // Tab-switch guard: prompt if the current tab has unsaved changes.
    async function requestTab(i) {
        if (i === active) return;
        if (dirtyRef.current) {
            const choice = await promptSaveSettings();
            if (choice === 'cancel') return;
            if (choice === 'save' && saveRef.current && (await saveRef.current()) === false) return;
        }
        ctx.markClean();
        setActive(i);
    }

    // Clear the task spec the instant the active tab changes, so the pane never
    // shows the previous tab's buttons during the window before the new tab's
    // builder calls setTasks (which it does synchronously in its mount effect).
    const shownRef = useRef(active);
    if (shownRef.current !== active) {
        shownRef.current = active;
        tasksRef.current = { title: `${def.label} Tasks`, items: [] };
    }
    activeLabelRef.current = def.label;

    // Drop the leave-guard when the settings view itself unmounts.
    useEffect(() => () => { setState('navGuard', null); }, []);

    const { title, items } = tasksRef.current;

    return (
        <div className="view">
            <ViewTasks>
                <TasksPane title={title} items={items} />
            </ViewTasks>
            <div className="view-body flush flex flex-col">
                <div className="tabs-wrap flex flex-col flex-1 min-h-0 overflow-hidden">
                    <div className="tabs">
                        {defs.map((d, i) => (
                            <button key={d.label} className={'tab' + (i === active ? ' active' : '')}
                                onClick={() => requestTab(i)}>
                                {d.label}{i === active && dirty ? ' ●' : ''}
                            </button>
                        ))}
                    </div>
                    <div className="tab-body flex flex-col flex-1 min-h-0">
                        {/* Only the active tab is mounted; keyed by label so switching
                            tabs remounts (and reloads) it, matching vanilla tabs(). */}
                        <SettingsTab key={def.label} def={def} ctx={ctx} />
                    </div>
                </div>
            </div>
        </div>
    );
}
