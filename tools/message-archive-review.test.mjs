import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readTar, readMessageArchive } from '../web-administrator/client/core/message-import-files.js';
import { createZip } from '../web-administrator/client/core/zip.js';

function entry(name, content, type = '0') {
    const bytes = Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100);
    header.write('0000644\0', 100);
    header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124);
    header.fill(32, 148, 156);
    header[156] = type.charCodeAt(0);
    header.write('ustar\0', 257);
    header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    return Buffer.concat([header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512)]);
}
function pax(key, value) {
    const field = `${key}=${value}\n`;
    let length = Buffer.byteLength(field) + 2;
    while (Buffer.byteLength(`${length} ${field}`) !== length) length = Buffer.byteLength(`${length} ${field}`);
    return `${length} ${field}`;
}
const xml = '<message><messageId>11</messageId></message>';

test('TAR PAX Unicode paths and GNU long names are resolved before recursion filtering', () => {
    const long = 'a'.repeat(110) + '.xml';
    const archive = Buffer.concat([
        entry('PaxHeader', pax('path', 'données/messages.xml'), 'x'), entry('placeholder', xml),
        entry('././@LongLink', long + '\0', 'L'), entry('placeholder', xml), Buffer.alloc(1024)
    ]);
    assert.deepEqual([...readTar(archive, true)].map(item => item.name), ['données/messages.xml', long]);
    assert.deepEqual([...readTar(archive, false)].map(item => item.name), [long]);
});

test('malformed PAX lengths and corrupt gzip fail before yielding a message', async () => {
    assert.throws(() => [...readTar(Buffer.concat([entry('PaxHeader', '999 path=messages.xml\n', 'x'), entry('file', xml)]))], /extended header/);
    const iterator = readMessageArchive('messages.tar.gz', new Uint8Array([1, 2, 3]), true);
    await assert.rejects(iterator.next());
});

test('ZIP iteration stops between entries after the initiating session ends', async () => {
    const zip = createZip();
    zip.add('first.xml', xml);
    zip.add('second.xml', xml);
    const bytes = new Uint8Array(await (await zip.blob()).arrayBuffer());
    let active = true;
    const iterator = readMessageArchive('messages.zip', bytes, true, () => { if (!active) throw new Error('session ended'); });
    assert.equal((await iterator.next()).value.name, 'first.xml');
    active = false;
    await assert.rejects(iterator.next(), /session ended/);
    assert.equal((await iterator.next()).done, true);
});
