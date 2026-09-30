import { scope } from '@oie/web-ui';
const { t } = scope("datatype-delimited");
/*
 * Delimited Text data type — web admin plugin (React, DataTypeClientPlugin equivalent).
 * Transcribed from server/.../plugins/datatypes/delimited/*Properties.java.
 *
 * Contributes a DATA definition only (schema + defaults()); the shared React
 * properties editor (client/datatypes/props-editor.jsx) renders the groups, so
 * there is no JSX here. Authored as .jsx under the React plugin contract,
 * sharing the host's single React instance via platform.React.
 */

import { platform } from '@oie/web-shell';
import type { Platform } from '@oie/web-shell';
const React = platform.React;

const PKG = 'com.mirth.connect.plugins.datatypes.delimited';

const text = (key: any, label: any, def: any, hint?: any) => ({ key, label, type: 'text', default: def, hint });
const num = (key: any, label: any, def: any, hint?: any) => ({ key, label, type: 'number', default: def, hint });
const bool = (key: any, label: any, def: any, hint?: any) => ({ key, label, type: 'checkbox', default: def, hint });
const opt = (key: any, label: any, options: any, def: any, hint?: any) => ({ key, label, type: 'select', options, default: def, hint });
const code = (key: any, label: any, def: any, hint?: any) => ({ key, label, type: 'code', default: def, hint });
const list = (key: string, label: string, item: 'int' | 'string', hint: string) => ({ key, label, type: 'list', item, xmlNames: item === 'string', hint });

const BATCH_SCRIPT_HINT = t("JavaScript that splits the batch and returns the next message. Has access to ''reader'' (a Java BufferedReader); return null/empty to signal end of input. Only used when Process Batch is enabled in the connector.");

const DEF: any = {
    name: 'DELIMITED', label: t("Delimited Text"), order: 60,
    propertiesClass: `${PKG}.DelimitedDataTypeProperties`,
    groups: [
        {
            key: 'serializationProperties', label: t("Serialization"),
            class: `${PKG}.DelimitedSerializationProperties`,
            fields: [
                text('columnDelimiter', t("Column Delimiter"), ',', t("Character(s) that separate columns (e.g. a comma in a CSV file).")),
                text('recordDelimiter', t("Record Delimiter"), '\\n', t("Character(s) that separate each record (e.g. a newline in a CSV file).")),
                list('columnWidths', t("Column Widths"), 'int', t("Comma separated positive integer column widths; leave blank for delimited columns.")),
                text('quoteToken', t("Quote Token"), '"', t("Quote character(s) used to bracket values containing embedded special characters.")),
                bool('escapeWithDoubleQuote', t("Double Quote Escaping"), true, t("Two consecutive quote tokens are an embedded quote token; uncheck to use the Escape Token instead.")),
                text('quoteEscapeToken', t("Escape Token"), '\\', t("Character(s) used to escape embedded quote tokens (only when Double Quote Escaping is unchecked).")),
                list('columnNames', t("Column Names"), 'string', t("Comma separated XML column names overriding the defaults (column1…columnN).")),
                bool('numberedRows', t("Numbered Rows"), false, t("Number each row in the XML representation of the message.")),
                bool('ignoreCR', t("Ignore Carriage Returns"), true, t("Carriage return (\\r) characters are skipped without processing."))
            ]
        },
        {
            key: 'deserializationProperties', label: t("Deserialization"),
            class: `${PKG}.DelimitedDeserializationProperties`,
            fields: [
                text('columnDelimiter', t("Column Delimiter"), ',', t("Character(s) that separate columns (e.g. a comma in a CSV file).")),
                text('recordDelimiter', t("Record Delimiter"), '\\n', t("Character(s) that separate each record (e.g. a newline in a CSV file).")),
                list('columnWidths', t("Column Widths"), 'int', t("Comma separated positive integer column widths; leave blank for delimited columns.")),
                text('quoteToken', t("Quote Token"), '"', t("Quote character(s) used to bracket values containing embedded special characters.")),
                bool('escapeWithDoubleQuote', t("Double Quote Escaping"), true, t("Two consecutive quote tokens are an embedded quote token; uncheck to use the Escape Token instead.")),
                text('quoteEscapeToken', t("Escape Token"), '\\', t("Character(s) used to escape embedded quote tokens (only when Double Quote Escaping is unchecked)."))
            ]
        },
        {
            key: 'batchProperties', label: t("Batch"), class: `${PKG}.DelimitedBatchProperties`,
            fields: [
                opt('splitType', t("Split Batch By"), [
                    { value: 'Record', label: t("Record") },
                    { value: 'Delimiter', label: t("Delimiter") },
                    { value: 'Grouping_Column', label: t("Grouping Column") },
                    { value: 'JavaScript', label: t("JavaScript") }
                ], 'Record', t("Method for splitting the batch message. Only used when Process Batch is enabled in the connector.")),
                num('batchSkipRecords', t("Number of Header Records"), 0, t("Number of header records to skip.")),
                text('batchMessageDelimiter', t("Batch Delimiter"), null, t("Delimiter (character sequence) that separates messages.")),
                bool('batchMessageDelimiterIncluded', t("Include Batch Delimiter"), false, t("Include the batch delimiter in the message returned by the batch processor.")),
                text('batchGroupingColumn', t("Grouping Column"), null, t("Column used to group records; a change in its value marks a message boundary.")),
                code('batchScript', 'JavaScript', null, BATCH_SCRIPT_HINT)
            ]
        }
    ]
};

DEF.defaults = (version: any) => {
    const props: any = { '@class': DEF.propertiesClass, '@version': version };
    for (const group of DEF.groups) {
        const obj: any = { '@class': group.class, '@version': version };
        for (const f of group.fields) {
            // Java null arrays are omitted. An empty element creates a zero-length
            // widths array, which activates fixed-width mode with zero columns.
            if (f.type !== 'list') obj[f.key] = f.default ?? null;
        }
        props[group.key] = obj;
    }
    return props;
};

export function register(platform: Platform) {
    platform.registerDataType(DEF.name, DEF);
}
