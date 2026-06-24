/*
 * Database Reader (DatabaseReceiverProperties) / Database Writer (DatabaseDispatcherProperties).
 *
 * React port: def.render(host, ctx) -> def.component(ctx) => JSX. Field schemas,
 * defaults, the Database Drivers manager modal, and the driver-dropdown async
 * population are reused VERBATIM. The driver dropdown is a `custom` field that
 * returns the original imperative <select> DOM node (populated from
 * server.databaseDrivers, falling back to a text input on error) with the
 * manage-drivers wrench as its `append` — the same elements the panel built.
 */

import { React } from './react-platform.js';
import { h, modal, textInput, select, icon, toast, clear, confirmDialog } from '@oie/web-ui';
import { ConnectorForm, PollSection, asBool, YES_NO, defaultSourceProperties, defaultDestinationProperties, defaultPollProperties, CHARSETS } from './react-forms.js';
import api from '../core/api.js';

const DRIVER_DEFAULT = 'Please Select One';

/* The JDBC drivers list is fetched once and cached for the lifetime of the
   editor (it's a server-global list); the wrench-save invalidates it so the
   dropdown picks up edits. Caching here means a form repaint (e.g. toggling a
   refresh field) reuses the list instead of re-fetching — matching the
   imperative panel, which fetched once at field creation + on wrench-save. */
let driversPromise = null;
function loadDrivers(platform) {
    if (!driversPromise) driversPromise = platform.api.server.databaseDrivers();
    return driversPromise;
}

/* Boilerplate "Connection" code generators (Swing generateConnectionString /
   generateUpdateConnectionString). Pure client-side string building from the
   driver/url/username/password fields — no server call — matching the engine
   character-for-character so the generated JavaScript is identical. */
function generateConnectionString(p) {
    return 'var dbConn;\n' +
        '\ntry {\n\tdbConn = DatabaseConnectionFactory.createDatabaseConnection(\'' +
        (p.driver || '') + '\',\'' + (p.url || '') + '\',\'' +
        (p.username || '') + '\',\'' + (p.password || '') +
        '\');\n\n\t// You may access this result below with $(\'column_name\')\n\treturn result;\n} finally {' +
        '\n\tif (dbConn) { \n\t\tdbConn.close();\n\t}\n}';
}

/* Reader post-process connection boilerplate (DatabaseReader.generateUpdateConnectionString).
   The leading comment varies with the post-process mode (each row vs once) and an
   extra note is added when results are aggregated. updateMode: UPDATE_EACH=3. */
function generateUpdateConnectionString(p) {
    let s = '';
    if (Number(p.updateMode) === 3) {
        s += '// This update script will be executed once for every result returned from the above query.\n';
    } else {
        s += '// This update script will be executed once after all results have been processed.\n';
    }
    if (asBool(p.aggregateResults)) {
        s += '// If "Aggregate Results" is enabled, you have access to "results",\n// a List of Map objects representing all rows returned from the above query.\n';
    }
    s += 'var dbConn;\n' +
        '\ntry {\n\tdbConn = DatabaseConnectionFactory.createDatabaseConnection(\'' +
        (p.driver || '') + '\',\'' + (p.url || '') + '\',\'' +
        (p.username || '') + '\',\'' + (p.password || '') +
        '\');\n\n} finally {' +
        '\n\tif (dbConn) { \n\t\tdbConn.close();\n\t}\n}';
    return s;
}

/* Writer connection boilerplate (DatabaseWriter.generateConnectionString) — like
   the reader's but with no leading comment and no "return result" line. */
function generateWriterConnectionString(p) {
    return 'var dbConn;\n' +
        '\ntry {\n\tdbConn = DatabaseConnectionFactory.createDatabaseConnection(\'' +
        (p.driver || '') + '\',\'' + (p.url || '') + '\',\'' +
        (p.username || '') + '\',\'' + (p.password || '') +
        '\');\n\n} finally {' +
        '\n\tif (dbConn) { \n\t\tdbConn.close();\n\t}\n}';
}


