import { scope } from '@oie/web-ui';
const { t } = scope("datatype-hl7v2");
/*
 * HL7 v2.x data type — web admin plugin (React).
 *
 * Registers the HL7V2 data type definition (serialization, deserialization,
 * batch, response generation/validation property groups) via
 * platform.registerDataType. The web admin's generic data-type properties
 * editor (client/datatypes/props-editor.jsx) renders whatever groups/fields
 * this definition exposes — so a data type is just a plugin, not privileged
 * core code, mirroring the Swing client's DataTypeClientPlugin model. A
 * third-party data type ships the same way: drop a folder with this shape
 * into plugins/.
 *
 * This plugin contributes a DATA definition only (schema + defaults()); it has
 * no per-type render. The shared React properties editor consumes the def, so
 * there is no JSX in this module — but it is authored as .jsx under the React
 * plugin contract, sharing the host's single React instance via platform.React.
 *
 * Field/default shapes are transcribed from the engine plugin
 * (server/src/com/mirth/connect/plugins/datatypes/hl7v2/*Properties.java);
 * empty-string Java defaults are written as null to match the engine's XStream
 * JSON round-trip.
 */

import { platform } from '@oie/web-shell';
import type { Platform } from '@oie/web-shell';
const React = platform.React;

const PKG = 'com.mirth.connect.plugins.datatypes.hl7v2';

const text = (key: any, label: any, def: any, hint?: any) => ({ key, label, type: 'text', default: def, hint });
const bool = (key: any, label: any, def: any, hint?: any) => ({ key, label, type: 'checkbox', default: def, hint });
const opt = (key: any, label: any, options: any, def: any, hint?: any) => ({ key, label, type: 'select', options, default: def, hint });
const code = (key: any, label: any, def: any, hint?: any) => ({ key, label, type: 'code', default: def, hint });

const BATCH_SCRIPT_HINT = t("JavaScript that splits the batch and returns the next message. Has access to ''reader'' (a Java BufferedReader); return null/empty to signal end of input. Only used when Process Batch is enabled in the connector.");

const DEF: any = {
    name: 'HL7V2', label: t("HL7 v2.x"), order: 10,
    propertiesClass: `${PKG}.HL7v2DataTypeProperties`,
    groups: [
        {
            key: 'serializationProperties', label: t("Serialization"),
            class: `${PKG}.HL7v2SerializationProperties`,
            fields: [
                bool('handleRepetitions', t("Parse Field Repetitions"), true, t("Parse field repetitions (Non-Strict Parser only).")),
                bool('handleSubcomponents', t("Parse Subcomponents"), true, t("Parse subcomponents (Non-Strict Parser only).")),
                bool('useStrictParser', t("Use Strict Parser"), false, t("Parse messages based upon strict HL7 specifications.")),
                bool('useStrictValidation', t("Validate in Strict Parser"), false, t("Validate messages using HL7 specifications (Strict Parser only).")),
                bool('stripNamespaces', t("Strip Namespaces"), false, t("Strip namespace definitions from the transformed XML message (Strict Parser only).")),
                text('segmentDelimiter', t("Segment Delimiter"), '\\r', t("Input delimiter character(s) expected after each segment.")),
                bool('convertLineBreaks', t("Convert Line Breaks"), true, t("Convert all line break styles (CRLF, CR, LF) in the raw message to the segment delimiter."))
            ]
        },
        {
            key: 'deserializationProperties', label: t("Deserialization"),
            class: `${PKG}.HL7v2DeserializationProperties`,
            fields: [
                bool('useStrictParser', t("Use Strict Parser"), false, t("Parse messages based upon strict HL7 specifications.")),
                bool('useStrictValidation', t("Validate in Strict Parser"), false, t("Validate messages using HL7 specifications (Strict Parser only).")),
                text('segmentDelimiter', t("Segment Delimiter"), '\\r', t("Delimiter character(s) used after each segment."))
            ]
        },
        {
            key: 'batchProperties', label: t("Batch"),
            class: `${PKG}.HL7v2BatchProperties`,
            fields: [
                opt('splitType', t("Split Batch By"), [
                    { value: 'MSH_Segment', label: t("MSH Segment") },
                    { value: 'JavaScript', label: t("JavaScript") }
                ], 'MSH_Segment', t("MSH Segment: each MSH segment starts a new message. JavaScript: use a script to split messages.")),
                code('batchScript', 'JavaScript', null, BATCH_SCRIPT_HINT)
            ]
        },
        {
            key: 'responseGenerationProperties', label: t("Response Generation"),
            class: `${PKG}.HL7v2ResponseGenerationProperties`,
            fields: [
                text('segmentDelimiter', t("Segment Delimiter"), '\\r', t("Delimiter character(s) used after each segment of the generated ACK.")),
                text('successfulACKCode', t("Successful ACK Code"), 'AA'),
                text('successfulACKMessage', t("Successful ACK Message"), null),
                text('errorACKCode', t("Error ACK Code"), 'AE'),
                text('errorACKMessage', t("Error ACK Message"), 'An Error Occurred Processing Message.'),
                text('rejectedACKCode', t("Rejected ACK Code"), 'AR'),
                text('rejectedACKMessage', t("Rejected ACK Message"), 'Message Rejected.'),
                bool('msh15ACKAccept', t("MSH-15 ACK Accept"), false, t("Check the MSH-15 field of an incoming message to control the acknowledgment conditions.")),
                text('dateFormat', t("Date Format"), 'yyyyMMddHHmmss.SSS', t("Date format used for the timestamp in the generated ACK."))
            ]
        },
        {
            key: 'responseValidationProperties', label: t("Response Validation"),
            class: `${PKG}.HL7v2ResponseValidationProperties`,
            fields: [
                text('successfulACKCode', t("Successful ACK Codes"), 'AA,CA', t("ACK code(s) expected when the message is accepted (comma separated). Message status is set to SENT.")),
                text('errorACKCode', t("Error ACK Codes"), 'AE,CE', t("ACK code(s) expected when an error occurs downstream (comma separated). Message status is set to ERROR.")),
                text('rejectedACKCode', t("Rejected ACK Codes"), 'AR,CR', t("ACK code(s) expected when the message is rejected (comma separated). Message status is set to ERROR.")),
                bool('validateMessageControlId', t("Validate Message Control Id"), true, t("Validate the Message Control Id (MSA-2) returned from the response.")),
                opt('originalMessageControlId', t("Original Message Control Id"), [
                    { value: 'Destination_Encoded', label: t("Destination Encoded") },
                    { value: 'Map_Variable', label: t("Map Variable") }
                ], 'Destination_Encoded', t("Source of the original Message Control Id used to validate the response.")),
                text('originalIdMapVariable', t("Original Id Map Variable"), null, t("Required when Original Message Control Id is Map Variable; the Id is read from the connector or channel map."))
            ]
        }
    ]
};

// Same builder the core registry uses: '@class'/'@version' on the root and on
// every group, each field seeded with its default.
DEF.defaults = (version: any) => {
    const props: any = { '@class': DEF.propertiesClass, '@version': version };
    for (const group of DEF.groups) {
        const obj: any = { '@class': group.class, '@version': version };
        for (const f of group.fields) obj[f.key] = f.default ?? null;
        props[group.key] = obj;
    }
    return props;
};

export function register(platform: Platform) {
    platform.registerDataType(DEF.name, DEF);
}
