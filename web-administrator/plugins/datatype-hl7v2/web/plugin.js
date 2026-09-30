// plugins/datatype-hl7v2/web/plugin.tsx
import { scope } from "@oie/web-ui";
import { platform } from "@oie/web-shell";
var { t } = scope("datatype-hl7v2");
var React = platform.React;
var PKG = "com.mirth.connect.plugins.datatypes.hl7v2";
var text = (key, label, def, hint) => ({ key, label, type: "text", default: def, hint });
var bool = (key, label, def, hint) => ({ key, label, type: "checkbox", default: def, hint });
var opt = (key, label, options, def, hint) => ({ key, label, type: "select", options, default: def, hint });
var code = (key, label, def, hint) => ({ key, label, type: "code", default: def, hint });
var BATCH_SCRIPT_HINT = t("JavaScript that splits the batch and returns the next message. Has access to ''reader'' (a Java BufferedReader); return null/empty to signal end of input. Only used when Process Batch is enabled in the connector.");
var DEF = {
  name: "HL7V2",
  label: t("HL7 v2.x"),
  order: 10,
  propertiesClass: `${PKG}.HL7v2DataTypeProperties`,
  groups: [
    {
      key: "serializationProperties",
      label: t("Serialization"),
      class: `${PKG}.HL7v2SerializationProperties`,
      fields: [
        bool("handleRepetitions", t("Parse Field Repetitions"), true, t("Parse field repetitions (Non-Strict Parser only).")),
        bool("handleSubcomponents", t("Parse Subcomponents"), true, t("Parse subcomponents (Non-Strict Parser only).")),
        bool("useStrictParser", t("Use Strict Parser"), false, t("Parse messages based upon strict HL7 specifications.")),
        bool("useStrictValidation", t("Validate in Strict Parser"), false, t("Validate messages using HL7 specifications (Strict Parser only).")),
        bool("stripNamespaces", t("Strip Namespaces"), false, t("Strip namespace definitions from the transformed XML message (Strict Parser only).")),
        text("segmentDelimiter", t("Segment Delimiter"), "\\r", t("Input delimiter character(s) expected after each segment.")),
        bool("convertLineBreaks", t("Convert Line Breaks"), true, t("Convert all line break styles (CRLF, CR, LF) in the raw message to the segment delimiter."))
      ]
    },
    {
      key: "deserializationProperties",
      label: t("Deserialization"),
      class: `${PKG}.HL7v2DeserializationProperties`,
      fields: [
        bool("useStrictParser", t("Use Strict Parser"), false, t("Parse messages based upon strict HL7 specifications.")),
        bool("useStrictValidation", t("Validate in Strict Parser"), false, t("Validate messages using HL7 specifications (Strict Parser only).")),
        text("segmentDelimiter", t("Segment Delimiter"), "\\r", t("Delimiter character(s) used after each segment."))
      ]
    },
    {
      key: "batchProperties",
      label: t("Batch"),
      class: `${PKG}.HL7v2BatchProperties`,
      fields: [
        opt("splitType", t("Split Batch By"), [
          { value: "MSH_Segment", label: t("MSH Segment") },
          { value: "JavaScript", label: t("JavaScript") }
        ], "MSH_Segment", t("MSH Segment: each MSH segment starts a new message. JavaScript: use a script to split messages.")),
        code("batchScript", "JavaScript", null, BATCH_SCRIPT_HINT)
      ]
    },
    {
      key: "responseGenerationProperties",
      label: t("Response Generation"),
      class: `${PKG}.HL7v2ResponseGenerationProperties`,
      fields: [
        text("segmentDelimiter", t("Segment Delimiter"), "\\r", t("Delimiter character(s) used after each segment of the generated ACK.")),
        text("successfulACKCode", t("Successful ACK Code"), "AA"),
        text("successfulACKMessage", t("Successful ACK Message"), null),
        text("errorACKCode", t("Error ACK Code"), "AE"),
        text("errorACKMessage", t("Error ACK Message"), "An Error Occurred Processing Message."),
        text("rejectedACKCode", t("Rejected ACK Code"), "AR"),
        text("rejectedACKMessage", t("Rejected ACK Message"), "Message Rejected."),
        bool("msh15ACKAccept", t("MSH-15 ACK Accept"), false, t("Check the MSH-15 field of an incoming message to control the acknowledgment conditions.")),
        text("dateFormat", t("Date Format"), "yyyyMMddHHmmss.SSS", t("Date format used for the timestamp in the generated ACK."))
      ]
    },
    {
      key: "responseValidationProperties",
      label: t("Response Validation"),
      class: `${PKG}.HL7v2ResponseValidationProperties`,
      fields: [
        text("successfulACKCode", t("Successful ACK Codes"), "AA,CA", t("ACK code(s) expected when the message is accepted (comma separated). Message status is set to SENT.")),
        text("errorACKCode", t("Error ACK Codes"), "AE,CE", t("ACK code(s) expected when an error occurs downstream (comma separated). Message status is set to ERROR.")),
        text("rejectedACKCode", t("Rejected ACK Codes"), "AR,CR", t("ACK code(s) expected when the message is rejected (comma separated). Message status is set to ERROR.")),
        bool("validateMessageControlId", t("Validate Message Control Id"), true, t("Validate the Message Control Id (MSA-2) returned from the response.")),
        opt("originalMessageControlId", t("Original Message Control Id"), [
          { value: "Destination_Encoded", label: t("Destination Encoded") },
          { value: "Map_Variable", label: t("Map Variable") }
        ], "Destination_Encoded", t("Source of the original Message Control Id used to validate the response.")),
        text("originalIdMapVariable", t("Original Id Map Variable"), null, t("Required when Original Message Control Id is Map Variable; the Id is read from the connector or channel map."))
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
