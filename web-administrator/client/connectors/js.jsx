/*
 * JavaScript Reader (JavaScriptReceiverProperties) / JavaScript Writer (JavaScriptDispatcherProperties).
 *
 * React port: def.render(host, ctx) -> def.component(ctx) => JSX. Field schemas
 * and defaults reused VERBATIM; the polling section is the React <PollSection>.
 */

import { React } from './react-platform.js';
import {
    ConnectorForm, PollSection,
    defaultSourceProperties, defaultDestinationProperties, defaultPollProperties, requireFields
} from './react-forms.js';

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
    component({ properties, onChange }) {
        return (
            <div>
                <PollSection properties={properties} onChange={onChange} />
                <ConnectorForm properties={properties} onChange={onChange} fields={[
                    { section: 'JavaScript Reader Settings' },
                    {
                        key: 'script', label: 'JavaScript', type: 'code', language: 'javascript', minHeight: '260px',
                        placeholder: '// Return one or more messages to be processed'
                    }
                ]} />
            </div>
        );
    },
    // Swing JavaScriptReader.checkProperties: script must not be empty.
    validate(properties) {
        return requireFields(properties, [
            { key: 'script', label: 'JavaScript' }
        ]);
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
    component({ properties, onChange }) {
        return (
            <ConnectorForm properties={properties} onChange={onChange} fields={[
                { section: 'JavaScript Writer Settings' },
                {
                    key: 'script', label: 'JavaScript', type: 'code', language: 'javascript', minHeight: '300px',
                    placeholder: '// Write your script here. Return a Response or a status to set the message status.'
                }
            ]} />
        );
    },
    // Swing JavaScriptWriter.checkProperties: script must not be empty.
    validate(properties) {
        return requireFields(properties, [
            { key: 'script', label: 'JavaScript' }
        ]);
    }
};

export function register(platform) {
    platform.registerConnectorPanel('JavaScript Reader', 'SOURCE', javascriptReader);
    platform.registerConnectorPanel('JavaScript Writer', 'DESTINATION', javascriptWriter);
}
