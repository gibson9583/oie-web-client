/*
 * XML data type — web admin plugin (React, DataTypeClientPlugin equivalent).
 * Field/default shapes transcribed from the engine plugin
 * (server/.../plugins/datatypes/xml/*Properties.java).
 *
 * Contributes a DATA definition only (schema + defaults()); the shared React
 * properties editor (client/datatypes/props-editor.jsx) renders the groups, so
 * there is no JSX here. Authored as .jsx under the React plugin contract,
 * sharing the host's single React instance via platform.React.
 */

import { platform } from '@oie/web-shell';
const React = platform.React;

const PKG = 'com.mirth.connect.plugins.datatypes.xml';

const text = (key, label, def, hint) => ({ key, label, type: 'text', default: def, hint });
const num = (key, label, def, hint) => ({ key, label, type: 'number', default: def, hint });
const bool = (key, label, def, hint) => ({ key, label, type: 'checkbox', default: def, hint });
const opt = (key, label, options, def, hint) => ({ key, label, type: 'select', options, default: def, hint });
const code = (key, label, def, hint) => ({ key, label, type: 'code', default: def, hint });

const BATCH_SCRIPT_HINT = 'JavaScript that splits the batch and returns the next message. ' +
    "Has access to 'reader' (a Java BufferedReader); return null/empty to signal end of input. " +
    'Only used when Process Batch is enabled in the connector.';

const DEF = {
    name: 'XML', label: 'XML', order: 30,
    propertiesClass: `${PKG}.XMLDataTypeProperties`,
    groups: [
        {
            key: 'serializationProperties', label: 'Serialization',
            class: `${PKG}.XMLSerializationProperties`,
            fields: [
                bool('stripNamespaces', 'Strip Namespaces', false, 'Strip namespace definitions from the transformed XML message (prefixes are not removed).')
            ]
        },
        {
            key: 'batchProperties', label: 'Batch', class: `${PKG}.XMLBatchProperties`,
            fields: [
                opt('splitType', 'Split Batch By', [
                    { value: 'Element_Name', label: 'Element Name' },
                    { value: 'Level', label: 'Level' },
                    { value: 'XPath_Query', label: 'XPath Query' },
                    { value: 'JavaScript', label: 'JavaScript' }
                ], 'Element_Name', 'Method for splitting the batch message. Only used when Process Batch is enabled in the connector.'),
                text('elementName', 'Element Name', null, 'Each element with this name is split into its own message.'),
                num('level', 'Level', 1, 'Each element at this level is split into its own message (root element is level 0).'),
                text('query', 'XPath Query', null, 'Each element found with the XPath query is split into its own message.'),
                code('batchScript', 'JavaScript', null, BATCH_SCRIPT_HINT)
            ]
        }
    ]
};

DEF.defaults = (version) => {
    const props = { '@class': DEF.propertiesClass, '@version': version };
    for (const group of DEF.groups) {
        const obj = { '@class': group.class, '@version': version };
        for (const f of group.fields) obj[f.key] = f.default ?? null;
        props[group.key] = obj;
    }
    return props;
};

export function register(platform) {
    platform.registerDataType(DEF.name, DEF);
}
