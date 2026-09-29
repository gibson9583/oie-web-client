import { scope as i18nScope } from "@oie/web-ui";
const { t: translate } = i18nScope("datatype-delimited");
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

const BATCH_SCRIPT_HINT = translate("JavaScript that splits the batch and returns the next message. Has access to ''reader'' (a Java BufferedReader); return null/empty to signal end of input. Only used when Process Batch is enabled in the connector.");

const DEF: any = {
    name: 'DELIMITED', label: translate("Delimited Text"), order: 60,
    propertiesClass: `${PKG}.DelimitedDataTypeProperties`,
    groups: [
        {
            key: 'serializationProperties', label: translate("Serialization"),
            class: `${PKG}.DelimitedSerializationProperties`,
            fields: [
                text('columnDelimiter', translate("Column Delimiter"), ',', translate("Character(s) that separate columns (e.g. a comma in a CSV file).")),
                text('recordDelimiter', translate("Record Delimiter"), '\\n', translate("Character(s) that separate each record (e.g. a newline in a CSV file).")),
                list('columnWidths', translate("Column Widths"), 'int', translate("Comma separated positive integer column widths; leave blank for delimited columns.")),
                text('quoteToken', translate("Quote Token"), '"', translate("Quote character(s) used to bracket values containing embedded special characters.")),
                bool('escapeWithDoubleQuote', translate("Double Quote Escaping"), true, translate("Two consecutive quote tokens are an embedded quote token; uncheck to use the Escape Token instead.")),
                text('quoteEscapeToken', translate("Escape Token"), '\\', translate("Character(s) used to escape embedded quote tokens (only when Double Quote Escaping is unchecked).")),
                list('columnNames', translate("Column Names"), 'string', translate("Comma separated XML column names overriding the defaults (column1…columnN).")),
                bool('numberedRows', translate("Numbered Rows"), false, translate("Number each row in the XML representation of the message.")),
                bool('ignoreCR', translate("Ignore Carriage Returns"), true, translate("Carriage return (\\r) characters are skipped without processing."))
            ]
        },
        {
            key: 'deserializationProperties', label: translate("Deserialization"),
            class: `${PKG}.DelimitedDeserializationProperties`,
            fields: [
                text('columnDelimiter', translate("Column Delimiter"), ',', translate("Character(s) that separate columns (e.g. a comma in a CSV file).")),
                text('recordDelimiter', translate("Record Delimiter"), '\\n', translate("Character(s) that separate each record (e.g. a newline in a CSV file).")),
                list('columnWidths', translate("Column Widths"), 'int', translate("Comma separated positive integer column widths; leave blank for delimited columns.")),
                text('quoteToken', translate("Quote Token"), '"', translate("Quote character(s) used to bracket values containing embedded special characters.")),
                bool('escapeWithDoubleQuote', translate("Double Quote Escaping"), true, translate("Two consecutive quote tokens are an embedded quote token; uncheck to use the Escape Token instead.")),
                text('quoteEscapeToken', translate("Escape Token"), '\\', translate("Character(s) used to escape embedded quote tokens (only when Double Quote Escaping is unchecked)."))
            ]
        },
        {
            key: 'batchProperties', label: translate("Batch"), class: `${PKG}.DelimitedBatchProperties`,
            fields: [
                opt('splitType', translate("Split Batch By"), [
                    { value: 'Record', label: translate("Record") },
                    { value: 'Delimiter', label: translate("Delimiter") },
                    { value: 'Grouping_Column', label: translate("Grouping Column") },
                    { value: 'JavaScript', label: translate("JavaScript") }
                ], 'Record', translate("Method for splitting the batch message. Only used when Process Batch is enabled in the connector.")),
                num('batchSkipRecords', translate("Number of Header Records"), 0, translate("Number of header records to skip.")),
                text('batchMessageDelimiter', translate("Batch Delimiter"), null, translate("Delimiter (character sequence) that separates messages.")),
                bool('batchMessageDelimiterIncluded', translate("Include Batch Delimiter"), false, translate("Include the batch delimiter in the message returned by the batch processor.")),
                text('batchGroupingColumn', translate("Grouping Column"), null, translate("Column used to group records; a change in its value marks a message boundary.")),
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