/* "Insert URL Template" button (Swing insertURLTemplateButton): fills the URL
   field with the selected driver's JDBC URL template, confirming first when a
   URL is already present (matching insertURLTemplateButtonActionPerformed). */
function insertUrlTemplateButton(properties, platform, onChange) {
    return h('button.btn', {
        type: 'button', class: 'ml-1.5',
        onClick: async () => {
            const drivers = await loadDrivers(platform).catch(() => []);
            const d = drivers.find((x) => x && String(x.className) === String(properties.driver));
            const template = d && d.template ? String(d.template) : '';
            if (!template) { toast('The selected driver has no URL template.', 'warn'); return; }
            if (properties.url && !(await confirmDialog('Insert URL Template',
                'Replace your current connection URL with the template URL?', { okLabel: 'Replace' }))) return;
            properties.url = template;
            onChange();
        }
    }, 'Insert URL Template');
}

/* The Driver <select> DOM node, populated asynchronously from the cached drivers
   list (falling back to a free-text input on error). Mirrors the imperative
   driverSelectField; the wrench append opens the drivers modal. */
function driverControlNode(properties, platform, onChange) {
    const wrap = h('div', { class: 'flex items-center gap-1.5' });
    const wrench = h('button.icon-btn', {
        type: 'button', title: 'View and manage the list of database JDBC drivers',
        class: 'ml-1.5',
        onClick: () => openDriversModal(() => { driversPromise = null; refresh(); })
    }, icon('settings'));

    function rebuild(control) {
        clear(wrap);
        wrap.appendChild(control);
        wrap.appendChild(wrench);
    }

    function refresh() {
        loadDrivers(platform).then((drivers) => {
            const options = [{ value: DRIVER_DEFAULT, label: DRIVER_DEFAULT }];
            for (const d of drivers) {
                if (d && d.className) options.push({ value: d.className, label: d.name || d.className });
            }
            const current = properties.driver;
            if (current && !options.some((o) => o.value === current)) {
                options.push({ value: current, label: current });
            }
            const sel = select(options, properties.driver ?? DRIVER_DEFAULT, {
                onChange: (e) => { properties.driver = e.target.value; onChange(); }
            });
            sel.style.width = '220px';
            rebuild(sel);
        }).catch(() => {
            // Engine unreachable: fall back to a free-text driver-class input.
            const input = textInput(properties.driver ?? '', {
                placeholder: 'org.postgresql.Driver',
                onChange: (e) => { properties.driver = e.target.value; onChange(); }
            });
            input.style.width = '220px';
            rebuild(input);
        });
    }

    // Initial render: a static select with the current driver while loading.
    const initial = select(
        [{ value: properties.driver ?? DRIVER_DEFAULT, label: properties.driver ?? DRIVER_DEFAULT }],
        properties.driver ?? DRIVER_DEFAULT,
        { onChange: (e) => { properties.driver = e.target.value; onChange(); } });
    initial.style.width = '220px';
    rebuild(initial);
    refresh();
    return wrap;
}

/* Database Drivers manager — a modal table of DriverInfo records (Name, Driver
   Class, JDBC URL Template, Select with Limit Query, Legacy Driver Classes) with
   Add/Remove, persisted via PUT /server/databaseDrivers. Mirrors the Swing
   DatabaseDriversDialog. `onSaved` lets the connector refresh its dropdown. */
