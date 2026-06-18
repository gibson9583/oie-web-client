// plugins/datatype-hl7v3/web/plugin.jsx
import { platform } from "@oie/web-shell";
var React = platform.React;
var PKG = "com.mirth.connect.plugins.datatypes.hl7v3";
var bool = (key, label, def, hint) => ({ key, label, type: "checkbox", default: def, hint });
var opt = (key, label, options, def, hint) => ({ key, label, type: "select", options, default: def, hint });
var code = (key, label, def, hint) => ({ key, label, type: "code", default: def, hint });
var BATCH_SCRIPT_HINT = "JavaScript that splits the batch and returns the next message. Has access to 'reader' (a Java BufferedReader); return null/empty to signal end of input. Only used when Process Batch is enabled in the connector.";
var DEF = {
  name: "HL7V3",
  label: "HL7 v3.x",
  order: 20,
  propertiesClass: `${PKG}.HL7V3DataTypeProperties`,
  groups: [
    {
      key: "serializationProperties",
      label: "Serialization",
      class: `${PKG}.HL7V3SerializationProperties`,
      fields: [
        bool("stripNamespaces", "Strip Namespaces", false, "Strip namespace definitions from the transformed XML message (prefixes are not removed).")
      ]
    },
    {
      key: "batchProperties",
      label: "Batch",
      class: `${PKG}.HL7V3BatchProperties`,
      fields: [
        opt(
          "splitType",
          "Split Batch By",
          [{ value: "JavaScript", label: "JavaScript" }],
          "JavaScript",
          "Method for splitting the batch message. Only used when Process Batch is enabled in the connector."
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
