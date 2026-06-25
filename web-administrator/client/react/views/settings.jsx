/*
 * Settings view (React port of views/settings.js). Server configuration with the
 * same 7 tabs as the Swing Administrator's Settings panel: Server, Administrator,
 * Tags, Configuration Map, Database Tasks, Resources, plus any panels registered
 * through platform.registerSettingsPanel (e.g. Data Pruner), which append after
 * the built-ins.
 *
 * Each tab's BODY is heavy legacy DOM (forms, DataTables, tag channel lists, the
 * config-map grid, the resource detail pane, the imported Data Pruner panel) with
 * intricate XStream round-tripping; it is reused VERBATIM via a ref'd mount, the
 * code-templates hybrid pattern. The per-tab task pane is rendered in React via
 * <ViewTasks> keyed to the active tab — switching tabs swaps the task pane (and
 * its title) reactively, no route change. Only the active tab is mounted, so its
 * tasks are the only ones portaled, and re-activating a tab reloads it (matching
 * the vanilla tabs() which rebuilds on switch).
 *
 * All writes round-trip the object shapes fetched from the engine so that XStream
 * "@class"/"@version" attributes and unknown keys survive. The per-tab Save lives
 * inside each tab's own task pane (Server/Tags/Configuration Map/Resources/Data
 * Pruner save; Administrator is localStorage-only; Database Tasks has no Save).
 */

import { useState, useEffect, useRef, useReducer } from 'react';
import { h, clear, icon, toast, taskButton, confirmDialog, promptDialog, modal, DataTable, field, textInput, numberInput, select, checkbox, loading, saveFile, pickFile, contextMenu } from '@oie/web-ui';
import api from '@oie/web-api';
import { platform } from '@oie/web-shell';
import { getPref, setPrefs, resetPrefs } from '../../core/prefs.js';
import { setTheme, getState, setState } from '../../core/store.js';
import { reactView, ViewTasks, mountReact } from '../mount.jsx';
import { applyEnvironmentColor, environmentColorVars, darkSurfaceTint, parseColorPref, serializeColorPref } from '../bridges.jsx';
import { PluginSlot } from '../plugin-slot.jsx';
import { RailPane } from '../ui.jsx';

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

