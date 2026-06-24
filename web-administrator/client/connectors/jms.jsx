/*
 * JMS Listener (JmsReceiverProperties) / JMS Sender (JmsDispatcherProperties).
 * Field names and defaults mirror server/src/com/mirth/connect/connectors/jms
 * (both extend JmsConnectorProperties).
 *
 * React port: def.render(host, ctx) -> def.component(ctx) => JSX. The shared
 * connection-field schema and defaults are reused VERBATIM.
 */

import { React } from './react-platform.js';
import { h, clear, select, icon, checkbox, toast, confirmDialog, promptDialog } from '@oie/web-ui';
import * as api from '../core/api.js';
import {
    ConnectorForm, asBool, YES_NO, writeMapEntries, apiErrorMessage,
    defaultSourceProperties, defaultDestinationProperties
} from './react-forms.js';

/* JmsConnectorProperties constructor defaults (shared by listener/sender). */
function jmsConnectorDefaults() {
    return {
        useJndi: false,
        jndiProviderUrl: '',
        jndiInitialContextFactory: '',
        jndiConnectionFactoryName: '',
        connectionFactoryClass: '',
        connectionProperties: { '@class': 'linked-hash-map' },
        username: '',
        password: '',
        destinationName: '',
        topic: false,
        clientId: ''
    };
}

const usingJndi = (p) => asBool(p.useJndi);

/* ---- Connection Templates (Swing JmsTemplateListModel + /connectors/jms/templates) ----
   ActiveMQ + JBoss are predefined/read-only; user templates persist server-side.
   A template carries ONLY the connection fields (JNDI + factory class + the
   connection-properties map); Load leaves credentials/destination untouched,
   matching JmsConnectorPanel.loadTemplateButtonActionPerformed. */
const TEMPLATE_CLASS = 'com.mirth.connect.connectors.jms.JmsConnectorProperties';
const PREDEFINED_TEMPLATES = {
    'ActiveMQ': {
        useJndi: false, jndiProviderUrl: '', jndiInitialContextFactory: '', jndiConnectionFactoryName: '',
        connectionFactoryClass: 'org.apache.activemq.ActiveMQConnectionFactory',
        connectionProperties: writeMapEntries({ '@class': 'linked-hash-map' }, [
            ['brokerURL', 'failover:(tcp://localhost:61616)?maxReconnectAttempts=0'],
            ['closeTimeout', '15000'],
            ['useCompression', 'no']
        ], 'string')
    },
    'JBoss Messaging / MQ': {
        useJndi: true,
        jndiProviderUrl: 'jnp://localhost:1099',
        jndiInitialContextFactory: 'org.jnp.interfaces.NamingContextFactory',
        jndiConnectionFactoryName: 'java:/ConnectionFactory',
        connectionFactoryClass: '',
        connectionProperties: { '@class': 'linked-hash-map' }
    }
};
const PREDEFINED_NAMES = Object.keys(PREDEFINED_TEMPLATES);
const isPredefined = (name) => Object.prototype.hasOwnProperty.call(PREDEFINED_TEMPLATES, name);
const cloneMap = (m) => (m && typeof m === 'object' ? JSON.parse(JSON.stringify(m)) : { '@class': 'linked-hash-map' });

/* Server templates fetched once and cached for the editor's lifetime; the cache
   is invalidated on save/delete so the dropdown reflects the change. */
let templatesPromise = null;
function loadServerTemplates() {
    if (!templatesPromise) {
        templatesPromise = api.get('/connectors/jms/templates')
            .then((list) => (list && typeof list === 'object' && !Array.isArray(list) ? list : {}))
            .catch(() => ({}));   // servlet absent / unreachable -> predefined only
    }
    return templatesPromise;
}

