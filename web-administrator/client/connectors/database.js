/*
 * Database Reader (DatabaseReceiverProperties) / Database Writer (DatabaseDispatcherProperties).
 */

import { h } from '../core/ui.js';
import { buildForm, pollSection, YES_NO, defaultSourceProperties, defaultDestinationProperties, defaultPollProperties, CHARSETS } from './forms.js';

const DRIVER_DEFAULT = 'Please Select One';

function driverSelectField(properties, platform, form) {
    const driverField = {
        key: 'driver', label: 'Driver', type: 'select',
        options: [{ value: properties.driver ?? DRIVER_DEFAULT, label: properties.driver ?? DRIVER_DEFAULT }]
    };
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
    return driverField;
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