function renderServerTab({ setTasks, markClean, setSave }) {
    const host = tabHost();
    host.appendChild(loading());
    let settings = null;
    let updateSettings = null;  // UpdateSettings {statsEnabled, lastStatsTime} — round-tripped
    let form = null;

    async function load() {
        try {
            settings = (await api.server.settings()) || {};
        } catch (e) {
            toast(`Failed to load server settings: ${e.message}`, 'error');
            loadFailed(host, e);
            return;
        }
        /* GET /server/updateSettings (verified in ConfigurationServletInterface;
           model UpdateSettings.statsEnabled). Best effort — the radios are
           simply omitted if it cannot be loaded. */
        try {
            updateSettings = (await api.server.updateSettings()) || {};
        } catch {
            updateSettings = null;
        }
        build();
    }

    function build() {
        clear(host);

        /* General */
        const envName = textInput(settings.environmentName ?? '');
        const srvName = textInput(settings.serverName ?? '');
        const bgColor = h('input', {
            type: 'color',
            class: 'w-[60px] p-0.5 h-8',
            value: colorToHex(settings.defaultAdministratorBackgroundColor, '#2a75b2')
        });
        // Reset the picker to the engine default (ServerSettings.DEFAULT_COLOR =
        // 0x2A75B2); Save persists + re-tints.
        const bgColorRestore = h('button.btn', {
            type: 'button', class: 'ml-2',
            title: 'Reset to the default background color', onClick: () => { bgColor.value = '#2a75b2'; paintBgPreview(); }
        }, 'Restore Default');

        // Live preview of the rail + topbar tint in both light and dark mode
        // (Swing's color-chooser Preview panel), updating as the color changes.
        const bgPreview = h('div', { class: 'flex gap-3.5 flex-wrap' });
        function miniPreview(colorObj, dark) {
            const v = environmentColorVars(colorObj, dark);
            // Dark mode also recolors the main surfaces toward the chosen hue — show
            // it here so the preview matches the live app (use the --bg1 tone).
            const surf = dark ? darkSurfaceTint(colorObj) : null;
            const paneBg = surf ? surf['--bg1'] : (dark ? '#111922' : '#f4f7fa');
            return h('div', { class: 'w-[190px]' },
                h('div', { class: 'text-[10px] text-text-faint mb-[3px] uppercase tracking-[0.1em]' }, dark ? 'Dark mode' : 'Light mode'),
                h('div', { class: 'border border-line rounded overflow-hidden' },
                    h('div', { class: 'py-[5px] px-[9px] text-[11px] font-[650]', style: { background: v.topbarBg, color: v.fg } }, 'Dashboard'),
                    h('div', { class: 'flex min-h-16' },
                        h('div', { class: 'py-[7px] px-2 w-16 text-[10px]', style: { background: v.railBg } },
                            h('div', { class: 'font-bold tracking-[0.1em] mb-[3px]', style: { color: v.fgDim } }, 'TASKS'),
                            h('div', { style: { color: v.fg } }, 'Channels'),
                            h('div', { style: { color: v.fgDim } }, 'Messages'),
                            h('div', { style: { color: v.fgDim } }, 'Settings')),
                        h('div', { class: 'flex-1 p-2 text-[11px]', style: { color: dark ? '#c8d4e0' : '#33414f', background: paneBg } }, 'Sample Text'))));
        }
        function paintBgPreview() {
            clear(bgPreview);
            const colorObj = hexToColor(bgColor.value, 255);
            bgPreview.appendChild(miniPreview(colorObj, false));
            bgPreview.appendChild(miniPreview(colorObj, true));
        }
        bgColor.addEventListener('input', paintBgPreview);
        paintBgPreview();
        const autoLogoutInterval = numberInput(settings.administratorAutoLogoutIntervalField ?? 5,
            { min: 1, disabled: settings.administratorAutoLogoutIntervalEnabled !== true });
        const autoLogout = yesNo(settings.administratorAutoLogoutIntervalEnabled === true,
            (v) => { autoLogoutInterval.disabled = !v; });
        /* Default is "yes" when statsEnabled is null/absent, matching the
           Swing SettingsPanelServer behavior. */
        const usageStats = updateSettings ? yesNo(updateSettings.statsEnabled !== false) : null;

        /* Channel */
        const clearMap = yesNo(settings.clearGlobalMap === true);
        const queueBuffer = numberInput(settings.queueBufferSize ?? '', { min: 1 });
        const metaCols = api.asList(settings.defaultMetaDataColumns, 'metaDataColumn')
            .filter(c => c && typeof c === 'object');
        const hasCol = (n) => metaCols.some(c => String(c.name || '').toUpperCase() === n);
        const metaSource = checkbox('Source', hasCol('SOURCE'));
        const metaType = checkbox('Type', hasCol('TYPE'));
        const metaVersion = checkbox('Version', hasCol('VERSION'));

        /* Email — smtpSecure is a String: 'none' | 'tls' | 'ssl' */
        const smtpHost = textInput(settings.smtpHost ?? '');
        const smtpPort = textInput(settings.smtpPort ?? '');
        const smtpTimeout = textInput(settings.smtpTimeout ?? '');
        const smtpFrom = textInput(settings.smtpFrom ?? '');
        const smtpSecure = radioGroup([
            { value: 'none', label: 'None' },
            { value: 'tls', label: 'STARTTLS' },
            { value: 'ssl', label: 'SSL' }
        ], String(settings.smtpSecure || 'none').toLowerCase());
        const smtpUsername = textInput(settings.smtpUsername ?? '', { disabled: settings.smtpAuth !== true });
        const smtpPassword = h('input', { type: 'password', value: settings.smtpPassword ?? '', disabled: settings.smtpAuth !== true });
        const smtpAuth = yesNo(settings.smtpAuth === true, (v) => {
            smtpUsername.disabled = !v;
            smtpPassword.disabled = !v;
        });

        /* Notification */
        const loginNotificationMessage = h('textarea',
            { disabled: settings.loginNotificationEnabled !== true },
            settings.loginNotificationMessage ?? '');
        const loginNotification = yesNo(settings.loginNotificationEnabled === true,
            (v) => { loginNotificationMessage.disabled = !v; });

        form = {
            envName, srvName, bgColor, autoLogout, autoLogoutInterval, usageStats,
            clearMap, queueBuffer, metaCols, metaSource, metaType, metaVersion,
            smtpHost, smtpPort, smtpTimeout, smtpFrom, smtpSecure, smtpAuth,
            smtpUsername, smtpPassword, loginNotification, loginNotificationMessage
        };

        host.appendChild(h('div.panel',
            h('div.panel-header', 'General'),
            h('div.panel-body', h('div.form-grid',
                field('Environment name', envName),
                field('Server name', srvName),
                field('Default Background Color', h('div', { class: 'flex items-center' }, bgColor, bgColorRestore)),
                h('div.field.span-2', h('label', 'Preview'), bgPreview),
                h('div.field', h('label', 'Enable Auto Logout'), autoLogout.el),
                field('Auto Logout Interval (minutes)', autoLogoutInterval),
                usageStats ? h('div.field', h('label', 'Provide usage statistics'), usageStats.el) : null))));

        host.appendChild(h('div.panel',
            h('div.panel-header', 'Channel'),
            h('div.panel-body', h('div.form-grid',
                h('div.field', h('label', 'Clear global map on redeploy'), clearMap.el),
                field('Default Queue Buffer Size', queueBuffer),
                h('div.field', h('label', 'Default Metadata Columns'),
                    h('div.radio-group.inline-row', metaSource.el, metaType.el, metaVersion.el))))));

        host.appendChild(h('div.panel',
            h('div.panel-header', 'Email'),
            h('div.panel-body', h('div.form-grid',
                h('div.field', h('label', 'SMTP Host'),
                    h('div.flex.items-center.gap-2', smtpHost,
                        h('button.btn.whitespace-nowrap', { onClick: sendTestEmail }, icon('mail'), 'Send Test Email'))),
                field('SMTP Port', smtpPort),
                field('Send Timeout (ms)', smtpTimeout),
                field('Default From Address', smtpFrom),
                h('div.field', h('label', 'Secure Connection'), smtpSecure.el),
                h('div.field', h('label', 'Require Authentication'), smtpAuth.el),
                field('Username', smtpUsername),
                field('Password', smtpPassword)))));

        host.appendChild(h('div.panel',
            h('div.panel-header', 'Notification'),
            h('div.panel-body',
                h('div.field', h('label', 'Require Login Notification and Consent'), loginNotification.el),
                h('div.field', h('label', 'Login Notification'), loginNotificationMessage))));
    }

    async function save() {
        if (!form || !settings) return;
        try {
            settings.environmentName = form.envName.value;
            settings.serverName = form.srvName.value;
            const alpha = settings.defaultAdministratorBackgroundColor?.alpha ?? 255;
            settings.defaultAdministratorBackgroundColor = hexToColor(form.bgColor.value, alpha);
            settings.administratorAutoLogoutIntervalEnabled = form.autoLogout.checked;
            const interval = parseInt(form.autoLogoutInterval.value, 10);
            settings.administratorAutoLogoutIntervalField = isNaN(interval) ? 5 : interval;

            settings.clearGlobalMap = form.clearMap.checked;
            if (form.queueBuffer.value !== '') settings.queueBufferSize = parseInt(form.queueBuffer.value, 10);
            else delete settings.queueBufferSize;

            /* Rebuild defaultMetaDataColumns: known columns follow the
               checkboxes, unknown entries are preserved untouched. */
            const next = [];
            for (const name of ['SOURCE', 'TYPE', 'VERSION']) {
                const box = { SOURCE: form.metaSource, TYPE: form.metaType, VERSION: form.metaVersion }[name];
                if (!box.input.checked) continue;
                next.push(form.metaCols.find(c => String(c.name || '').toUpperCase() === name) || DEFAULT_META_COLUMNS[name]);
            }
            for (const c of form.metaCols) {
                const n = String(c.name || '').toUpperCase();
                if (n !== 'SOURCE' && n !== 'TYPE' && n !== 'VERSION') next.push(c);
            }
            settings.defaultMetaDataColumns = Array.isArray(settings.defaultMetaDataColumns)
                ? next : { metaDataColumn: next };

            settings.smtpHost = form.smtpHost.value;
            settings.smtpPort = form.smtpPort.value;
            settings.smtpTimeout = form.smtpTimeout.value;
            settings.smtpFrom = form.smtpFrom.value;
            settings.smtpSecure = form.smtpSecure.value;
            settings.smtpAuth = form.smtpAuth.checked;
            settings.smtpUsername = form.smtpUsername.value;
            settings.smtpPassword = form.smtpPassword.value;

            settings.loginNotificationEnabled = form.loginNotification.checked;
            settings.loginNotificationMessage = form.loginNotificationMessage.value;

            await api.server.setSettings(settings);
            if (form.usageStats && updateSettings) {
                updateSettings.statsEnabled = form.usageStats.checked;
                await api.server.setUpdateSettings(updateSettings);
            }
            // Re-tint the rail + topbar live with the saved color.
            applyEnvironmentColor(settings.defaultAdministratorBackgroundColor);
            toast('Server settings saved');
            markClean();
            return true;
        } catch (e) {
            toast(`Save failed: ${e.message}`, 'error');
            return false;
        }
    }
    setSave(save);

    function sendTestEmail() {
        if (!form) return;
        /* Properties keys verified against SettingsPanelServer.sendTestEmail():
           port, encryption, host, timeout, authentication, username,
           password, toAddress, fromAddress. */
        const toInput = textInput(form.smtpFrom.value);
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
                                { name: 'port', value: form.smtpPort.value },
                                { name: 'encryption', value: form.smtpSecure.value },
                                { name: 'host', value: form.smtpHost.value },
                                { name: 'timeout', value: form.smtpTimeout.value },
                                { name: 'authentication', value: String(form.smtpAuth.checked) },
                                { name: 'username', value: form.smtpUsername.value },
                                { name: 'password', value: form.smtpPassword.value },
                                { name: 'toAddress', value: toInput.value },
                                { name: 'fromAddress', value: form.smtpFrom.value }
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

    async function restoreConfig() {
        const file = await pickFile('.xml');
        if (!file) return;
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
                            load();
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

    setTasks('Server Tasks', [
        taskButton('Refresh', 'refresh', load, { task: 'doRefresh', group: 'settings_Server' }),
        taskButton('Save', 'save', save, { primary: true, task: 'doSave', group: 'settings_Server' }),
        '-',
        taskButton('Backup Config', 'export', backupConfig, { task: 'doBackup', group: 'settings_Server' }),
        taskButton('Restore Config', 'import', restoreConfig, { task: 'doRestore', group: 'settings_Server' }),
        taskButton('Clear All Statistics', 'clear', clearAllStatistics, { danger: true, task: 'doClearAllStats', group: 'settings_Server' })
    ]);

    load();
    return host;
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

function renderAdministratorTab({ setTasks, markClean, setSave }) {
    const host = tabHost();

    function build() {
        clear(host);
        const themeNow = document.documentElement.dataset.theme || 'light';

        const dashRefresh = numberInput(getPref('dashboardRefreshSeconds'), { min: 1 });
        const msgPageSize = select([20, 50, 100], Number(getPref('messagePageSize')) || 20);
        const evtPageSize = select([20, 50, 100], Number(getPref('eventPageSize')) || 20);
        const formatMsgs = yesNo(getPref('formatMessages') !== false);
        const confirmReprocess = yesNo(getPref('confirmReprocessRemove') !== false);
        const yesNoAsk = (val) => select(
            [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'ask', label: 'Ask' }],
            ['yes', 'no', 'ask'].includes(val) ? val : 'ask');
        const importLibs = yesNoAsk(getPref('importLibrariesWithChannels'));
        const exportLibs = yesNoAsk(getPref('exportLibrariesWithChannels'));
        const themeSel = select([{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }], themeNow);

        // Per-user background-color override (Swing SettingsPanelAdministrator):
        // "Server Default" uses the server's color; "Custom" overrides it for this
        // user. Stored as the server user preference "backgroundColor".
        const userId = getState('user')?.id;
        let serverDefaultColor = null;   // loaded async, for the live preview on save
        const bgMode = select([{ value: 'default', label: 'Server Default' }, { value: 'custom', label: 'Custom' }], 'default');
        const bgPicker = h('input', {
            type: 'color', value: '#2a75b2', disabled: true,
            class: 'w-[60px] p-0.5 h-8 ml-2'
        });
        bgMode.addEventListener('change', () => { bgPicker.disabled = bgMode.value !== 'custom'; });
        const bgOverride = h('div', { class: 'flex items-center' }, bgMode, bgPicker);
        (async () => {
            try {
                const [srv, prefs] = await Promise.all([
                    api.server.settings().catch(() => null),
                    userId != null ? api.users.getPreferences(userId).catch(() => null) : Promise.resolve(null)
                ]);
                serverDefaultColor = srv && srv.defaultAdministratorBackgroundColor;
                const override = prefs && parseColorPref(prefs.backgroundColor);
                if (override) { bgMode.value = 'custom'; bgPicker.disabled = false; bgPicker.value = colorToHex(override, '#2a75b2'); }
            } catch { /* ignore */ }
        })();

        // Stacked label-left / control-right rows (matches the Swing settings layout
        // and fills the panel width, one preference per line).
        const prefRow = (label, control) => h('div', {
            class: 'flex items-center gap-4 py-2.5 px-0 border-b border-line'
        }, h('label', { class: 'flex-1 m-0' }, label),
            h('div', { class: 'flex-none' }, control));

        host.appendChild(h('div.panel',
            h('div.panel-header', 'System Preferences'),
            h('div.panel-body',
                prefRow('Dashboard refresh interval (seconds)', dashRefresh),
                prefRow('Message browser page size', msgPageSize),
                prefRow('Event browser page size', evtPageSize),
                prefRow('Format text in message browser', formatMsgs.el),
                prefRow('Reprocess/remove messages confirmation', confirmReprocess.el),
                prefRow('Import code template libraries with channels', importLibs),
                prefRow('Export code template libraries with channels', exportLibs))));

        host.appendChild(h('div.panel',
            h('div.panel-header', 'User Preferences'),
            h('div.panel-body',
                prefRow('Theme', themeSel),
                prefRow('Background color', bgOverride))));

        async function save() {
            setPrefs({
                dashboardRefreshSeconds: Math.max(1, parseInt(dashRefresh.value, 10) || 5),
                messagePageSize: Number(msgPageSize.value) || 20,
                eventPageSize: Number(evtPageSize.value) || 20,
                formatMessages: formatMsgs.checked,
                confirmReprocessRemove: confirmReprocess.checked,
                importLibrariesWithChannels: importLibs.value,
                exportLibrariesWithChannels: exportLibs.value
            });
            setTheme(themeSel.value);
            // Persist the per-user color override (or clear it) and re-tint live.
            if (userId != null) {
                try {
                    const current = await api.users.getPreferences(userId).catch(() => ({}));
                    const props = (current && typeof current === 'object') ? { ...current } : {};
                    let effective;
                    if (bgMode.value === 'custom') {
                        const c = hexToColor(bgPicker.value, 255);
                        props.backgroundColor = serializeColorPref(c);   // <awt-color> XML (Swing-compatible)
                        effective = c;
                    } else {
                        props.backgroundColor = '';   // blank = no override (Swing reads it as server default)
                        effective = serverDefaultColor;
                    }
                    await api.users.setPreferences(userId, props);
                    applyEnvironmentColor(effective);
                } catch (e) {
                    toast(`Could not save background color: ${e.message}`, 'error');
                }
            }
            markClean();
            toast('Preferences saved');
            return true;
        }
        setSave(save);

        setTasks('Administrator Tasks', [
            taskButton('Refresh', 'refresh', build, { task: 'doRefresh', group: 'settings_Administrator' }),
            taskButton('Save', 'save', save, { primary: true, task: 'doSave', group: 'settings_Administrator' }),
            taskButton('Restore Defaults', 'refresh', () => { resetPrefs(); build(); toast('Preferences reset to defaults'); }, { task: 'doSetAdminDefaults', group: 'settings_Administrator' })
        ]);
    }

    build();
    return host;
}

function renderTagsTab({ setTasks, markClean, setSave }) {
    const host = tabHost();
    host.appendChild(loading());
    let tags = [];
    let allChannels = [];
    let currentTag = null;

    const tagChannelIds = (tag) => api.asList(tag.channelIds, 'string').map(String);
    const setTagChannelIds = (tag, ids) => { tag.channelIds = ids.length ? { string: ids } : ''; };
    const channelCount = (tag) => tagChannelIds(tag).length;

    const table = new DataTable([
        { key: 'color', label: '', width: '36px', sortable: false, render: (t) => swatch(t.backgroundColor) },
        { key: 'name', label: 'Name', render: (t) => t.name || '' },
        { key: 'channels', label: 'Channel Count', className: 'num', width: '130px', sortValue: channelCount, render: (t) => String(channelCount(t)) }
    ], {
        selectable: 'single',
        rowKey: (t) => t.id,
        emptyText: 'No tags defined',
        columnsMenu: true,
        columnsMenuKey: 'webadmin-cols-tags',
        onSelect: (rows) => { currentTag = rows[0] || null; renderChannelList(); updateTaskVisibility(); },
        onActivate: (t) => editTag(t),
        onContextMenu: (t, e) => {
            currentTag = t; table.selected = new Set([t.id]); renderChannelList(); updateTaskVisibility();
            contextMenu(e.clientX, e.clientY, [
                { label: 'New Tag', icon: 'plus', onClick: () => addTag() },
                { label: 'Edit Tag', icon: 'edit', onClick: () => editTag(t) },
                '-',
                { label: 'Remove Tag', icon: 'trash', danger: true, onClick: () => removeTag() }
            ]);
        }
    });

    // Selection-dependent tasks only show when a tag is selected.
    const ctxTasks = h('div.ctx-tasks.hidden',
        taskButton('Remove Tag', 'trash', removeTag, { danger: true }));

    function updateTaskVisibility() {
        ctxTasks.classList.toggle('hidden', !currentTag);
    }

    const filterInput = h('input', {
        type: 'text', placeholder: 'Filter channels', class: 'max-w-[280px]',
        onInput: () => renderChannelList()
    });
    const channelListHost = h('div', { class: 'max-h-[260px] overflow-auto flex flex-col gap-1.5' });

    function visibleChannels() {
        const filter = filterInput.value.trim().toLowerCase();
        return filter ? allChannels.filter(c => c.name.toLowerCase().includes(filter)) : allChannels;
    }

    function renderChannelList() {
        clear(channelListHost);
        if (!currentTag) {
            channelListHost.appendChild(h('div.text-text-faint', 'Select a tag above to edit its channel assignments'));
            return;
        }
        const ids = new Set(tagChannelIds(currentTag));
        const visible = visibleChannels();
        if (!visible.length) {
            channelListHost.appendChild(h('div.text-text-faint', 'No channels match the filter'));
            return;
        }
        for (const ch of visible) {
            channelListHost.appendChild(checkbox(ch.name, ids.has(ch.id), {
                onChange: (e) => {
                    const cur = new Set(tagChannelIds(currentTag));
                    if (e.target.checked) cur.add(ch.id); else cur.delete(ch.id);
                    setTagChannelIds(currentTag, [...cur]);
                    table.setRows(tags);
                }
            }).el);
        }
    }

    function bulkSelect(checked) {
        if (!currentTag) { toast('Select a tag first', 'warn'); return; }
        const cur = new Set(tagChannelIds(currentTag));
        for (const ch of visibleChannels()) {
            if (checked) cur.add(ch.id); else cur.delete(ch.id);
        }
        setTagChannelIds(currentTag, [...cur]);
        table.setRows(tags);
        renderChannelList();
    }

    async function load() {
        try {
            const [tagList, idsAndNames] = await Promise.all([
                api.server.channelTags(),
                api.channels.idsAndNames()
            ]);
            tags = tagList;
            allChannels = channelIdNamePairs(idsAndNames);
        } catch (e) {
            toast(`Failed to load tags: ${e.message}`, 'error');
            loadFailed(host, e);
            return;
        }
        clear(host);
        currentTag = null;
        table.clearSelection();
        table.setRows(tags);
        updateTaskVisibility();
        host.appendChild(h('div.panel', h('div.panel-body.flush', table.el)));
        host.appendChild(h('div.panel',
            h('div.panel-header', 'Channels'),
            h('div.panel-body',
                h('div.hint.mb-[14px]', 'Channel selections will be applied to the currently selected tag.'),
                h('div.flex.items-center.gap-2.mb-[14px]', filterInput,
                    h('button.btn', { onClick: () => bulkSelect(true) }, 'Select All'),
                    h('button.btn', { onClick: () => bulkSelect(false) }, 'Deselect All')),
                channelListHost)));
        renderChannelList();
    }

    async function addTag() {
        const name = await promptDialog('New Tag', 'Tag name');
        if (name === null || name.trim() === '') return;
        tags.push({
            id: crypto.randomUUID(),
            name: fixTagName(name),
            channelIds: '',
            backgroundColor: randomPastel()
        });
        table.setRows(tags);
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
                        table.setRows(tags);
                    }
                }
            ]
        });
    }

    async function removeTag() {
        const sel = table.selectedRows();
        if (!sel.length) { toast('Select a tag first', 'warn'); return; }
        const tag = sel[0];
        if (await confirmDialog('Remove Tag', `Remove tag "${tag.name}"? Save to apply.`, { danger: true, okLabel: 'Remove' })) {
            tags = tags.filter(t => t !== tag);
            if (currentTag === tag) currentTag = null;
            table.setRows(tags);
            renderChannelList();
            updateTaskVisibility();
        }
    }

    async function save() {
        try {
            await api.server.setChannelTags(tags);
            markClean();
            toast('Tags saved');
            load();
            return true;
        } catch (e) {
            toast(`Save failed: ${e.message}`, 'error');
            return false;
        }
    }
    setSave(save);

    setTasks('Tag Tasks', [
        taskButton('Refresh', 'refresh', load, { task: 'doRefresh', group: 'settings_Tags' }),
        taskButton('Save', 'save', save, { primary: true, task: 'doSave', group: 'settings_Tags' }),
        taskButton('Add Tag', 'plus', addTag),
        ctxTasks
    ]);

    load();
    return host;
}

