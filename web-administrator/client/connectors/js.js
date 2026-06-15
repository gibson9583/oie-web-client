/*
 * JavaScript Reader (JavaScriptReceiverProperties) / JavaScript Writer (JavaScriptDispatcherProperties).
 */

import { h } from '../core/ui.js';
import { buildForm, pollSection, defaultSourceProperties, defaultDestinationProperties, defaultPollProperties } from './forms.js';

const javascriptReader = {
    defaults(version) {
        return {
            '@class': 'com.mirth.connect.connectors.js.JavaScriptReceiverProperties',
            '@version': version,
            pluginProperties: null,
            pollConnectorProperties: defaultPollProperties(version),
            sourceConnectorProperties: defaultSourceProperties(version),
            script: ''
        };
    },
    render(host, { properties, onChange }) {
        const formHost = h('div');
        host.appendChild(formHost);
        buildForm(formHost, properties, [
            { section: 'JavaScript Reader Settings' },
            {
                key: 'script', label: 'JavaScript', type: 'code', language: 'javascript', minHeight: '260px',
                placeholder: '// Return one or more messages to be processed'
            }
        ], onChange);
        host.appendChild(pollSection(properties, onChange));
    }
};

const javascriptWriter = {
    defaults(version) {
        return {
            '@class': 'com.mirth.connect.connectors.js.JavaScriptDispatcherProperties',
            '@version': version,
            pluginProperties: null,
            destinationConnectorProperties: defaultDestinationProperties(version),
            script: ''
        };
    },
    render(host, { properties, onChange }) {
        const formHost = h('div');
        host.appendChild(formHost);
        buildForm(formHost, properties, [
            { section: 'JavaScript Writer Settings' },
            {
                key: 'script', label: 'JavaScript', type: 'code', language: 'javascript', minHeight: '300px',
                placeholder: '// Write your script here. Return a Response or a status to set the message status.'
            }
        ], onChange);
    }
};

export function register(platform) {
    platform.registerConnectorPanel('JavaScript Reader', 'SOURCE', javascriptReader);
    platform.registerConnectorPanel('JavaScript Writer', 'DESTINATION', javascriptWriter);
}
