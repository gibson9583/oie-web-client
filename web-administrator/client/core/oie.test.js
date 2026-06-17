/*
 * Tests for core/oie.js — runnable with `node client/core/oie.test.js`.
 * Focus: the transformer-template base64 codec. The engine annotates
 * Transformer.inboundTemplate / outboundTemplate with Base64StringConverter, so
 * those fields arrive as { '@encoding': 'base64', '$': <base64> } and must
 * round-trip byte-for-byte — including HL7 '\r' segment separators that XML
 * would otherwise normalize to '\n'.
 */

import { decodeChannelTemplates, encodeChannelTemplates } from './oie.js';

let pass = 0, fail = 0;
function eq(label, got, want) {
    if (got === want) { pass++; return; }
    fail++;
    console.error(`FAIL  ${label}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
}

// A representative HL7 template using real CR separators, plus a non-ASCII char
// to exercise UTF-8 handling.
const HL7 = 'MSH|^~\\&|EPIC|Süd\rPID|1||123^^^^MR\rOBX|1|NM|x||5';
// Independent reference base64 (Node Buffer) — also cross-checks the btoa-based
// encoder in oie.js produces standard, byte-identical base64.
const b64 = Buffer.from(HL7, 'utf8').toString('base64');

// Build a channel covering all transformer slots: source, destination, response.
const channelWire = () => ({
    sourceConnector: { transformer: { inboundTemplate: { '@encoding': 'base64', '$': b64 }, outboundTemplate: null } },
    destinationConnectors: {
        connector: [
            {
                transformer: { inboundTemplate: { '@encoding': 'base64', '$': b64 }, outboundTemplate: { '@encoding': 'base64', '$': b64 } },
                responseTransformer: { inboundTemplate: { '@encoding': 'base64', '$': b64 }, outboundTemplate: null }
            }
        ]
    }
});

// ---- decode: wrapper object -> plain text with CR preserved ----
const decoded = decodeChannelTemplates(channelWire());
eq('decode source inbound -> text', decoded.sourceConnector.transformer.inboundTemplate, HL7);
eq('decode keeps CR', decoded.sourceConnector.transformer.inboundTemplate.includes('\r'), true);
eq('decode keeps UTF-8', decoded.sourceConnector.transformer.inboundTemplate.includes('Süd'), true);
eq('decode dest response inbound', decoded.destinationConnectors.connector[0].responseTransformer.inboundTemplate, HL7);
eq('decode leaves null null', decoded.sourceConnector.transformer.outboundTemplate, null);

// ---- encode: plain text -> wrapper object ----
const plain = {
    sourceConnector: { transformer: { inboundTemplate: HL7, outboundTemplate: '' } },
    destinationConnectors: { connector: [{ transformer: { inboundTemplate: HL7, outboundTemplate: null } }] }
};
const encoded = encodeChannelTemplates(plain);
eq('encode wraps with @encoding', encoded.sourceConnector.transformer.inboundTemplate['@encoding'], 'base64');
eq('encode base64 matches', encoded.sourceConnector.transformer.inboundTemplate.$, b64);
eq('encode leaves empty string', encoded.sourceConnector.transformer.outboundTemplate, '');
eq('encode leaves null', encoded.destinationConnectors.connector[0].transformer.outboundTemplate, null);

// ---- full round-trip: decode(encode(x)) === x ----
const roundTrip = decodeChannelTemplates(encodeChannelTemplates({
    sourceConnector: { transformer: { inboundTemplate: HL7, outboundTemplate: null } },
    destinationConnectors: { connector: [] }
}));
eq('round-trip is byte-identical (CR intact)', roundTrip.sourceConnector.transformer.inboundTemplate, HL7);

// ---- safety: empty / malformed channels don't throw ----
eq('null channel ok', JSON.stringify(decodeChannelTemplates(null) ?? null), 'null');
eq('no transformers ok', JSON.stringify(encodeChannelTemplates({ sourceConnector: {} })), JSON.stringify({ sourceConnector: {} }));

console.log(`\noie.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
