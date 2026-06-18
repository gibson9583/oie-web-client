// plugins/datatype-xml/web/plugin.jsx
import { platform } from "@oie/web-shell";
var React = platform.React;
var PKG = "com.mirth.connect.plugins.datatypes.xml";
var text = (key, label, def, hint) => ({ key, label, type: "text", default: def, hint });
var num = (key, label, def, hint) => ({ key, label, type: "number", default: def, hint });
var bool = (key, label, def, hint) => ({ key, label, type: "checkbox", default: def, hint });
var opt = (key, label, options, def, hint) => ({ key, label, type: "select", options, default: def, hint });
var code = (key, label, def, hint) => ({ key, label, type: "code", default: def, hint });
var BATCH_SCRIPT_HINT = "JavaScript that splits the batch and returns the next message. Has access to 'reader' (a Java BufferedReader); return null/empty to signal end of input. Only used when Process Batch is enabled in the connector.";
var DEF = {
  name: "XML",
  label: "XML",
  order: 30,
  propertiesClass: `${PKG}.XMLDataTypeProperties`,
  groups: [
    {
      key: "serializationProperties",
      label: "Serialization",
      class: `${PKG}.XMLSerializationProperties`,
      fields: [
        bool("stripNamespaces", "Strip Namespaces", false, "Strip namespace definitions from the transformed XML message (prefixes are not removed).")
      ]
    },
    {
      key: "batchProperties",
      label: "Batch",
      class: `${PKG}.XMLBatchProperties`,
      fields: [
        opt("splitType", "Split Batch By", [
          { value: "Element_Name", label: "Element Name" },
          { value: "Level", label: "Level" },
          { value: "XPath_Query", label: "XPath Query" },
          { value: "JavaScript", label: "JavaScript" }
        ], "Element_Name", "Method for splitting the batch message. Only used when Process Batch is enabled in the connector."),
        text("elementName", "Element Name", null, "Each element with this name is split into its own message."),
        num("level", "Level", 1, "Each element at this level is split into its own message (root element is level 0)."),
        text("query", "XPath Query", null, "Each element found with the XPath query is split into its own message."),
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
