// plugins/datatype-delimited/web/plugin.tsx
import { scope } from "@oie/web-ui";
import { platform } from "@oie/web-shell";
var { t } = scope("datatype-delimited");
var React = platform.React;
var PKG = "com.mirth.connect.plugins.datatypes.delimited";
var text = (key, label, def, hint) => ({ key, label, type: "text", default: def, hint });
var num = (key, label, def, hint) => ({ key, label, type: "number", default: def, hint });
var bool = (key, label, def, hint) => ({ key, label, type: "checkbox", default: def, hint });
var opt = (key, label, options, def, hint) => ({ key, label, type: "select", options, default: def, hint });
var code = (key, label, def, hint) => ({ key, label, type: "code", default: def, hint });
var list = (key, label, item, hint) => ({ key, label, type: "list", item, xmlNames: item === "string", hint });
var BATCH_SCRIPT_HINT = t("JavaScript that splits the batch and returns the next message. Has access to ''reader'' (a Java BufferedReader); return null/empty to signal end of input. Only used when Process Batch is enabled in the connector.");
var DEF = {
  name: "DELIMITED",
  label: t("Delimited Text"),
  order: 60,
  propertiesClass: `${PKG}.DelimitedDataTypeProperties`,
  groups: [
    {
      key: "serializationProperties",
      label: t("Serialization"),
      class: `${PKG}.DelimitedSerializationProperties`,
      fields: [
        text("columnDelimiter", t("Column Delimiter"), ",", t("Character(s) that separate columns (e.g. a comma in a CSV file).")),
        text("recordDelimiter", t("Record Delimiter"), "\\n", t("Character(s) that separate each record (e.g. a newline in a CSV file).")),
        list("columnWidths", t("Column Widths"), "int", t("Comma separated positive integer column widths; leave blank for delimited columns.")),
        text("quoteToken", t("Quote Token"), '"', t("Quote character(s) used to bracket values containing embedded special characters.")),
        bool("escapeWithDoubleQuote", t("Double Quote Escaping"), true, t("Two consecutive quote tokens are an embedded quote token; uncheck to use the Escape Token instead.")),
        text("quoteEscapeToken", t("Escape Token"), "\\", t("Character(s) used to escape embedded quote tokens (only when Double Quote Escaping is unchecked).")),
        list("columnNames", t("Column Names"), "string", t("Comma separated XML column names overriding the defaults (column1\u2026columnN).")),
        bool("numberedRows", t("Numbered Rows"), false, t("Number each row in the XML representation of the message.")),
        bool("ignoreCR", t("Ignore Carriage Returns"), true, t("Carriage return (\\r) characters are skipped without processing."))
      ]
    },
    {
      key: "deserializationProperties",
      label: t("Deserialization"),
      class: `${PKG}.DelimitedDeserializationProperties`,
      fields: [
        text("columnDelimiter", t("Column Delimiter"), ",", t("Character(s) that separate columns (e.g. a comma in a CSV file).")),
        text("recordDelimiter", t("Record Delimiter"), "\\n", t("Character(s) that separate each record (e.g. a newline in a CSV file).")),
        list("columnWidths", t("Column Widths"), "int", t("Comma separated positive integer column widths; leave blank for delimited columns.")),
        text("quoteToken", t("Quote Token"), '"', t("Quote character(s) used to bracket values containing embedded special characters.")),
        bool("escapeWithDoubleQuote", t("Double Quote Escaping"), true, t("Two consecutive quote tokens are an embedded quote token; uncheck to use the Escape Token instead.")),
        text("quoteEscapeToken", t("Escape Token"), "\\", t("Character(s) used to escape embedded quote tokens (only when Double Quote Escaping is unchecked)."))
      ]
    },
    {
      key: "batchProperties",
      label: t("Batch"),
      class: `${PKG}.DelimitedBatchProperties`,
      fields: [
        opt("splitType", t("Split Batch By"), [
          { value: "Record", label: t("Record") },
          { value: "Delimiter", label: t("Delimiter") },
          { value: "Grouping_Column", label: t("Grouping Column") },
          { value: "JavaScript", label: t("JavaScript") }
        ], "Record", t("Method for splitting the batch message. Only used when Process Batch is enabled in the connector.")),
        num("batchSkipRecords", t("Number of Header Records"), 0, t("Number of header records to skip.")),
        text("batchMessageDelimiter", t("Batch Delimiter"), null, t("Delimiter (character sequence) that separates messages.")),
        bool("batchMessageDelimiterIncluded", t("Include Batch Delimiter"), false, t("Include the batch delimiter in the message returned by the batch processor.")),
        text("batchGroupingColumn", t("Grouping Column"), null, t("Column used to group records; a change in its value marks a message boundary.")),
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
