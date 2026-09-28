import assert from 'node:assert/strict';
import { protectMessageXml } from './message-xml.js';

// Test the reversible step independently of DOMParser: every forbidden C0
// reference is restored, without reinterpreting literal marker/entity text.
for (const code of [...Array(32).keys()].filter(n => ![9, 10, 13].includes(n)).concat([0xFFFE, 0xFFFF])) {
    for (const ref of [`&#${code};`, `&#x${code.toString(16)};`, `&#x${code.toString(16).toUpperCase()};`]) {
        const protectedXml = protectMessageXml(ref);
        assert.equal(protectedXml.restore(protectedXml.xml), String.fromCodePoint(code));
    }
}
for (const literal of ['\uE000', '\uE0000;', '\uE00012;\uE000', '&#x1c;', '&amp;#x1c;']) {
    const { xml, restore } = protectMessageXml(`<![CDATA[${literal}]]>`);
    assert.equal(restore(xml), `<![CDATA[${literal}]]>`);
}
const { xml, restore } = protectMessageXml('&#x1c;\uE0000;&#xE000;0;&#57344;1;&#x1d;');
assert.equal(restore(xml), '\x1c\uE0000;\uE0000;\uE0001;\x1d');
assert.equal(protectMessageXml('<!-- &#x1c; --><?example &#x1c;?>').xml, '<!-- &#x1c; --><?example &#x1c;?>');
for (const invalid of ['&#xD800;', '&#1114112;', '&#x110000;', '&#wat;', '&unknown;', '&#-1;']) {
    assert.equal(protectMessageXml(invalid).xml, invalid, 'native XML validation must see malformed references');
}
assert.throws(() => protectMessageXml('<!DOCTYPE message [<!ENTITY x "sensitive">]><message/>'), /invalid message XML/);
assert.equal(protectMessageXml('<![CDATA[<!DOCTYPE example>]]>').xml, '<![CDATA[<!DOCTYPE example>]]>');
console.log('message-xml: control references, collision safety, literal CDATA/entities, DTD rejection passed');