/* =============================================================================
   Tab 3 — Configuration Map
   {entry:[{string: key, 'com.mirth.connect.util.ConfigurationProperty':
            {value, comment}}]}
   ============================================================================ */

function renderConfigurationMapTab({ setTasks, markClean, setSave }) {
    const host = tabHost();
    host.appendChild(loading());
    let rows = [];

    const tableHost = h('div.dt-wrap');
    const showValues = checkbox('Show values', false, { onChange: () => renderRows() });

    function renderRows() {
        clear(tableHost);
        const valueType = showValues.input.checked ? 'text' : 'password';
        const tbody = h('tbody');
        const blankRow = () => ({ key: '', value: '', comment: '', propKey: CONFIGURATION_PROPERTY_CLASS, prop: null });
        rows.forEach((row, i) => {
            tbody.appendChild(h('tr', {
                onContextmenu: (e) => {
                    e.preventDefault();
                    contextMenu(e.clientX, e.clientY, [
                        { label: 'Insert Row Above', icon: 'plus', onClick: () => { rows.splice(i, 0, blankRow()); renderRows(); } },
                        { label: 'Insert Row Below', icon: 'plus', onClick: () => { rows.splice(i + 1, 0, blankRow()); renderRows(); } },
                        '-',
                        { label: 'Delete Row', icon: 'trash', onClick: () => { rows.splice(i, 1); renderRows(); } }
                    ]);
                }
            },
                h('td', h('input', { type: 'text', value: row.key, onInput: (e) => { row.key = e.target.value; } })),
                h('td', h('input', { type: valueType, value: row.value, onInput: (e) => { row.value = e.target.value; } })),
                h('td', h('input', { type: 'text', value: row.comment, onInput: (e) => { row.comment = e.target.value; } })),
                h('td', h('button.icon-btn', {
                    title: 'Remove row',
                    onClick: () => { rows.splice(i, 1); renderRows(); }
                }, icon('trash')))));
        });
        if (!rows.length) {
            tbody.appendChild(h('tr', h('td', { colspan: 4 }, h('span.text-text-faint', 'No configuration map entries'))));
        }
        tableHost.appendChild(h('table.dt',
            h('thead', h('tr', h('th', 'Key'), h('th', 'Value'), h('th', 'Comment'), h('th', { class: 'w-10' }, ''))),
            tbody));
    }

    async function load() {
        try {
            const raw = await api.server.configurationMap();
            rows = [];
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
                rows.push({
                    key: String(key ?? ''),
                    value: String(prop?.value ?? ''),
                    comment: String(prop?.comment ?? ''),
                    propKey,
                    prop: (prop && typeof prop === 'object') ? prop : null
                });
            }
            clear(host);
            host.appendChild(h('div.flex.items-center.gap-2.mb-[14px]', showValues.el));
            host.appendChild(h('div.panel',
                h('div.panel-header', 'Configuration Map',
                    h('div.panel-tools', h('button.btn', {
                        onClick: () => { rows.push({ key: '', value: '', comment: '', propKey: CONFIGURATION_PROPERTY_CLASS, prop: null }); renderRows(); }
                    }, icon('plus'), 'Add Row'))),
                h('div.panel-body.flush', tableHost)));
            renderRows();
        } catch (e) {
            toast(`Failed to load configuration map: ${e.message}`, 'error');
            loadFailed(host, e);
        }
    }

    async function save() {
        try {
            /* Round-trip each entry's property-class key and any extra fields
               the engine put on the ConfigurationProperty. */
            const entry = rows.filter(r => r.key.trim() !== '').map(r => ({
                string: r.key.trim(),
                [r.propKey || CONFIGURATION_PROPERTY_CLASS]: { ...(r.prop || {}), value: r.value, comment: r.comment }
            }));
            await api.server.setConfigurationMap({ entry });
            markClean();
            toast('Configuration map saved');
            return true;
        } catch (e) {
            toast(`Save failed: ${e.message}`, 'error');
            return false;
        }
    }
    setSave(save);

    async function importMap() {
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
        const existing = new Set(rows.map(r => r.key));
        const overlap = imported.filter(i => existing.has(i.key)).length;
        const ok = await confirmDialog('Import Configuration Map',
            `Import ${imported.length} propert${imported.length === 1 ? 'y' : 'ies'} from "${file.name}"?` +
            (overlap ? ` ${overlap} existing key(s) will be overwritten.` : ''),
            { okLabel: 'Import' });
        if (!ok) return;
        for (const imp of imported) {
            const row = rows.find(r => r.key === imp.key);
            if (row) {
                row.value = imp.value;
                if (imp.comment) row.comment = imp.comment;
            } else {
                rows.push({ key: imp.key, value: imp.value, comment: imp.comment, propKey: CONFIGURATION_PROPERTY_CLASS, prop: null });
            }
        }
        renderRows();
        toast(`Imported ${imported.length} propert${imported.length === 1 ? 'y' : 'ies'} — Save to apply`);
    }

    function exportMap() {
        const lines = [];
        for (const r of rows) {
            if (r.key.trim() === '') continue;
            if (r.comment && String(r.comment).trim() !== '') {
                for (const c of String(r.comment).split(/\r?\n/)) lines.push('# ' + c);
            }
            lines.push(`${r.key.trim()}=${r.value ?? ''}`);
        }
        saveFile('configuration.properties', 'text/plain', lines.join('\n') + '\n');
    }

    setTasks('Configuration Map Tasks', [
        taskButton('Refresh', 'refresh', load, { task: 'doRefresh', group: 'settings_Configuration Map' }),
        taskButton('Save', 'save', save, { primary: true, task: 'doSave', group: 'settings_Configuration Map' }),
        taskButton('Import Map', 'import', importMap, { task: 'doImportMap', group: 'settings_Configuration Map' }),
        taskButton('Export Map', 'export', exportMap, { task: 'doExportMap', group: 'settings_Configuration Map' })
    ]);

    load();
    return host;
}

