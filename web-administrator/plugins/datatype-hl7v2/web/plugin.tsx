import { scope as i18nScope } from '@oie/web-ui';
const { t: translate } = i18nScope("datatype-hl7v2");
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

const BATCH_SCRIPT_HINT = translate("JavaScript that splits the batch and returns the next message. Has access to ''reader'' (a Java BufferedReader); return null/empty to signal end of input. Only used when Process Batch is enabled in the connector.");

const DEF: any = {
    name: 'HL7V2', label: translate("HL7 v2.x"), order: 10,
    propertiesClass: `${PKG}.HL7v2DataTypeProperties`,
    groups: [
        {
            key: 'serializationProperties', label: translate("Serialization"),
            class: `${PKG}.HL7v2SerializationProperties`,
            fields: [
                bool('handleRepetitions', translate("Parse Field Repetitions"), true, translate("Parse field repetitions (Non-Strict Parser only).")),
                bool('handleSubcomponents', translate("Parse Subcomponents"), true, translate("Parse subcomponents (Non-Strict Parser only).")),
                bool('useStrictParser', translate("Use Strict Parser"), false, translate("Parse messages based upon strict HL7 specifications.")),
                bool('useStrictValidation', translate("Validate in Strict Parser"), false, translate("Validate messages using HL7 specifications (Strict Parser only).")),
                bool('stripNamespaces', translate("Strip Namespaces"), false, translate("Strip namespace definitions from the transformed XML message (Strict Parser only).")),
                text('segmentDelimiter', translate("Segment Delimiter"), '\\r', translate("Input delimiter character(s) expected after each segment.")),
                bool('convertLineBreaks', translate("Convert Line Breaks"), true, translate("Convert all line break styles (CRLF, CR, LF) in the raw message to the segment delimiter."))
            ]
        },
        {
            key: 'deserializationProperties', label: translate("Deserialization"),
            class: `${PKG}.HL7v2DeserializationProperties`,
            fields: [
                bool('useStrictParser', translate("Use Strict Parser"), false, translate("Parse messages based upon strict HL7 specifications.")),
                bool('useStrictValidation', translate("Validate in Strict Parser"), false, translate("Validate messages using HL7 specifications (Strict Parser only).")),
                text('segmentDelimiter', translate("Segment Delimiter"), '\\r', translate("Delimiter character(s) used after each segment."))
            ]
        },
        {
            key: 'batchProperties', label: translate("Batch"),
            class: `${PKG}.HL7v2BatchProperties`,
            fields: [
                opt('splitType', translate("Split Batch By"), [
                    { value: 'MSH_Segment', label: translate("MSH Segment") },
                    { value: 'JavaScript', label: translate("JavaScript") }
                ], 'MSH_Segment', translate("MSH Segment: each MSH segment starts a new message. JavaScript: use a script to split messages.")),
                code('batchScript', 'JavaScript', null, BATCH_SCRIPT_HINT)
            ]
        },
        {
            key: 'responseGenerationProperties', label: translate("Response Generation"),
            class: `${PKG}.HL7v2ResponseGenerationProperties`,
            fields: [
                text('segmentDelimiter', translate("Segment Delimiter"), '\\r', translate("Delimiter character(s) used after each segment of the generated ACK.")),
                text('successfulACKCode', translate("Successful ACK Code"), 'AA'),
                text('successfulACKMessage', translate("Successful ACK Message"), null),
                text('errorACKCode', translate("Error ACK Code"), 'AE'),
                text('errorACKMessage', translate("Error ACK Message"), 'An Error Occurred Processing Message.'),
                text('rejectedACKCode', translate("Rejected ACK Code"), 'AR'),
                text('rejectedACKMessage', translate("Rejected ACK Message"), 'Message Rejected.'),
                bool('msh15ACKAccept', translate("MSH-15 ACK Accept"), false, translate("Check the MSH-15 field of an incoming message to control the acknowledgment conditions.")),
                text('dateFormat', translate("Date Format"), 'yyyyMMddHHmmss.SSS', translate("Date format used for the timestamp in the generated ACK."))
            ]
        },
        {
            key: 'responseValidationProperties', label: translate("Response Validation"),
            class: `${PKG}.HL7v2ResponseValidationProperties`,
            fields: [
                text('successfulACKCode', translate("Successful ACK Codes"), 'AA,CA', translate("ACK code(s) expected when the message is accepted (comma separated). Message status is set to SENT.")),
                text('errorACKCode', translate("Error ACK Codes"), 'AE,CE', translate("ACK code(s) expected when an error occurs downstream (comma separated). Message status is set to ERROR.")),
                text('rejectedACKCode', translate("Rejected ACK Codes"), 'AR,CR', translate("ACK code(s) expected when the message is rejected (comma separated). Message status is set to ERROR.")),
                bool('validateMessageControlId', translate("Validate Message Control Id"), true, translate("Validate the Message Control Id (MSA-2) returned from the response.")),
                opt('originalMessageControlId', translate("Original Message Control Id"), [
                    { value: 'Destination_Encoded', label: translate("Destination Encoded") },
                    { value: 'Map_Variable', label: translate("Map Variable") }
                ], 'Destination_Encoded', translate("Source of the original Message Control Id used to validate the response.")),
                text('originalIdMapVariable', translate("Original Id Map Variable"), null, translate("Required when Original Message Control Id is Map Variable; the Id is read from the connector or channel map."))
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
