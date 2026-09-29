import { scope as i18nScope } from '@oie/web-ui';
const { t: translate } = i18nScope("datatype-xml");
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
import type { Platform } from '@oie/web-shell';
const React = platform.React;

const PKG = 'com.mirth.connect.plugins.datatypes.xml';

const text = (key: any, label: any, def: any, hint?: any) => ({ key, label, type: 'text', default: def, hint });
const num = (key: any, label: any, def: any, hint?: any) => ({ key, label, type: 'number', default: def, hint });
const bool = (key: any, label: any, def: any, hint?: any) => ({ key, label, type: 'checkbox', default: def, hint });
const opt = (key: any, label: any, options: any, def: any, hint?: any) => ({ key, label, type: 'select', options, default: def, hint });
const code = (key: any, label: any, def: any, hint?: any) => ({ key, label, type: 'code', default: def, hint });

const BATCH_SCRIPT_HINT = translate("JavaScript that splits the batch and returns the next message. Has access to ''reader'' (a Java BufferedReader); return null/empty to signal end of input. Only used when Process Batch is enabled in the connector.");

const DEF: any = {
    name: 'XML', label: translate("XML"), order: 30,
    propertiesClass: `${PKG}.XMLDataTypeProperties`,
    groups: [
        {
            key: 'serializationProperties', label: translate("Serialization"),
            class: `${PKG}.XMLSerializationProperties`,
            fields: [
                bool('stripNamespaces', translate("Strip Namespaces"), false, translate("Strip namespace definitions from the transformed XML message (prefixes are not removed)."))
            ]
        },
        {
            key: 'batchProperties', label: translate("Batch"), class: `${PKG}.XMLBatchProperties`,
            fields: [
                opt('splitType', translate("Split Batch By"), [
                    { value: 'Element_Name', label: translate("Element Name") },
                    { value: 'Level', label: translate("Level") },
                    { value: 'XPath_Query', label: translate("XPath Query") },
                    { value: 'JavaScript', label: translate("JavaScript") }
                ], 'Element_Name', translate("Method for splitting the batch message. Only used when Process Batch is enabled in the connector.")),
                text('elementName', translate("Element Name"), null, translate("Each element with this name is split into its own message.")),
                num('level', translate("Level"), 1, translate("Each element at this level is split into its own message (root element is level 0).")),
                text('query', translate("XPath Query"), null, translate("Each element found with the XPath query is split into its own message.")),
                code('batchScript', 'JavaScript', null, BATCH_SCRIPT_HINT)
            ]
        }
    ]
};

DEF.defaults = (version: any) => {
    const props: any = { '@class': DEF.propertiesClass, '@version': version };
    for (const group of DEF.groups) {
        const obj: any = { '@class': group.class, '@version': version };
        for (const f of group.fields) obj[f.key] = f.default ?? null;
        props[group.key] = obj;
    }
    return props;
};

export function register(platform: Platform) {
    platform.registerDataType(DEF.name, DEF);
}