/* =============================================================================
   Tab 4 — Database tasks
   DatabaseTask: { id, name, description, status (IDLE/RUNNING),
                   confirmationMessage, affectedChannels, startDateTime }
   ============================================================================ */

function renderDatabaseTasksTab({ setTasks }) {
    const host = tabHost();
    host.appendChild(loading());

    // Status-driven menu gating (Swing parity): Run only when no task is running;
    // Cancel only for the running task.
    let allRows = [];
    const isRunning = (t) => String((t && t.status) || '').toUpperCase() === 'RUNNING';
    const anyRunning = () => allRows.some(isRunning);

    const table = new DataTable([
        { key: 'name', label: 'Name', render: (t) => t.name || '' },
        { key: 'description', label: 'Description', render: (t) => t.description || '' },
        {
            key: 'status', label: 'Status', width: '120px',
            render: (t) => {
                const running = String(t.status || '').toUpperCase() === 'RUNNING';
                return h('span.status-cell', h(`span.pip${running ? '.busy' : ''}`), running ? 'Running' : 'Idle');
            }
        }
    ], {
        selectable: 'single',
        rowKey: (t) => t.id,
        emptyText: 'No database tasks — the engine has no cleanup work to do',
        columnsMenu: true,
        columnsMenuKey: 'webadmin-cols-dbtasks',
        onSelect: () => updateTaskVisibility(),
        onContextMenu: (row, e) => {
            table.selected = new Set([row.id]);
            updateTaskVisibility();
            contextMenu(e.clientX, e.clientY, [
                { label: 'Run Task', icon: 'play', hidden: anyRunning(), task: 'doRunDatabaseTask', group: 'settings_Database Tasks', onClick: () => runTask() },
                { label: 'Cancel Task', icon: 'stop', danger: true, hidden: !isRunning(row), task: 'doCancelDatabaseTask', group: 'settings_Database Tasks', onClick: () => cancelTask() }
            ]);
        }
    });

    // Selection-dependent tasks only show when a task row is selected.
    const runBtn = taskButton('Run Task', 'play', runTask, { task: 'doRunDatabaseTask', group: 'settings_Database Tasks' });
    const cancelBtn = taskButton('Cancel Task', 'stop', cancelTask, { danger: true, task: 'doCancelDatabaseTask', group: 'settings_Database Tasks' });
    const ctxTasks = h('div.ctx-tasks.hidden', runBtn, cancelBtn);

    function updateTaskVisibility() {
        const sel = table.selectedRows();
        ctxTasks.classList.toggle('hidden', sel.length === 0);
        // Run when nothing is running; Cancel only for the running selection.
        // (Buttons may be null if RBAC hid the task.)
        if (runBtn) runBtn.classList.toggle('hidden', sel.length === 0 || anyRunning());
        if (cancelBtn) cancelBtn.classList.toggle('hidden', sel.length === 0 || !isRunning(sel[0]));
    }

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

    let firstLoad = true;
    async function load() {
        try {
            allRows = normalize(await api.databaseTasks.list());
            table.setRows(allRows);
            updateTaskVisibility();
            if (firstLoad) {
                firstLoad = false;
                clear(host);
                host.appendChild(h('div.panel', h('div.panel-body.flush', table.el)));
            }
        } catch (e) {
            toast(`Failed to load database tasks: ${e.message}`, 'error');
            if (firstLoad) loadFailed(host, e);
        }
    }

    function selectedTask() {
        const sel = table.selectedRows();
        if (!sel.length) { toast('Select a task first', 'warn'); return null; }
        return sel[0];
    }

    async function runTask() {
        const task = selectedTask();
        if (!task) return;
        const message = task.confirmationMessage || `Run "${task.name}"? This task may take a long time to complete.`;
        if (await confirmDialog('Run Database Task', message, { okLabel: 'Run' })) {
            try {
                const result = await api.databaseTasks.run(task.id);
                toast(typeof result === 'string' && result ? result : 'Task started');
            } catch (e) {
                toast(`Run failed: ${e.message}`, 'error');
            }
            load();
        }
    }

    async function cancelTask() {
        const task = selectedTask();
        if (!task) return;
        if (!isRunning(task)) { toast(`Task "${task.name}" is not currently running.`, 'warn'); return; }
        try {
            await api.databaseTasks.cancel(task.id);
            toast('Cancel requested');
        } catch (e) {
            toast(`Cancel failed: ${e.message}`, 'error');
        }
        load();
    }

    setTasks('Database Task Tasks', [
        taskButton('Refresh', 'refresh', load, { task: 'doRefresh', group: 'settings_Database Tasks' }),
        ctxTasks
    ]);

    load();
    return host;
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

function renderResourcesTab({ setTasks, platform, markClean, setSave }) {
    const host = tabHost();
    host.appendChild(loading());
    let entries = [];               // [{ className, obj }]
    let containerIsArray = false;   // round-trip the fetched container shape

    const isDefault = (entry) => entry && entry.obj.id === 'Default Resource';

    const table = new DataTable([
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
    ], {
        selectable: 'single',
        rowKey: (e) => e.obj.id,
        emptyText: 'No resources',
        columnsMenu: true,
        columnsMenuKey: 'webadmin-cols-resources',
        onSelect: (rows) => { renderDetail(rows[0] || null); updateTaskVisibility(); },
        onContextMenu: (row, e) => {
            renderDetail(row);
            updateTaskVisibility();
            contextMenu(e.clientX, e.clientY, [
                { label: 'Add Resource', icon: 'plus', task: 'doAddResource', group: 'settings_Resources', onClick: () => addResource() },
                { label: 'Remove Resource', icon: 'trash', danger: true, hidden: isDefault(row), task: 'doRemoveResource', group: 'settings_Resources', onClick: () => removeResource() },
                { label: 'Reload Resource', icon: 'refresh', task: 'doReloadResource', group: 'settings_Resources', onClick: () => reloadResource() }
            ]);
        }
    });

    // Selection-dependent tasks only show when a resource is selected.
    const removeBtn = taskButton('Remove Resource', 'trash', removeResource, { danger: true, task: 'doRemoveResource', group: 'settings_Resources' });
    const ctxTasks = h('div.ctx-tasks.hidden',
        removeBtn,
        taskButton('Reload Resource', 'refresh', reloadResource, { task: 'doReloadResource', group: 'settings_Resources' }));

    function updateTaskVisibility() {
        const sel = table.selectedRows();
        ctxTasks.classList.toggle('hidden', sel.length === 0);
        // The Default Resource cannot be removed (Swing hides Remove for it).
        // (removeBtn may be null if RBAC hid the task.)
        if (removeBtn) removeBtn.classList.toggle('hidden', sel.length === 0 || isDefault(sel[0]));
    }

    const detailHost = h('div');
    let detailRoot = null;   // teardown for the mounted resource-detail React component

    function normalize(raw) {
        entries = [];
        containerIsArray = Array.isArray(raw);
        if (containerIsArray) {
            for (const obj of raw) {
                if (obj && typeof obj === 'object') entries.push({ className: obj['@class'] || DIRECTORY_RESOURCE_CLASS, obj });
            }
        } else if (raw && typeof raw === 'object') {
            for (const [className, value] of Object.entries(raw)) {
                if (className.startsWith('@')) continue;
                for (const obj of api.asList(value)) {
                    if (obj && typeof obj === 'object') entries.push({ className, obj });
                }
            }
        }
    }

    function container() {
        if (containerIsArray) return entries.map(e => e.obj);
        const out = {};
        for (const e of entries) {
            if (!out[e.className]) out[e.className] = [];
            out[e.className].push(e.obj);
        }
        return out;
    }

    function selectedEntry() {
        const sel = table.selectedRows();
        if (!sel.length) { toast('Select a resource first', 'warn'); return null; }
        return sel[0];
    }

    // The detail editor for each resource type comes from a registered
    // ResourceClientPlugin (e.g. plugins/directoryresource); the Resources panel
    // itself stays generic.
    function renderDetail(entry) {
        if (detailRoot) { detailRoot(); detailRoot = null; }
        clear(detailHost);
        if (!entry) {
            detailHost.appendChild(h('div.text-text-faint', 'Select a resource above to edit its settings'));
            return;
        }
        const types = platform.resourceTypes();
        const def = types.find(t => t.type === entry.obj.type) || types[0];
        if (def && def.component) {
            detailRoot = mountReact(detailHost, <PluginSlot def={def} ctx={{
                entry, locked: isDefault(entry), platform,
                refreshTable: () => table.setRows(entries)
            }} />);
        } else {
            detailHost.appendChild(h('div.text-text-faint', `No editor registered for resource type "${entry.obj.type || '?'}"`));
        }
    }

    async function load() {
        try {
            normalize(await api.server.resources());
        } catch (e) {
            toast(`Failed to load resources: ${e.message}`, 'error');
            loadFailed(host, e);
            return;
        }
        clear(host);
        table.clearSelection();
        table.setRows(entries);
        updateTaskVisibility();
        host.appendChild(h('div.panel', h('div.panel-body.flush', table.el)));
        host.appendChild(h('div.panel',
            h('div.panel-header', (platform.resourceTypes()[0] || {}).detailHeader || 'Resource Settings'),
            h('div.panel-body', detailHost)));
        renderDetail(null);
    }

    // Create a new resource of the (only, for now) registered type, then edit it
    // in the detail panel below — the type plugin supplies the factory + editor.
    function addResource() {
        const def = platform.resourceTypes()[0];
        if (!def || !def.create) { toast('No resource types are registered', 'warn'); return; }
        const template = entries.find(e => e.obj && e.obj['@version']);
        const obj = def.create({ version: template ? template.obj['@version'] : undefined, containerIsArray });
        const entry = { className: def.propertiesClass || DIRECTORY_RESOURCE_CLASS, obj };
        entries.push(entry);
        table.setRows(entries);
        renderDetail(entry);
    }

    async function removeResource() {
        const entry = selectedEntry();
        if (!entry) return;
        if (isDefault(entry)) { toast('The Default Resource cannot be removed', 'warn'); return; }
        if (await confirmDialog('Remove Resource', `Remove resource "${entry.obj.name}"? Save to apply.`, { danger: true, okLabel: 'Remove' })) {
            entries = entries.filter(e => e !== entry);
            table.setRows(entries);
            renderDetail(null);
            updateTaskVisibility();
        }
    }

    async function reloadResource() {
        const entry = selectedEntry();
        if (!entry) return;
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
            markClean();
            toast('Resources saved');
            load();
            return true;
        } catch (e) {
            toast(`Save failed: ${e.message}`, 'error');
            return false;
        }
    }
    setSave(save);

    setTasks('Resource Tasks', [
        taskButton('Refresh', 'refresh', load, { task: 'doRefresh', group: 'settings_Resources' }),
        taskButton('Save', 'save', save, { primary: true, task: 'doSave', group: 'settings_Resources' }),
        taskButton('Add Resource', 'plus', addResource, { task: 'doAddResource', group: 'settings_Resources' }),
        ctxTasks
    ]);

    load();
    // Unmount the resource-detail React root on tab switch (SettingsTab teardown
    // calls host.__teardown); detailRoot is reassigned lazily in renderDetail.
    host.__teardown = () => { if (detailRoot) { detailRoot(); detailRoot = null; } };
    return host;
}