/* "Connection Templates" control: a template dropdown + Load / Save / Delete. */
function connectionTemplatesField() {
    let selected = '';          // persists across form repaints (field built once)
    let serverTemplates = {};
    return {
        label: 'Connection Template', type: 'custom', span: true,
        render: (p, ctx) => {
            const wrap = h('div', { class: 'flex items-center gap-1.5 flex-wrap' });
            const names = () => [...PREDEFINED_NAMES, ...Object.keys(serverTemplates).filter((n) => !isPredefined(n))];
            const templateFor = (name) => (isPredefined(name) ? PREDEFINED_TEMPLATES[name] : serverTemplates[name]);

            function paint() {
                clear(wrap);
                const sel = select(
                    [{ value: '', label: '— Select a template —' }, ...names().map((n) => ({ value: n, label: n }))],
                    selected, { onChange: (e) => { selected = e.target.value; paint(); } });
                sel.style.width = '240px';
                wrap.append(
                    sel,
                    h('button.btn', { type: 'button', disabled: !selected, onClick: applyTemplate }, 'Load'),
                    h('button.btn', { type: 'button', onClick: saveTemplate }, 'Save'),
                    h('button.btn', { type: 'button', disabled: !selected || isPredefined(selected), onClick: deleteTemplate }, icon('x'), 'Delete'));
            }

            function applyTemplate() {
                const tpl = templateFor(selected);
                if (!tpl) { toast('That template no longer exists on the server.', 'warn'); return; }
                p.useJndi = asBool(tpl.useJndi);
                p.jndiProviderUrl = String(tpl.jndiProviderUrl ?? '');
                p.jndiInitialContextFactory = String(tpl.jndiInitialContextFactory ?? '');
                p.jndiConnectionFactoryName = String(tpl.jndiConnectionFactoryName ?? '');
                p.connectionFactoryClass = String(tpl.connectionFactoryClass ?? '');
                p.connectionProperties = cloneMap(tpl.connectionProperties);
                ctx.onChange();
                ctx.repaint();   // re-render the form so the loaded fields + map show
            }

            async function saveTemplate() {
                const raw = await promptDialog('Save Connection Template', 'Template name', selected && !isPredefined(selected) ? selected : '');
                const name = raw ? raw.trim() : '';
                if (!name) return;
                if (isPredefined(name)) { toast(`"${name}" is a reserved template and cannot be overwritten.`, 'warn'); return; }
                const body = {
                    useJndi: asBool(p.useJndi),
                    jndiProviderUrl: p.jndiProviderUrl ?? '',
                    jndiInitialContextFactory: p.jndiInitialContextFactory ?? '',
                    jndiConnectionFactoryName: p.jndiConnectionFactoryName ?? '',
                    connectionFactoryClass: p.connectionFactoryClass ?? '',
                    connectionProperties: cloneMap(p.connectionProperties)
                };
                try {
                    await api.put(`/connectors/jms/templates/${encodeURIComponent(name)}`, body, { wrapKey: TEMPLATE_CLASS });
                    templatesPromise = null;
                    serverTemplates = await loadServerTemplates();
                    selected = name;
                    paint();
                    toast('Connection template saved');
                } catch (e) { toast(apiErrorMessage(e), 'error'); }
            }

            async function deleteTemplate() {
                if (!selected || isPredefined(selected)) return;
                if (!(await confirmDialog('Delete Template', `Delete the connection template "${selected}"?`, { danger: true, okLabel: 'Delete' }))) return;
                try {
                    await api.del(`/connectors/jms/templates/${encodeURIComponent(selected)}`);
                    templatesPromise = null;
                    serverTemplates = await loadServerTemplates();
                    selected = '';
                    paint();
                } catch (e) { toast(apiErrorMessage(e), 'error'); }
            }

            paint();
            loadServerTemplates().then((list) => { serverTemplates = list; paint(); });
            return wrap;
        }
    };
}

