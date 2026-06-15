/*
 * Delimited Text data type — web admin plugin (DataTypeClientPlugin equivalent).
 * Transcribed from server/.../plugins/datatypes/delimited/*Properties.java.
 */

const PKG = 'com.mirth.connect.plugins.datatypes.delimited';

const text = (key, label, def, hint) => ({ key, label, type: 'text', default: def, hint });
const num = (key, label, def, hint) => ({ key, label, type: 'number', default: def, hint });
const bool = (key, label, def, hint) => ({ key, label, type: 'checkbox', default: def, hint });
const opt = (key, label, options, def, hint) => ({ key, label, type: 'select', options, default: def, hint });
const code = (key, label, def, hint) => ({ key, label, type: 'code', default: def, hint });

const BATCH_SCRIPT_HINT = 'JavaScript that splits the batch and returns the next message. ' +
    "Has access to 'reader' (a Java BufferedReader); return null/empty to signal end of input. " +
    'Only used when Process Batch is enabled in the connector.';

const DEF = {
    name: 'DELIMITED', label: 'Delimited Text', order: 60,
    propertiesClass: `${PKG}.DelimitedDataTypeProperties`,
    groups: [
        {
            key: 'serializationProperties', label: 'Serialization',
            class: `${PKG}.DelimitedSerializationProperties`,
            fields: [
                text('columnDelimiter', 'Column Delimiter', ',', 'Character(s) that separate columns (e.g. a comma in a CSV file).'),
                text('recordDelimiter', 'Record Delimiter', '\\n', 'Character(s) that separate each record (e.g. a newline in a CSV file).'),
                text('columnWidths', 'Column Widths', null, 'Comma separated list of fixed column widths; leave blank for delimited columns.'),
                text('quoteToken', 'Quote Token', '"', 'Quote character(s) used to bracket values containing embedded special characters.'),
                bool('escapeWithDoubleQuote', 'Double Quote Escaping', true, 'Two consecutive quote tokens are an embedded quote token; uncheck to use the Escape Token instead.'),
                text('quoteEscapeToken', 'Escape Token', '\\', 'Character(s) used to escape embedded quote tokens (only when Double Quote Escaping is unchecked).'),
                text('columnNames', 'Column Names', null, 'Comma separated list overriding the default column names (column1…columnN).'),
                bool('numberedRows', 'Numbered Rows', false, 'Number each row in the XML representation of the message.'),
                bool('ignoreCR', 'Ignore Carriage Returns', true, 'Carriage return (\\r) characters are skipped without processing.')
            ]
        },
        {
            key: 'deserializationProperties', label: 'Deserialization',
            class: `${PKG}.DelimitedDeserializationProperties`,
            fields: [
                text('columnDelimiter', 'Column Delimiter', ',', 'Character(s) that separate columns (e.g. a comma in a CSV file).'),
                text('recordDelimiter', 'Record Delimiter', '\\n', 'Character(s) that separate each record (e.g. a newline in a CSV file).'),
                text('columnWidths', 'Column Widths', null, 'Comma separated list of fixed column widths; leave blank for delimited columns.'),
                text('quoteToken', 'Quote Token', '"', 'Quote character(s) used to bracket values containing embedded special characters.'),
                bool('escapeWithDoubleQuote', 'Double Quote Escaping', true, 'Two consecutive quote tokens are an embedded quote token; uncheck to use the Escape Token instead.'),
                text('quoteEscapeToken', 'Escape Token', '\\', 'Character(s) used to escape embedded quote tokens (only when Double Quote Escaping is unchecked).')
            ]
        },
        {
            key: 'batchProperties', label: 'Batch', class: `${PKG}.DelimitedBatchProperties`,
            fields: [
                opt('splitType', 'Split Batch By', [
                    { value: 'Record', label: 'Record' },
                    { value: 'Delimiter', label: 'Delimiter' },
                    { value: 'Grouping_Column', label: 'Grouping Column' },
                    { value: 'JavaScript', label: 'JavaScript' }
                ], 'Record', 'Method for splitting the batch message. Only used when Process Batch is enabled in the connector.'),
                num('batchSkipRecords', 'Number of Header Records', 0, 'Number of header records to skip.'),
                text('batchMessageDelimiter', 'Batch Delimiter', null, 'Delimiter (character sequence) that separates messages.'),
                bool('batchMessageDelimiterIncluded', 'Include Batch Delimiter', false, 'Include the batch delimiter in the message returned by the batch processor.'),
                text('batchGroupingColumn', 'Grouping Column', null, 'Column used to group records; a change in its value marks a message boundary.'),
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
