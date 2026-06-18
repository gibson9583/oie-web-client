/*
 * JMS Listener (JmsReceiverProperties) / JMS Sender (JmsDispatcherProperties).
 * Field names and defaults mirror server/src/com/mirth/connect/connectors/jms
 * (both extend JmsConnectorProperties).
 *
 * React port: def.render(host, ctx) -> def.component(ctx) => JSX. The shared
 * connection-field schema and defaults are reused VERBATIM.
 */

import { React } from './react-platform.js';
import {
    ConnectorForm, asBool, YES_NO,
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

const useJndi = (p) => asBool(p.useJndi);

/* Connection fields shared by listener and sender. */
function jmsConnectionFields() {
    return [
        { section: 'Connection Settings' },
        { key: 'useJndi', label: 'Use JNDI', type: 'radio', options: YES_NO, refresh: true },
        { key: 'jndiProviderUrl', label: 'Provider URL', type: 'text', width: '420px', visible: useJndi },
        { key: 'jndiInitialContextFactory', label: 'Initial Context Factory', type: 'text', width: '420px', visible: useJndi },
        { key: 'jndiConnectionFactoryName', label: 'Connection Factory Name', type: 'text', width: '320px', visible: useJndi },
        { key: 'connectionFactoryClass', label: 'Connection Factory Class', type: 'text', width: '420px', visible: (p) => !useJndi(p) },
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
                { key: 'destinationName', label: 'Destination Name', type: 'text', width: '320px' },
                { key: 'topic', label: 'Destination Type', type: 'radio', refresh: true, visible: (p) => !useJndi(p), options: [
                    { value: false, label: 'Queue' },
                    { value: true, label: 'Topic' }
                ] },
                { key: 'durableTopic', label: 'Durable Topic', type: 'radio', options: YES_NO, visible: (p) => !useJndi(p) && asBool(p.topic) },
                { key: 'clientId', label: 'Client ID', type: 'text', width: '220px' },
                { key: 'selector', label: 'Selector Expression', type: 'text', width: '320px' },
                { key: 'reconnectIntervalMillis', label: 'Reconnect Interval (ms)', type: 'number', width: '120px' }
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
                { key: 'destinationName', label: 'Destination Name', type: 'text', width: '320px' },
                { key: 'topic', label: 'Destination Type', type: 'radio', visible: (p) => !useJndi(p), options: [
                    { value: false, label: 'Queue' },
                    { value: true, label: 'Topic' }
                ] },
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