/* Connection fields shared by listener and sender. */
function jmsConnectionFields() {
    return [
        { section: 'Connection Settings' },
        connectionTemplatesField(),
        { key: 'useJndi', label: 'Use JNDI', type: 'radio', options: YES_NO, refresh: true },
        { key: 'jndiProviderUrl', label: 'Provider URL', type: 'text', width: '420px', disabled: (p) => !usingJndi(p) },
        { key: 'jndiInitialContextFactory', label: 'Initial Context Factory', type: 'text', width: '420px', disabled: (p) => !usingJndi(p) },
        { key: 'jndiConnectionFactoryName', label: 'Connection Factory Name', type: 'text', width: '320px', disabled: (p) => !usingJndi(p) },
        { key: 'connectionFactoryClass', label: 'Connection Factory Class', type: 'text', width: '420px', disabled: usingJndi },
        { key: 'connectionProperties', label: 'Connection Properties', type: 'keyvalue' },
        { key: 'username', label: 'Username', type: 'text', width: '220px' },
        { key: 'password', label: 'Password', type: 'password', width: '220px' }
    ];
}

const jmsListener = {
    defaults(version) {
        return Object.assign({
            '@class': 'com.mirth.connect.connectors.jms.JmsReceiverProperties',
            '@version': version,
            pluginProperties: null,
            sourceConnectorProperties: defaultSourceProperties(version),
            selector: '',
            reconnectIntervalMillis: '10000',
            durableTopic: false
        }, jmsConnectorDefaults());
    },
    component({ properties, onChange }) {
        return (
            <ConnectorForm properties={properties} onChange={onChange} fields={[
                ...jmsConnectionFields(),
                { section: 'Destination Settings' },
                {
                    // Swing renders durableTopicCheckbox as a MirthCheckBox appended INLINE onto the
                    // Destination Type radio row (Queue / Topic / [x] Durable, one line). Mirror that
                    // with an append checkbox rather than a separate radio row. Same setEnabled gating:
                    // durable enabled only when Topic is selected (destinationTypeTopicActionPerformed
                    // enables it for the listener; destinationTypeQueueActionPerformed disables it).
                    key: 'topic', label: 'Destination Type', type: 'radio', refresh: true,
                    options: [
                        { value: false, label: 'Queue' },
                        { value: true, label: 'Topic' }
                    ],
                    append: (p, ctx) => checkbox('Durable', asBool(p.durableTopic), {
                        disabled: !asBool(p.topic),
                        onChange: (e) => { p.durableTopic = e.target.checked; ctx.onChange(); ctx.repaint(); }
                    }).el
                },
                { key: 'destinationName', label: 'Destination Name', type: 'text', width: '320px' },
                { key: 'clientId', label: 'Client ID', type: 'text', width: '220px' },
                { key: 'reconnectIntervalMillis', label: 'Reconnect Interval (ms)', type: 'number', width: '120px' },
                { key: 'selector', label: 'Selector', type: 'text', width: '320px' }
            ]} />
        );
    }
};

const jmsSender = {
    defaults(version) {
        return Object.assign({
            '@class': 'com.mirth.connect.connectors.jms.JmsDispatcherProperties',
            '@version': version,
            pluginProperties: null,
            destinationConnectorProperties: defaultDestinationProperties(version),
            template: '${message.encodedData}'
        }, jmsConnectorDefaults());
    },
    component({ properties, onChange }) {
        return (
            <ConnectorForm properties={properties} onChange={onChange} fields={[
                ...jmsConnectionFields(),
                { section: 'Destination Settings' },
                { key: 'topic', label: 'Destination Type', type: 'radio', disabled: usingJndi, options: [
                    { value: false, label: 'Queue' },
                    { value: true, label: 'Topic' }
                ] },
                { key: 'destinationName', label: 'Destination Name', type: 'text', width: '320px' },
                { key: 'clientId', label: 'Client ID', type: 'text', width: '220px' },
                { section: 'Template' },
                { key: 'template', label: 'Template', type: 'code', minHeight: '140px' }
            ]} />
        );
    }
};

export function register(platform) {
    platform.registerConnectorPanel('JMS Listener', 'SOURCE', jmsListener);
    platform.registerConnectorPanel('JMS Sender', 'DESTINATION', jmsSender);
}
