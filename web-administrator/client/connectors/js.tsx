import { t as translate } from '../core/i18n.js';
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
    defaults(version: any) {
        return {
            '@class': 'com.mirth.connect.connectors.js.JavaScriptReceiverProperties',
            '@version': version,
            pluginProperties: null,
            pollConnectorProperties: defaultPollProperties(version),
            sourceConnectorProperties: defaultSourceProperties(version),
            script: ''
        };
    },
    component({ properties, onChange }: any) {
        return (
            <div>
                <PollSection properties={properties} onChange={onChange} />
                <ConnectorForm properties={properties} onChange={onChange} fields={[
                    { section: translate("JavaScript Reader Settings") },
                    {
                        key: 'script', label: translate("JavaScript"), type: 'code', language: 'javascript', minHeight: '260px',
                        placeholder: translate("// Return one or more messages to be processed")
                    }
                ]} />
            </div>
        );
    },
    // Swing JavaScriptReader.checkProperties: script must not be empty.
    validate(properties: any) {
        return requireFields(properties, [
            { key: 'script', label: translate("JavaScript") }
        ]);
    }
};

const javascriptWriter = {
    defaults(version: any) {
        return {
            '@class': 'com.mirth.connect.connectors.js.JavaScriptDispatcherProperties',
            '@version': version,
            pluginProperties: null,
            destinationConnectorProperties: defaultDestinationProperties(version),
            script: ''
        };
    },
    component({ properties, onChange }: any) {
        return (
            <ConnectorForm properties={properties} onChange={onChange} fields={[
                { section: translate("JavaScript Writer Settings") },
                {
                    key: 'script', label: translate("JavaScript"), type: 'code', language: 'javascript', minHeight: '300px',
                    placeholder: translate("// Write your script here. Return a Response or a status to set the message status.")
                }
            ]} />
        );
    },
    // Swing JavaScriptWriter.checkProperties: script must not be empty.
    validate(properties: any) {
        return requireFields(properties, [
            { key: 'script', label: translate("JavaScript") }
        ]);
    }
};

export function register(platform: any) {
    platform.registerConnectorPanel('JavaScript Reader', 'SOURCE', javascriptReader);
    platform.registerConnectorPanel('JavaScript Writer', 'DESTINATION', javascriptWriter);
}
