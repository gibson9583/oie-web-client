import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateRawSync } from 'node:zlib';
import { createZip, readZip } from '../web-administrator/client/core/zip.js';

// Independent input: Python stdlib zipfile.ZipFile + ZIP_DEFLATED, with each
// ZipInfo timestamp fixed to (2020, 1, 2, 3, 4, 6). No Python runtime is needed.
// Includes a UTF-8 directory/name and binary bytes, not only XML text. Reading
// and writing with the same zip.js version alone would hide format regressions.
const PYTHON_ZIP = Buffer.from(
    'UEsDBBQAAAAIAIMYIlCbUfm9GQAAACwAAAAMAAAAbWVzc2FnZXMueG1ss8lNLS5OTE+1s4EyPFPsDA1t9BE8ONsOAFBLAwQUAAAICACDGCJQAAAAAAIAAAAAAAAACQAAAGRvbm7DqWVzLwMAUEsDBBQAAAgIAIMYIlBbFzg0CgAAAAgAAAATAAAAZG9ubsOpZXMv57uT5p6cLmJpbmNgZKpv+PefAQBQSwECFAMUAAAACACDGCJQm1H5vRkAAAAsAAAADAAAAAAAAAAAAAAAgAEAAAAAbWVzc2FnZXMueG1sUEsBAhQDFAAACAgAgxgiUAAAAAACAAAAAAAAAAkAAAAAAAAAAAAAAIABQwAAAGRvbm7DqWVzL1BLAQIUAxQAAAgIAIMYIlBbFzg0CgAAAAgAAAATAAAAAAAAAAAAAACAAWwAAABkb25uw6llcy/nu5PmnpwuYmluUEsFBgAAAAADAAMAsgAAAKcAAAAAAA==',
    'base64'
);
const XML = Buffer.from('<message><messageId>11</messageId></message>');
const BINARY = Buffer.from([0, 1, 2, 127, 128, 254, 255, 0]);

async function entries(data, recursive = true) {
    const values = [];
    for await (const entry of readZip(data, recursive)) values.push([entry.name, Buffer.from(entry.data)]);
    return values;
}

