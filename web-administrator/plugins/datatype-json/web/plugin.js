/*
 * JSON data type — web admin plugin (DataTypeClientPlugin equivalent).
 * Transcribed from server/.../plugins/datatypes/json/*Properties.java.
 */

const PKG = 'com.mirth.connect.plugins.datatypes.json';

const opt = (key, label, options, def, hint) => ({ key, label, type: 'select', options, default: def, hint });
const code = (key, label, def, hint) => ({ key, label, type: 'code', default: def, hint });

const BATCH_SCRIPT_HINT = 'JavaScript that splits the batch and returns the next message. ' +
    "Has access to 'reader' (a Java BufferedReader); return null/empty to signal end of input. " +
    'Only used when Process Batch is enabled in the connector.';

const DEF = {
    name: 'JSON', label: 'JSON', order: 40,
    propertiesClass: `${PKG}.JSONDataTypeProperties`,
    groups: [
        {
            key: 'batchProperties', label: 'Batch', class: `${PKG}.JSONBatchProperties`,
            fields: [
                opt('splitType', 'Split Batch By', [{ value: 'JavaScript', label: 'JavaScript' }], 'JavaScript',
                    'Method for splitting the batch message. Only used when Process Batch is enabled in the connector.'),
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
