import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { readTar, readMessageArchive } from '../web-administrator/client/core/message-import-files.js';
import { createZip } from '../web-administrator/client/core/zip.js';

const xml = '<message><messageId>11</messageId></message>';
function tar(entries) {
    const chunks = [];
    for (const [name, content] of entries) {
        const bytes = Buffer.from(content);
        const header = Buffer.alloc(512);
        header.write(name, 0, 100);
        header.write('0000644\0', 100);
        header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124);
        header.fill(32, 148, 156);
        header[156] = 48;
        header.write('ustar\0', 257);
        header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148);
        chunks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
    }
    return Buffer.concat([...chunks, Buffer.alloc(1024)]);
}
async function collect(name, bytes, recursive = true, guard) {
    const entries = [];
    for await (const entry of readMessageArchive(name, bytes, recursive, guard)) entries.push(entry);
    return entries;
}

test('ZIP and TAR/GZip import root and nested files only when recursive', async () => {
    const entries = [['messages.xml', xml], ['nested/messages.xml', xml]];
    const archive = tar(entries);
    const zip = createZip();
    for (const [name, content] of entries) zip.add(name, content);
    const formats = [['messages.tar', archive], ['messages.tar.gz', gzipSync(archive)], ['messages.zip', new Uint8Array(await (await zip.blob()).arrayBuffer())]];
    for (const [name, data] of formats) {
        assert.deepEqual(await collect(name, data, false), [{name:'messages.xml',content:xml}]);
        assert.deepEqual(await collect(name, data, true), entries.map(([name,content])=>({name,content})));
    }
});

test('TAR/BZip2 decodes through the browser vendor bundle without a global Buffer', async () => {
    const bytes = Buffer.from('QlpoOTFBWSZTWQwJQ5wAADnfgsIiQAHnBQAgBABmhh5AAgABCCAASGhTTJ6mm1MgNA0GSgDQANNNqP1RRutqmBN4AJr0IAzLqgk4FqzXLTFtEmj5OhCySkGNg1IfsTIchyGnEMlXhAhiFQlmT+LuSKcKEgGBKHOA', 'base64');
    const original = globalThis.Buffer;
    try {
        globalThis.Buffer = undefined;
        assert.deepEqual(await collect('messages.tar.bz2', bytes), [{name:'messages.xml',content:xml}]);
    } finally { globalThis.Buffer = original; }
});

test('corrupt or truncated TAR archives fail instead of reporting empty success', () => {
    const bytes = tar([['messages.xml', xml]]);
    assert.throws(() => [...readTar(bytes.subarray(0, 530))], /Truncated/);
    bytes[0] ^= 1;
    assert.throws(() => [...readTar(bytes)], /checksum/);
});

test('archive reads stop when their initiating session expires', async () => {
    await assert.rejects(collect('messages.tar', tar([['messages.xml',xml]]), true, () => { throw new Error('expired'); }), /expired/);
});