/* =============================================================================
   View shell — React tabs + per-tab task pane via <ViewTasks>
   Each tab BODY is the legacy imperative builder mounted into a ref'd div; the
   builder calls setTasks(title, items) to declare its task pane (legacy DOM task
   buttons, including the .ctx-tasks selection-gated groups). The active tab's
   taskbar DOM is portaled into the rail through <RailPane> + <ViewTasks>, with
   the pane title following the active tab — switching tabs swaps the pane (and
   title) reactively, no route change. Only the active tab is mounted, matching
   the vanilla tabs() that rebuilds on switch.
   ============================================================================ */

const BUILTIN_TABS = [
    { label: 'Server', render: (ctx) => renderServerTab(ctx) },
    { label: 'Administrator', render: (ctx) => renderAdministratorTab(ctx) },
    { label: 'Tags', render: (ctx) => renderTagsTab(ctx) },
    { label: 'Configuration Map', render: (ctx) => renderConfigurationMapTab(ctx) },
    { label: 'Database Tasks', render: (ctx) => renderDatabaseTasksTab(ctx) },
    { label: 'Resources', render: (ctx) => renderResourcesTab(ctx) }
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

/* Save/Discard/Cancel prompt for unsaved settings changes (Swing parity). */
function promptSaveSettings() {
    return new Promise((resolve) => {
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

function SettingsView() {
    const [active, setActive] = useState(0);
    const [dirty, setDirtyState] = useState(false);   // drives the unsaved-tab indicator
    const [, force] = useReducer((x) => x + 1, 0);
    // The active tab's declared task pane (title + legacy DOM items).
    const tasksRef = useRef({ title: 'Server Tasks', items: [] });
    const dirtyRef = useRef(false);
    const saveRef = useRef(null);   // the active tab's save(), if it supports saving

    // Tab defs (built-ins + plugin panels) are stable for the view's lifetime.
    const defsRef = useRef(null);
    if (!defsRef.current) defsRef.current = buildTabDefs(platform);
    const defs = defsRef.current;

    // setTasks is what each legacy builder calls; it captures the task spec and
    // forces a re-render of the portaled pane. ctx mirrors the vanilla shell ctx,
    // plus dirty-tracking hooks (markDirty/markClean/setSave) used by the tabs.
    const ctxRef = useRef(null);
    if (!ctxRef.current) {
        // When dirty, install a route-leave guard that prompts to save/discard.
        function refreshGuard() {
            if (dirtyRef.current) {
                setState('navGuard', async () => {
                    const choice = await promptSaveSettings();
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
