/*
 * Database Reader (DatabaseReceiverProperties) / Database Writer (DatabaseDispatcherProperties).
 */

import { h, modal, textInput, icon, toast, clear } from '../core/ui.js';
import { buildForm, pollSection, YES_NO, defaultSourceProperties, defaultDestinationProperties, defaultPollProperties, CHARSETS } from './forms.js';
import api from '../core/api.js';

const DRIVER_DEFAULT = 'Please Select One';

function driverSelectField(properties, platform, form) {
    const driverField = {
        key: 'driver', label: 'Driver', type: 'select',
        options: [{ value: properties.driver ?? DRIVER_DEFAULT, label: properties.driver ?? DRIVER_DEFAULT }],
        // Wrench button beside the dropdown — opens the Database Drivers manager
        // (mirrors the Swing manageDriversButton on the JDBC connectors).
        append: () => h('button.icon-btn', {
            type: 'button', title: 'View and manage the list of database JDBC drivers',
            style: { marginLeft: '6px' },
            onClick: () => openDriversModal(() => refreshOptions())
        }, icon('settings'))
    };
    function refreshOptions() {
        platform.api.server.databaseDrivers().then(drivers => {
            const options = [{ value: DRIVER_DEFAULT, label: DRIVER_DEFAULT }];
            for (const d of drivers) {
                if (d && d.className) options.push({ value: d.className, label: d.name || d.className });
            }
            const current = properties.driver;
            if (current && !options.some(o => o.value === current)) {
                options.push({ value: current, label: current });
            }
            driverField.options = options;
            form.current && form.current.repaint();
        }).catch(() => {
            driverField.type = 'text';
            driverField.placeholder = 'org.postgresql.Driver';
            form.current && form.current.repaint();
        });
    }
    refreshOptions();
    return driverField;
}

/* Database Drivers manager — a modal table of DriverInfo records (Name, Driver
   Class, JDBC URL Template, Select with Limit Query, Legacy Driver Classes) with
   Add/Remove, persisted via PUT /server/databaseDrivers. Mirrors the Swing
   DatabaseDriversDialog. `onSaved` lets the connector refresh its dropdown. */
async function openDriversModal(onSaved) {
    let model;
    try {
        const drivers = await api.server.databaseDrivers();
        model = drivers.map(d => ({
            name: d.name || '', className: d.className || '', template: d.template || '',
            selectLimit: d.selectLimit || '',
            alt: api.asList(d.alternativeClassNames, 'string').map(String).filter(Boolean).join(', ')
        }));
    } catch (e) {
        toast(`Could not load drivers: ${e.message}`, 'error');
        return;
    }

    const tbody = h('tbody');
    function rowEl(d) {
        const cell = (key, ph, w) => {
            const inp = textInput(d[key], { placeholder: ph, style: { width: w, minWidth: w } });
            inp.addEventListener('input', () => { d[key] = inp.value; });
            return h('td', { style: { padding: '2px 4px' } }, inp);
        };
        return h('tr',
            cell('name', 'Name', '120px'),
            cell('className', 'com.example.Driver', '200px'),
            cell('template', 'jdbc:db://host:port/name', '220px'),
            cell('selectLimit', 'SELECT * FROM ? LIMIT 1', '180px'),
            cell('alt', 'legacy.Driver, ...', '160px'),
            h('td', { style: { padding: '2px 4px' } },
                h('button.icon-btn', { type: 'button', title: 'Remove', onClick: () => { model.splice(model.indexOf(d), 1); renderRows(); } }, icon('x'))));
    }
    function renderRows() {
        clear(tbody);
        if (!model.length) tbody.appendChild(h('tr', h('td', { colSpan: 6, class: 'faint', style: { padding: '12px' } }, 'No drivers — click Add.')));
        else model.forEach(d => tbody.appendChild(rowEl(d)));
    }
    renderRows();

    const table = h('table.dt', h('thead', h('tr',
        h('th', 'Name'), h('th', 'Driver Class'), h('th', 'JDBC URL Template'),
        h('th', 'Select with Limit Query'), h('th', 'Legacy Driver Classes'), h('th', ''))), tbody);

    const addBtn = h('button.btn', { type: 'button', onClick: () => { model.push({ name: '', className: '', template: '', selectLimit: '', alt: '' }); renderRows(); } }, icon('plus'), 'Add');

    modal({
        title: 'Database Drivers',
        size: 'xwide',
        body: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
            h('div', addBtn),
            h('div', { style: { maxHeight: '55vh', overflow: 'auto' } }, table)),
        buttons: [
            { label: 'Close' },
            {
                label: 'Save', primary: true,
                onClick: async () => {
                    const payload = model
                        .filter(d => d.name.trim() || d.className.trim())
                        .map(d => {
                            const alt = d.alt.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
                            return {
                                name: d.name.trim(),
                                className: d.className.trim(),
                                template: d.template,
                                selectLimit: d.selectLimit,
                                // List<String>: { string: [...] } when present, empty element otherwise.
                                alternativeClassNames: alt.length ? { string: alt } : ''
                            };
                        });
                    try {
                        await api.server.setDatabaseDrivers(payload);
                        toast('Database drivers saved');
                        onSaved && onSaved();
                    } catch (e) {
                        toast(`Save failed: ${e.message}`, 'error');
                        return false;
                    }
                }
            }
        ]
    });
}