// ZIP's IEEE CRC-32, independently checked against the canonical test vector.
function crc32(data) {
    let crc = 0xffffffff;
    for (const byte of data) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

// Deliberately independent of zip.js: parse these small, single-disk, non-ZIP64
// archives using the standard central-directory fields and Node's raw inflater.
// The directory holds sizes even when the local header uses a data descriptor.
function decodePlainZip(data) {
    const end = data.lastIndexOf(Buffer.from('PK\x05\x06', 'binary'));
    assert(end >= 0, 'end-of-central-directory record exists');
    assert.equal(end + 22 + data.readUInt16LE(end + 20), data.length);
    assert.equal(data.readUInt16LE(end + 4), 0, 'single disk');
    assert.equal(data.readUInt16LE(end + 6), 0, 'central directory on this disk');
    const count = data.readUInt16LE(end + 10);
    assert.equal(data.readUInt16LE(end + 8), count);
    let offset = data.readUInt32LE(end + 16);
    assert.equal(offset + data.readUInt32LE(end + 12), end);
    const values = [];
    for (let index = 0; index < count; index++) {
        assert.equal(data.readUInt32LE(offset), 0x02014b50, 'central-directory signature');
        const flags = data.readUInt16LE(offset + 8);
        const method = data.readUInt16LE(offset + 10);
        const expectedCrc = data.readUInt32LE(offset + 16);
        const compressedSize = data.readUInt32LE(offset + 20);
        const size = data.readUInt32LE(offset + 24);
        const nameLength = data.readUInt16LE(offset + 28);
        const extraLength = data.readUInt16LE(offset + 30);
        const commentLength = data.readUInt16LE(offset + 32);
        const name = data.subarray(offset + 46, offset + 46 + nameLength);
        const local = data.readUInt32LE(offset + 42);
        assert.equal(flags & 1, 0, 'plain export is not encrypted');
        // ASCII filenames need no encoding flag; zip.js now omits it there.
        if (name.some(byte => byte > 0x7f)) assert.equal(flags & 0x800, 0x800, 'Unicode filenames are UTF-8');
        assert.equal(data.readUInt32LE(local), 0x04034b50, 'local-header signature');
        assert.equal(data.readUInt16LE(local + 6), flags);
        assert.equal(data.readUInt16LE(local + 8), method);
        const localNameLength = data.readUInt16LE(local + 26);
        assert.deepEqual(data.subarray(local + 30, local + 30 + localNameLength), name);
        const start = local + 30 + localNameLength + data.readUInt16LE(local + 28);
        assert(start + compressedSize <= data.readUInt32LE(end + 16), 'entry data precedes directory');
        const compressed = data.subarray(start, start + compressedSize);
        assert([0, 8].includes(method), 'standard STORE or DEFLATE compression');
        const content = method === 8 ? inflateRawSync(compressed) : compressed;
        assert.equal(content.length, size, 'uncompressed size');
        assert.equal(crc32(content), expectedCrc, 'uncompressed checksum');
        values.push([name.toString('utf8'), Buffer.from(content)]);
        offset += 46 + nameLength + extraLength + commentLength;
    }
    assert.equal(offset, end, 'all directory entries consumed');
    return values;
}

test('ZIP import reads independent DEFLATE Unicode/binary entries and skips directories', async () => {
    assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
    assert.deepEqual(await entries(PYTHON_ZIP), [['messages.xml', XML], ['données/结果.bin', BINARY]]);
    assert.deepEqual(await entries(PYTHON_ZIP, false), [['messages.xml', XML]]);
});

test('ZIP export is independently readable with valid CRC, Unicode names, Blob and empty content', async () => {
    const expected = [
        ['données/结果.xml', Buffer.from('résultat ✓\n'.repeat(100))],
        ['binary.bin', BINARY],
        ['blob.bin', Buffer.from([255, 0, 128])],
        ['empty.txt', Buffer.alloc(0)]
    ];
    const zip = createZip();
    zip.add(expected[0][0], expected[0][1].toString('utf8'));
    zip.add(expected[1][0], new Uint8Array(BINARY));
    zip.add(expected[2][0], new Blob([expected[2][1]]));
    zip.add(expected[3][0], null);
    assert.deepEqual(decodePlainZip(Buffer.from(await (await zip.blob()).arrayBuffer())), expected);
});

test('ZIP message import preserves historical custom File Pattern names in memory', async () => {
    // The browser's editable File Pattern preserves slashes and parent segments;
    // engine exports on Windows can also contain relative backslash separators.
    // These names are metadata, never filesystem destinations or request URLs.
    const names = [
        '/exports/message.xml', '../exports/message.xml', 'exports/../message.xml',
        'nested\\message.xml', '\\exports\\message.xml', 'C:\\exports\\message.xml'
    ];
    const zip = createZip();
    for (const name of names) zip.add(name, new Uint8Array(XML));
    const bytes = new Uint8Array(await (await zip.blob()).arrayBuffer());
    assert.deepEqual(await entries(bytes), names.map(name => [name, XML]));
});

test('ZIP import rejects truncated metadata, invalid DEFLATE and out-of-range entry offsets', async () => {
    const invalidDeflate = Buffer.from(PYTHON_ZIP);
    const start = 30 + invalidDeflate.readUInt16LE(26) + invalidDeflate.readUInt16LE(28);
    invalidDeflate[start] = 0x07; // BFINAL=1, reserved BTYPE=3: invalid RFC 1951 block.
    const invalidOffset = Buffer.from(PYTHON_ZIP);
    const end = invalidOffset.lastIndexOf(Buffer.from('PK\x05\x06', 'binary'));
    const central = invalidOffset.readUInt32LE(end + 16);
    invalidOffset.writeUInt32LE(0x7fffffff, central + 42);
    for (const [label, bytes] of [
        ['truncated end record', PYTHON_ZIP.subarray(0, -12)],
        ['invalid DEFLATE block', invalidDeflate],
        ['entry outside archive', invalidOffset]
    ]) {
        await assert.rejects(entries(bytes), undefined, label);
    }
    // Failure must not poison the shared lazy-loaded codec for the next import.
    assert.deepEqual(await entries(PYTHON_ZIP, false), [['messages.xml', XML]]);
});

test('ZIP filename compatibility retains local-header checksum, size and method validation', async () => {
    for (const [label, offset, width] of [
        ['CRC-32 differs from central directory', 14, 4],
        ['uncompressed size differs from central directory', 22, 4],
        ['compression method differs from central directory', 8, 2]
    ]) {
        const bytes = Buffer.from(PYTHON_ZIP);
        if (width === 4) bytes.writeUInt32LE((bytes.readUInt32LE(offset) ^ 1) >>> 0, offset);
        else bytes.writeUInt16LE(0, offset); // local STORE versus central DEFLATE
        await assert.rejects(entries(bytes), /Ambiguous archive/, label);
    }
    assert.deepEqual(await entries(PYTHON_ZIP, false), [['messages.xml', XML]]);
});
