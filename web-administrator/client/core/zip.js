/*
 * Minimal ZIP writer (store method, no compression). Pure JS, no dependency —
 * enough to package message exports into a single downloadable archive.
 *
 *   const zip = createZip();
 *   zip.add('a.txt', 'hello');
 *   zip.add('bin', uint8array);
 *   downloadFile('export.zip', zip.blob());            // unencrypted
 *   const blob = await zip.generate({ password, strength });  // encrypted
 *
 * Encryption matches the Swing client's options (EncryptionType): traditional
 * ZipCrypto ("Standard") and WinZip-AES (AES-128 / AES-256), so the archives
 * open in 7-Zip / WinZip / Keka / macOS Archive Utility with the password.
 */

import { aesKeySchedule, aesEncryptBlock } from './aes.js';

let CRC_TABLE = null;
function crcTable() {
    if (!CRC_TABLE) {
        CRC_TABLE = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            CRC_TABLE[n] = c >>> 0;
        }
    }
    return CRC_TABLE;
}
function crc32(data) {
    const t = crcTable();
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) crc = t[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

/* WinZip-AES strength id -> (key bytes, salt bytes). */
const AES_KEY_LEN = { 1: 16, 2: 24, 3: 32 };
const AES_SALT_LEN = { 1: 8, 2: 12, 3: 16 };

async function pbkdf2Sha1(password, salt, lenBytes) {
    const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-1', salt, iterations: 1000 }, baseKey, lenBytes * 8);
    return new Uint8Array(bits);
}

async function hmacSha1(keyBytes, data) {
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}

/* AES in CTR mode with a 16-byte LITTLE-ENDIAN counter starting at 1 — the
   exact mode WinZip-AES (and zip4j) use. */
function aesCtrLittleEndian(key, data) {
    const sched = aesKeySchedule(key);
    const out = new Uint8Array(data.length);
    const counter = new Uint8Array(16);
    let n = 1;
    for (let off = 0; off < data.length; off += 16) {
        counter[0] = n & 0xff; counter[1] = (n >>> 8) & 0xff;
        counter[2] = (n >>> 16) & 0xff; counter[3] = (n >>> 24) & 0xff;
        const ks = aesEncryptBlock(sched, counter);
        const lim = Math.min(16, data.length - off);
        for (let i = 0; i < lim; i++) out[off + i] = data[off + i] ^ ks[i];
        n++;
    }
    return out;
}

/* The 11-byte 0x9901 AES extra field (AE-2, actual method = store). */
function aesExtraField(strengthId) {
    const e = new Uint8Array(11);
    const dv = new DataView(e.buffer);
    dv.setUint16(0, 0x9901, true);   // header id
    dv.setUint16(2, 7, true);        // data size
    dv.setUint16(4, 2, true);        // vendor version AE-2
    e[6] = 0x41; e[7] = 0x45;        // "AE"
    e[8] = strengthId;               // 1=128, 2=192, 3=256
    dv.setUint16(9, 0, true);        // actual compression method: store
    return e;
}

/* Traditional PKWARE (ZipCrypto) stream encryption — the "Standard" option.
   Prepends the 12-byte encryption header (11 random + CRC high byte). */
function zipCryptoEncrypt(password, data, crc) {
    const t = crcTable();
    let k0 = 0x12345678, k1 = 0x23456789, k2 = 0x34567890;
    const crc1 = (c, b) => (t[(c ^ b) & 0xff] ^ (c >>> 8)) >>> 0;
    const update = (c) => {
        k0 = crc1(k0, c);
        k1 = (k1 + (k0 & 0xff)) >>> 0;
        k1 = (Math.imul(k1, 134775813) + 1) >>> 0;
        k2 = crc1(k2, (k1 >>> 24) & 0xff);
    };
    const cipherByte = (c) => {
        const temp = (k2 | 2) & 0xffff;
        const ks = (Math.imul(temp, temp ^ 1) >>> 8) & 0xff;
        const out = c ^ ks;
        update(c);
        return out;
    };
    for (const b of new TextEncoder().encode(password)) update(b);
    const header = new Uint8Array(12);
    crypto.getRandomValues(header.subarray(0, 11));
    header[11] = (crc >>> 24) & 0xff;
    const out = new Uint8Array(12 + data.length);
    for (let i = 0; i < 12; i++) out[i] = cipherByte(header[i]);
    for (let i = 0; i < data.length; i++) out[12 + i] = cipherByte(data[i]);
    return out;
}

export function createZip() {
    const enc = new TextEncoder();
    const entries = [];   // { nameBytes, data }

    function add(name, content) {
        const data = content instanceof Uint8Array ? content : enc.encode(String(content == null ? '' : content));
        entries.push({ nameBytes: enc.encode(name), data });
    }

    /* Assemble a list of prepared entries into the final ZIP blob.
       Each prepared entry: { nameBytes, versionNeeded, flag, method, crc,
       compSize, uncompSize, extra (Uint8Array), payload (Uint8Array) }. */
    function assemble(prepared) {
        const chunks = [];
        let offset = 0;
        const records = [];
        for (const p of prepared) {
            const h = new DataView(new ArrayBuffer(30));
            h.setUint32(0, 0x04034b50, true);
            h.setUint16(4, p.versionNeeded, true);
            h.setUint16(6, p.flag, true);
            h.setUint16(8, p.method, true);
            h.setUint16(10, 0, true);            // mod time
            h.setUint16(12, 0x21, true);         // mod date (1980-01-01)
            h.setUint32(14, p.crc, true);
            h.setUint32(18, p.compSize, true);
            h.setUint32(22, p.uncompSize, true);
            h.setUint16(26, p.nameBytes.length, true);
            h.setUint16(28, p.extra.length, true);
            chunks.push(new Uint8Array(h.buffer), p.nameBytes, p.extra, p.payload);
            records.push({ ...p, offset });
            offset += 30 + p.nameBytes.length + p.extra.length + p.payload.length;
        }

        const central = [];
        let cdSize = 0;
        for (const f of records) {
            const c = new DataView(new ArrayBuffer(46));
            c.setUint32(0, 0x02014b50, true);
            c.setUint16(4, 20, true);            // version made by
            c.setUint16(6, f.versionNeeded, true);
            c.setUint16(8, f.flag, true);
            c.setUint16(10, f.method, true);
            c.setUint16(12, 0, true);
            c.setUint16(14, 0x21, true);
            c.setUint32(16, f.crc, true);
            c.setUint32(20, f.compSize, true);
            c.setUint32(24, f.uncompSize, true);
            c.setUint16(28, f.nameBytes.length, true);
            c.setUint16(30, f.extra.length, true);
            c.setUint16(32, 0, true);            // comment length
            c.setUint16(34, 0, true);            // disk number
            c.setUint16(36, 0, true);            // internal attrs
            c.setUint32(38, 0, true);            // external attrs
            c.setUint32(42, f.offset, true);
            central.push(new Uint8Array(c.buffer), f.nameBytes, f.extra);
            cdSize += 46 + f.nameBytes.length + f.extra.length;
        }
        const eocd = new DataView(new ArrayBuffer(22));
        eocd.setUint32(0, 0x06054b50, true);
        eocd.setUint16(8, records.length, true);
        eocd.setUint16(10, records.length, true);
        eocd.setUint32(12, cdSize, true);
        eocd.setUint32(16, offset, true);
        return new Blob([...chunks, ...central, new Uint8Array(eocd.buffer)], { type: 'application/zip' });
    }

    const NO_EXTRA = new Uint8Array(0);

    function storeEntry(e) {
        return {
            nameBytes: e.nameBytes, versionNeeded: 20, flag: 0, method: 0,
            crc: crc32(e.data), compSize: e.data.length, uncompSize: e.data.length,
            extra: NO_EXTRA, payload: e.data
        };
    }

    function blob() {
        return assemble(entries.map(storeEntry));
    }

    async function generate(opts = {}) {
        const { password } = opts;
        if (!password) return blob();

        // 'standard' (ZipCrypto) | 128 | 192 | 256 (WinZip-AES). Default AES-256.
        const strength = opts.strength == null ? 256 : opts.strength;
        const prepared = [];
        for (const e of entries) {
            if (strength === 'standard') {
                const crc = crc32(e.data);
                const payload = zipCryptoEncrypt(password, e.data, crc);
                prepared.push({
                    nameBytes: e.nameBytes, versionNeeded: 20, flag: 0x0001, method: 0,
                    crc, compSize: payload.length, uncompSize: e.data.length,
                    extra: NO_EXTRA, payload
                });
            } else {
                const strengthId = strength === 128 ? 1 : strength === 192 ? 2 : 3;
                const keyLen = AES_KEY_LEN[strengthId];
                const salt = crypto.getRandomValues(new Uint8Array(AES_SALT_LEN[strengthId]));
                const derived = await pbkdf2Sha1(password, salt, keyLen * 2 + 2);
                const encKey = derived.subarray(0, keyLen);
                const macKey = derived.subarray(keyLen, keyLen * 2);
                const pwdVerify = derived.subarray(keyLen * 2, keyLen * 2 + 2);
                const cipher = aesCtrLittleEndian(encKey, e.data);
                const mac = (await hmacSha1(macKey, cipher)).subarray(0, 10);
                const payload = new Uint8Array(salt.length + 2 + cipher.length + 10);
                payload.set(salt, 0);
                payload.set(pwdVerify, salt.length);
                payload.set(cipher, salt.length + 2);
                payload.set(mac, salt.length + 2 + cipher.length);
                prepared.push({
                    nameBytes: e.nameBytes, versionNeeded: 51, flag: 0x0001, method: 99,
                    crc: 0, compSize: payload.length, uncompSize: e.data.length,
                    extra: aesExtraField(strengthId), payload
                });
            }
        }
        return assemble(prepared);
    }

    return { add, blob, generate, get count() { return entries.length; } };
}
