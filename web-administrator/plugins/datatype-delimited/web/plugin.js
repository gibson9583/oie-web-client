// plugins/datatype-delimited/web/plugin.tsx
import { scope as i18nScope } from "@oie/web-ui";
import { platform } from "@oie/web-shell";
var { t: translate } = i18nScope("datatype-delimited");
var React = platform.React;
var PKG = "com.mirth.connect.plugins.datatypes.delimited";
var text = (key, label, def, hint) => ({ key, label, type: "text", default: def, hint });
var num = (key, label, def, hint) => ({ key, label, type: "number", default: def, hint });
var bool = (key, label, def, hint) => ({ key, label, type: "checkbox", default: def, hint });
var opt = (key, label, options, def, hint) => ({ key, label, type: "select", options, default: def, hint });
var code = (key, label, def, hint) => ({ key, label, type: "code", default: def, hint });
var list = (key, label, item, hint) => ({ key, label, type: "list", item, xmlNames: item === "string", hint });
var BATCH_SCRIPT_HINT = translate("JavaScript that splits the batch and returns the next message. Has access to ''reader'' (a Java BufferedReader); return null/empty to signal end of input. Only used when Process Batch is enabled in the connector.");
var DEF = {
  name: "DELIMITED",
  label: translate("Delimited Text"),
  order: 60,
  propertiesClass: `${PKG}.DelimitedDataTypeProperties`,
  groups: [
    {
      key: "serializationProperties",
      label: translate("Serialization"),
      class: `${PKG}.DelimitedSerializationProperties`,
      fields: [
        text("columnDelimiter", translate("Column Delimiter"), ",", translate("Character(s) that separate columns (e.g. a comma in a CSV file).")),
        text("recordDelimiter", translate("Record Delimiter"), "\\n", translate("Character(s) that separate each record (e.g. a newline in a CSV file).")),
        list("columnWidths", translate("Column Widths"), "int", translate("Comma separated positive integer column widths; leave blank for delimited columns.")),
        text("quoteToken", translate("Quote Token"), '"', translate("Quote character(s) used to bracket values containing embedded special characters.")),
        bool("escapeWithDoubleQuote", translate("Double Quote Escaping"), true, translate("Two consecutive quote tokens are an embedded quote token; uncheck to use the Escape Token instead.")),
        text("quoteEscapeToken", translate("Escape Token"), "\\", translate("Character(s) used to escape embedded quote tokens (only when Double Quote Escaping is unchecked).")),
        list("columnNames", translate("Column Names"), "string", translate("Comma separated XML column names overriding the defaults (column1\u2026columnN).")),
        bool("numberedRows", translate("Numbered Rows"), false, translate("Number each row in the XML representation of the message.")),
        bool("ignoreCR", translate("Ignore Carriage Returns"), true, translate("Carriage return (\\r) characters are skipped without processing."))
      ]
    },
    {
      key: "deserializationProperties",
      label: translate("Deserialization"),
      class: `${PKG}.DelimitedDeserializationProperties`,
      fields: [
        text("columnDelimiter", translate("Column Delimiter"), ",", translate("Character(s) that separate columns (e.g. a comma in a CSV file).")),
        text("recordDelimiter", translate("Record Delimiter"), "\\n", translate("Character(s) that separate each record (e.g. a newline in a CSV file).")),
        list("columnWidths", translate("Column Widths"), "int", translate("Comma separated positive integer column widths; leave blank for delimited columns.")),
        text("quoteToken", translate("Quote Token"), '"', translate("Quote character(s) used to bracket values containing embedded special characters.")),
        bool("escapeWithDoubleQuote", translate("Double Quote Escaping"), true, translate("Two consecutive quote tokens are an embedded quote token; uncheck to use the Escape Token instead.")),
        text("quoteEscapeToken", translate("Escape Token"), "\\", translate("Character(s) used to escape embedded quote tokens (only when Double Quote Escaping is unchecked)."))
      ]
    },
    {
      key: "batchProperties",
      label: translate("Batch"),
      class: `${PKG}.DelimitedBatchProperties`,
      fields: [
        opt("splitType", translate("Split Batch By"), [
          { value: "Record", label: translate("Record") },
          { value: "Delimiter", label: translate("Delimiter") },
          { value: "Grouping_Column", label: translate("Grouping Column") },
          { value: "JavaScript", label: translate("JavaScript") }
        ], "Record", translate("Method for splitting the batch message. Only used when Process Batch is enabled in the connector.")),
        num("batchSkipRecords", translate("Number of Header Records"), 0, translate("Number of header records to skip.")),
        text("batchMessageDelimiter", translate("Batch Delimiter"), null, translate("Delimiter (character sequence) that separates messages.")),
        bool("batchMessageDelimiterIncluded", translate("Include Batch Delimiter"), false, translate("Include the batch delimiter in the message returned by the batch processor.")),
        text("batchGroupingColumn", translate("Grouping Column"), null, translate("Column used to group records; a change in its value marks a message boundary.")),
        code("batchScript", "JavaScript", null, BATCH_SCRIPT_HINT)
      ]
    }
  ]
};
DEF.defaults = (version) => {
  const props = { "@class": DEF.propertiesClass, "@version": version };
  for (const group of DEF.groups) {
    const obj = { "@class": group.class, "@version": version };
    for (const f of group.fields) {
      if (f.type !== "list") obj[f.key] = f.default ?? null;
    }
    props[group.key] = obj;
  }
  return props;
};
function register(platform2) {
  platform2.registerDataType(DEF.name, DEF);
}
export {
  register
};
