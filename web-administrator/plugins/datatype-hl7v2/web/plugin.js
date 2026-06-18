// plugins/datatype-hl7v2/web/plugin.jsx
import { platform } from "@oie/web-shell";
var React = platform.React;
var PKG = "com.mirth.connect.plugins.datatypes.hl7v2";
var text = (key, label, def, hint) => ({ key, label, type: "text", default: def, hint });
var bool = (key, label, def, hint) => ({ key, label, type: "checkbox", default: def, hint });
var opt = (key, label, options, def, hint) => ({ key, label, type: "select", options, default: def, hint });
var code = (key, label, def, hint) => ({ key, label, type: "code", default: def, hint });
var BATCH_SCRIPT_HINT = "JavaScript that splits the batch and returns the next message. Has access to 'reader' (a Java BufferedReader); return null/empty to signal end of input. Only used when Process Batch is enabled in the connector.";
var DEF = {
  name: "HL7V2",
  label: "HL7 v2.x",
  order: 10,
  propertiesClass: `${PKG}.HL7v2DataTypeProperties`,
  groups: [
    {
      key: "serializationProperties",
      label: "Serialization",
      class: `${PKG}.HL7v2SerializationProperties`,
      fields: [
        bool("handleRepetitions", "Parse Field Repetitions", true, "Parse field repetitions (Non-Strict Parser only)."),
        bool("handleSubcomponents", "Parse Subcomponents", true, "Parse subcomponents (Non-Strict Parser only)."),
        bool("useStrictParser", "Use Strict Parser", false, "Parse messages based upon strict HL7 specifications."),
        bool("useStrictValidation", "Validate in Strict Parser", false, "Validate messages using HL7 specifications (Strict Parser only)."),
        bool("stripNamespaces", "Strip Namespaces", false, "Strip namespace definitions from the transformed XML message (Strict Parser only)."),
        text("segmentDelimiter", "Segment Delimiter", "\\r", "Input delimiter character(s) expected after each segment."),
        bool("convertLineBreaks", "Convert Line Breaks", true, "Convert all line break styles (CRLF, CR, LF) in the raw message to the segment delimiter.")
      ]
    },
    {
      key: "deserializationProperties",
      label: "Deserialization",
      class: `${PKG}.HL7v2DeserializationProperties`,
      fields: [
        bool("useStrictParser", "Use Strict Parser", false, "Parse messages based upon strict HL7 specifications."),
        bool("useStrictValidation", "Validate in Strict Parser", false, "Validate messages using HL7 specifications (Strict Parser only)."),
        text("segmentDelimiter", "Segment Delimiter", "\\r", "Delimiter character(s) used after each segment.")
      ]
    },
    {
      key: "batchProperties",
      label: "Batch",
      class: `${PKG}.HL7v2BatchProperties`,
      fields: [
        opt("splitType", "Split Batch By", [
          { value: "MSH_Segment", label: "MSH Segment" },
          { value: "JavaScript", label: "JavaScript" }
        ], "MSH_Segment", "MSH Segment: each MSH segment starts a new message. JavaScript: use a script to split messages."),
        code("batchScript", "JavaScript", null, BATCH_SCRIPT_HINT)
      ]
    },
    {
      key: "responseGenerationProperties",
      label: "Response Generation",
      class: `${PKG}.HL7v2ResponseGenerationProperties`,
      fields: [
        text("segmentDelimiter", "Segment Delimiter", "\\r", "Delimiter character(s) used after each segment of the generated ACK."),
        text("successfulACKCode", "Successful ACK Code", "AA"),
        text("successfulACKMessage", "Successful ACK Message", null),
        text("errorACKCode", "Error ACK Code", "AE"),
        text("errorACKMessage", "Error ACK Message", "An Error Occurred Processing Message."),
        text("rejectedACKCode", "Rejected ACK Code", "AR"),
        text("rejectedACKMessage", "Rejected ACK Message", "Message Rejected."),
        bool("msh15ACKAccept", "MSH-15 ACK Accept", false, "Check the MSH-15 field of an incoming message to control the acknowledgment conditions."),
        text("dateFormat", "Date Format", "yyyyMMddHHmmss.SSS", "Date format used for the timestamp in the generated ACK.")
      ]
    },
    {
      key: "responseValidationProperties",
      label: "Response Validation",
      class: `${PKG}.HL7v2ResponseValidationProperties`,
      fields: [
        text("successfulACKCode", "Successful ACK Codes", "AA,CA", "ACK code(s) expected when the message is accepted (comma separated). Message status is set to SENT."),
        text("errorACKCode", "Error ACK Codes", "AE,CE", "ACK code(s) expected when an error occurs downstream (comma separated). Message status is set to ERROR."),
        text("rejectedACKCode", "Rejected ACK Codes", "AR,CR", "ACK code(s) expected when the message is rejected (comma separated). Message status is set to ERROR."),
        bool("validateMessageControlId", "Validate Message Control Id", true, "Validate the Message Control Id (MSA-2) returned from the response."),
        opt("originalMessageControlId", "Original Message Control Id", [
          { value: "Destination_Encoded", label: "Destination Encoded" },
          { value: "Map_Variable", label: "Map Variable" }
        ], "Destination_Encoded", "Source of the original Message Control Id used to validate the response."),
        text("originalIdMapVariable", "Original Id Map Variable", null, "Required when Original Message Control Id is Map Variable; the Id is read from the connector or channel map.")
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