async function openDriversModal(onSaved) {
    let model;
    try {
        const drivers = await api.server.databaseDrivers();
        model = drivers.map((d) => ({
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
            return h('td', { class: 'py-0.5 px-1' }, inp);
        };
        return h('tr',
            cell('name', 'Name', '120px'),
            cell('className', 'com.example.Driver', '200px'),
            cell('template', 'jdbc:db://host:port/name', '220px'),
            cell('selectLimit', 'SELECT * FROM ? LIMIT 1', '180px'),
            cell('alt', 'legacy.Driver, ...', '160px'),
            h('td', { class: 'py-0.5 px-1' },
                h('button.icon-btn', { type: 'button', title: 'Remove', onClick: () => { model.splice(model.indexOf(d), 1); renderRows(); } }, icon('x'))));
    }
    function renderRows() {
        clear(tbody);
        if (!model.length) tbody.appendChild(h('tr', h('td', { colSpan: 6, class: 'faint p-3' }, 'No drivers — click Add.')));
        else model.forEach((d) => tbody.appendChild(rowEl(d)));
    }
    renderRows();

    const table = h('table.dt', h('thead', h('tr',
        h('th', 'Name'), h('th', 'Driver Class'), h('th', 'JDBC URL Template'),
        h('th', 'Select with Limit Query'), h('th', 'Legacy Driver Classes'), h('th', ''))), tbody);

    const addBtn = h('button.btn', { type: 'button', onClick: () => { model.push({ name: '', className: '', template: '', selectLimit: '', alt: '' }); renderRows(); } }, icon('plus'), 'Add');

    modal({
        title: 'Database Drivers',
        size: 'xwide',
        body: h('div', { class: 'flex flex-col gap-2.5' },
            h('div', addBtn),
            h('div', { class: 'max-h-[55vh] overflow-auto' }, table)),
        buttons: [
            { label: 'Close' },
            {
                label: 'Save', primary: true,
                onClick: async () => {
                    const payload = model
                        .filter((d) => d.name.trim() || d.className.trim())
                        .map((d) => {
                            const alt = d.alt.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
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
    component({ properties, platform, onChange }) {
        return (
            <div>
                <PollSection properties={properties} onChange={onChange} />
                <ConnectorForm properties={properties} onChange={onChange} fields={[
                    { section: 'Connection Settings' },
                    { type: 'custom', label: 'Driver', render: () => driverControlNode(properties, platform, onChange) },
                    { key: 'url', label: 'URL', type: 'text', width: '420px', append: (p, ctx) => insertUrlTemplateButton(p, platform, ctx.onChange) },
                    { key: 'username', label: 'Username', type: 'text', width: '220px' },
                    { key: 'password', label: 'Password', type: 'password', width: '220px' },
                    { section: 'Database Reader Settings' },
                    {
                        // Swing useScriptYes/NoActionPerformed: toggling re-seeds the editors —
                        // Yes fills the Select + Post-Process editors with the connection
                        // boilerplate (and switches them to JavaScript); No clears them back to SQL.
                        key: 'useScript', label: 'Use JavaScript', type: 'radio', options: YES_NO, refresh: true,
                        onSet: (p, v) => {
                            if (asBool(v)) {
                                p.select = generateConnectionString(p);
                                p.update = generateUpdateConnectionString(p);
                            } else {
                                p.select = '';
                                p.update = '';
                            }
                        }
                    },
                    // Swing useScriptYes/No: Keep Connection Open is disabled in JavaScript mode.
                    { key: 'keepConnectionOpen', label: 'Keep Connection Open', type: 'radio', options: YES_NO, disabled: (p) => asBool(p.useScript) },
                    // Swing aggregateResultsActionPerformed(true): forces Cache Results=Yes and disables it.
                    {
                        key: 'aggregateResults', label: 'Aggregate Results', type: 'radio', options: YES_NO, refresh: true,
                        onSet: (p) => { if (asBool(p.aggregateResults)) p.cacheResults = true; }
                    },
                    // Swing: Cache Results enabled only when Use JavaScript=No AND Aggregate Results=No.
                    { key: 'cacheResults', label: 'Cache Results', type: 'radio', options: YES_NO, refresh: true, disabled: (p) => asBool(p.useScript) || asBool(p.aggregateResults) },
                    // Swing: Fetch Size enabled only when Use JavaScript=No AND Cache Results=No (aggregate forces cache=Yes).
                    { key: 'fetchSize', label: 'Fetch Size', type: 'number', width: '110px', disabled: (p) => asBool(p.useScript) || asBool(p.cacheResults) || asBool(p.aggregateResults) },
                    { key: 'retryCount', label: '# of Retries on Error', type: 'number', width: '110px' },
                    { key: 'retryInterval', label: 'Retry Interval (ms)', type: 'number', width: '120px' },
                    { key: 'encoding', label: 'Encoding', type: 'select', options: CHARSETS, width: '160px' },
                    { section: 'Query' },
                    {
                        // Swing flips selectSQLLabel 'SQL:'<->'JavaScript:' + the editor syntax on Use JavaScript.
                        key: 'select', label: (p) => asBool(p.useScript) ? 'JavaScript' : 'SQL', type: 'code', minHeight: '180px',
                        language: (p) => asBool(p.useScript) ? 'javascript' : 'sql',
                        tooltip: 'SQL select statement, or a JavaScript script when "Use JavaScript" is Yes'
                    },
                    {
                        // Swing option labels (UPDATE_NEVER=1, UPDATE_EACH=3, UPDATE_ONCE=2);
                        // runPostProcessSQLLabel flips 'SQL'<->'Script' on Use JavaScript.
                        key: 'updateMode', label: (p) => asBool(p.useScript) ? 'Run Post-Process Script' : 'Run Post-Process SQL', type: 'radio', refresh: true,
                        options: [
                            { value: 1, label: 'Never' },
                            { value: 3, label: 'After each message' },
                            { value: 2, label: 'Once after all messages' }
                        ]
                    },
                    {
                        // Swing updateNeverActionPerformed keeps this editor VISIBLE but disabled at Never.
                        // The `code` field now honours `disabled`, so match Swing: grey it out (not hide it).
                        key: 'update', label: (p) => asBool(p.useScript) ? 'JavaScript' : 'SQL', type: 'code', minHeight: '140px',
                        language: (p) => asBool(p.useScript) ? 'javascript' : 'sql',
                        disabled: (p) => Number(p.updateMode) === 1
                    }
                ]} />
            </div>
        );
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
    component({ properties, platform, onChange }) {
        return (
            <ConnectorForm properties={properties} onChange={onChange} fields={[
                { section: 'Connection Settings' },
                { type: 'custom', label: 'Driver', render: () => driverControlNode(properties, platform, onChange) },
                { key: 'url', label: 'URL', type: 'text', width: '420px', append: (p, ctx) => insertUrlTemplateButton(p, platform, ctx.onChange) },
                { key: 'username', label: 'Username', type: 'text', width: '220px' },
                { key: 'password', label: 'Password', type: 'password', width: '220px' },
                { section: 'Query' },
                {
                    // Swing useJavaScriptYes/NoActionPerformed: toggling re-seeds the editor —
                    // Yes fills it with the connection boilerplate (and switches to JavaScript);
                    // No clears it back to SQL.
                    key: 'useScript', label: 'Use JavaScript', type: 'radio', options: YES_NO, refresh: true,
                    onSet: (p, v) => { p.query = asBool(v) ? generateWriterConnectionString(p) : ''; }
                },
                {
                    // Swing flips sqlLabel 'SQL:'<->'JavaScript:' + the editor syntax on Use JavaScript.
                    key: 'query', label: (p) => asBool(p.useScript) ? 'JavaScript' : 'SQL', type: 'code', minHeight: '200px',
                    language: (p) => asBool(p.useScript) ? 'javascript' : 'sql'
                }
            ]} />
        );
    }
};

export function register(platform) {
    platform.registerConnectorPanel('Database Reader', 'SOURCE', databaseReader);
    platform.registerConnectorPanel('Database Writer', 'DESTINATION', databaseWriter);
}
