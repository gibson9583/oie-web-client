// plugins/datatype-ncpdp/web/plugin.tsx
import { scope as i18nScope } from "@oie/web-ui";
import { platform } from "@oie/web-shell";
var { t: translate } = i18nScope("datatype-ncpdp");
var React = platform.React;
var PKG = "com.mirth.connect.plugins.datatypes.ncpdp";
var text = (key, label, def, hint) => ({ key, label, type: "text", default: def, hint });
var bool = (key, label, def, hint) => ({ key, label, type: "checkbox", default: def, hint });
var opt = (key, label, options, def, hint) => ({ key, label, type: "select", options, default: def, hint });
var code = (key, label, def, hint) => ({ key, label, type: "code", default: def, hint });
var BATCH_SCRIPT_HINT = translate("JavaScript that splits the batch and returns the next message. Has access to ''reader'' (a Java BufferedReader); return null/empty to signal end of input. Only used when Process Batch is enabled in the connector.");
var DEF = {
  name: "NCPDP",
  label: translate("NCPDP"),
  order: 80,
  propertiesClass: `${PKG}.NCPDPDataTypeProperties`,
  groups: [
    {
      key: "serializationProperties",
      label: translate("Serialization"),
      class: `${PKG}.NCPDPSerializationProperties`,
      fields: [
        text("fieldDelimiter", translate("Field Delimiter"), "0x1C", translate("Character(s) that delimit the fields in the message.")),
        text("groupDelimiter", translate("Group Delimiter"), "0x1D", translate("Character(s) that delimit the groups in the message.")),
        text("segmentDelimiter", translate("Segment Delimiter"), "0x1E", translate("Character(s) that delimit the segments in the message."))
      ]
    },
    {
      key: "deserializationProperties",
      label: translate("Deserialization"),
      class: `${PKG}.NCPDPDeserializationProperties`,
      fields: [
        text("fieldDelimiter", translate("Field Delimiter"), "0x1C", translate("Character(s) that delimit the fields in the message.")),
        text("groupDelimiter", translate("Group Delimiter"), "0x1D", translate("Character(s) that delimit the groups in the message.")),
        text("segmentDelimiter", translate("Segment Delimiter"), "0x1E", translate("Character(s) that delimit the segments in the message.")),
        bool("useStrictValidation", translate("Use Strict Validation"), false, translate("Validate the NCPDP message against a schema."))
      ]
    },
    {
      key: "batchProperties",
      label: translate("Batch"),
      class: `${PKG}.NCPDPBatchProperties`,
      fields: [
        opt(
          "splitType",
          translate("Split Batch By"),
          [{ value: "JavaScript", label: translate("JavaScript") }],
          "JavaScript",
          translate("Method for splitting the batch message. Only used when Process Batch is enabled in the connector.")
        ),
        code("batchScript", "JavaScript", null, BATCH_SCRIPT_HINT)
      ]
    }
  ]
};
DEF.defaults = (version) => {
  const props = { "@class": DEF.propertiesClass, "@version": version };
  for (const group of DEF.groups) {
    const obj = { "@class": group.class, "@version": version };
    for (const f of group.fields) obj[f.key] = f.default ?? null;
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