const databaseReader = {
    defaults(version) {
        return {
            '@class': 'com.mirth.connect.connectors.jdbc.DatabaseReceiverProperties',
            '@version': version,
            pluginProperties: null,
            pollConnectorProperties: defaultPollProperties(version),
            sourceConnectorProperties: defaultSourceProperties(version),
            driver: DRIVER_DEFAULT,
            url: '',
            username: '',
            password: '',
            select: '',
            update: '',
            useScript: false,
            aggregateResults: false,
            cacheResults: true,
            keepConnectionOpen: true,
            updateMode: 1,
            retryCount: '3',
            retryInterval: '10000',
            fetchSize: '1000',
            encoding: 'DEFAULT_ENCODING'
        };
    },
    render(host, { properties, platform, onChange }) {
        const formHost = h('div');
        host.appendChild(formHost);
        const form = { current: null };
        const driverField = driverSelectField(properties, platform, form);
        form.current = buildForm(formHost, properties, [
            { section: 'Connection Settings' },
            driverField,
            { key: 'url', label: 'URL', type: 'text', width: '420px', placeholder: 'jdbc:...' },
            { key: 'username', label: 'Username', type: 'text', width: '220px' },
            { key: 'password', label: 'Password', type: 'password', width: '220px' },
            { section: 'Database Reader Settings' },
            { key: 'useScript', label: 'Use JavaScript', type: 'radio', options: YES_NO, refresh: true },
            { key: 'keepConnectionOpen', label: 'Keep Connection Open', type: 'radio', options: YES_NO },
            { key: 'aggregateResults', label: 'Aggregate Results', type: 'radio', options: YES_NO },
            { key: 'cacheResults', label: 'Cache Results', type: 'radio', options: YES_NO },
            { key: 'fetchSize', label: 'Fetch Size', type: 'number', width: '110px' },
            { key: 'retryCount', label: 'Retries on Error', type: 'number', width: '110px' },
            { key: 'retryInterval', label: 'Retry Interval (ms)', type: 'number', width: '120px' },
            { key: 'encoding', label: 'Encoding', type: 'select', options: CHARSETS, width: '160px' },
            { section: 'Query' },
            {
                key: 'select', label: 'Select Query / Script', type: 'code', minHeight: '180px', language: 'sql',
                tooltip: 'SQL select statement, or a JavaScript script when "Use JavaScript" is Yes'
            },
            {
                key: 'updateMode', label: 'Run Post-Process Update', type: 'radio', refresh: true,
                options: [
                    { value: 1, label: 'Never' },
                    { value: 2, label: 'Once per Poll' },
                    { value: 3, label: 'For each Message' }
                ]
            },
            {
                key: 'update', label: 'Update Query / Script', type: 'code', minHeight: '140px', language: 'sql',
                visible: (p) => Number(p.updateMode) !== 1
            }
        ], onChange);
        host.appendChild(pollSection(properties, onChange));
    }
};

const databaseWriter = {
    defaults(version) {
        return {
            '@class': 'com.mirth.connect.connectors.jdbc.DatabaseDispatcherProperties',
            '@version': version,
            pluginProperties: null,
            destinationConnectorProperties: defaultDestinationProperties(version),
            driver: DRIVER_DEFAULT,
            url: '',
            username: '',
            password: '',
            query: '',
            parameters: null,
            useScript: false
        };
    },
    render(host, { properties, platform, onChange }) {
        const formHost = h('div');
        host.appendChild(formHost);
        const form = { current: null };
        const driverField = driverSelectField(properties, platform, form);
        form.current = buildForm(formHost, properties, [
            { section: 'Connection Settings' },
            driverField,
            { key: 'url', label: 'URL', type: 'text', width: '420px', placeholder: 'jdbc:...' },
            { key: 'username', label: 'Username', type: 'text', width: '220px' },
            { key: 'password', label: 'Password', type: 'password', width: '220px' },
            { section: 'Query' },
            { key: 'useScript', label: 'Use JavaScript', type: 'radio', options: YES_NO, refresh: true },
            { key: 'query', label: 'SQL / Script', type: 'code', minHeight: '200px', language: 'sql' }
        ], onChange);
    }
};

export function register(platform) {
    platform.registerConnectorPanel('Database Reader', 'SOURCE', databaseReader);
    platform.registerConnectorPanel('Database Writer', 'DESTINATION', databaseWriter);
}
