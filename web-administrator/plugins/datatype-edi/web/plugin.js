// plugins/datatype-edi/web/plugin.tsx
import { scope as i18nScope } from "@oie/web-ui";
import { platform } from "@oie/web-shell";
var { t: translate } = i18nScope("datatype-edi");
var React = platform.React;
var PKG = "com.mirth.connect.plugins.datatypes.edi";
var text = (key, label, def, hint) => ({ key, label, type: "text", default: def, hint });
var bool = (key, label, def, hint) => ({ key, label, type: "checkbox", default: def, hint });
var opt = (key, label, options, def, hint) => ({ key, label, type: "select", options, default: def, hint });
var code = (key, label, def, hint) => ({ key, label, type: "code", default: def, hint });
var BATCH_SCRIPT_HINT = translate("JavaScript that splits the batch and returns the next message. Has access to ''reader'' (a Java BufferedReader); return null/empty to signal end of input. Only used when Process Batch is enabled in the connector.");
var DEF = {
  name: "EDI/X12",
  label: translate("EDI / X12"),
  order: 70,
  propertiesClass: `${PKG}.EDIDataTypeProperties`,
  groups: [
    {
      key: "serializationProperties",
      label: translate("Serialization"),
      class: `${PKG}.EDISerializationProperties`,
      fields: [
        text("segmentDelimiter", translate("Segment Delimiter"), "~", translate("Character(s) that delimit the segments in the message.")),
        text("elementDelimiter", translate("Element Delimiter"), "*", translate("Character(s) that delimit the elements in the message.")),
        text("subelementDelimiter", translate("Subelement Delimiter"), ":", translate("Character(s) that delimit the subelements in the message.")),
        bool("inferX12Delimiters", translate("Infer X12 Delimiters"), true, translate("X12 only: infer delimiters from the incoming message instead of the properties above."))
      ]
    },
    {
      key: "batchProperties",
      label: translate("Batch"),
      class: `${PKG}.EDIBatchProperties`,
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
