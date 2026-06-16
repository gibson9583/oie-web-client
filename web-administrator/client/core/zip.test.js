/*
 * Round-trip test for core/zip.js — runnable with `node client/core/zip.test.js`.
 * Builds archives via createZip()/generate() and reads them back with the
 * vendored @zip.js/zip.js reader, proving the WinZip-AES / ZipCrypto output is
 * valid and decrypts to the original content (and that a wrong password fails).
 */

import { createZip } from './zip.js';
import * as zipjs from '../vendor/zipjs.min.js';

zipjs.configure({ useWebWorkers: false });

let pass = 0, fail = 0;
function ok(label, cond) { if (cond) { pass++; } else { fail++; console.error(`FAIL  ${label}`); } }

async function readBack(blob, password) {
    const reader = new zipjs.ZipReader(new zipjs.BlobReader(blob), password ? { password } : {});
    const out = {};
    for (const entry of await reader.getEntries()) {
        const bytes = await entry.getData(new zipjs.Uint8ArrayWriter());
        out[entry.filename] = new TextDecoder().decode(bytes);
    }
    await reader.close();
    return out;
}

(async () => {
    // WinZip-AES 256, multiple entries incl. a sub-folder path.
    let zip = createZip();
    zip.add('a.txt', 'hello world');
    zip.add('dir/b.txt', 'second');
    let back = await readBack(await zip.generate({ password: 'pw', strength: 256 }), 'pw');
    ok('AES-256 a.txt', back['a.txt'] === 'hello world');
    ok('AES-256 dir/b.txt', back['dir/b.txt'] === 'second');

    // WinZip-AES 128.
    zip = createZip(); zip.add('a.txt', 'one twenty eight');
    back = await readBack(await zip.generate({ password: 'pw', strength: 128 }), 'pw');
    ok('AES-128 round-trips', back['a.txt'] === 'one twenty eight');

    // Traditional ZipCrypto ("Standard").
    zip = createZip(); zip.add('a.txt', 'legacy');
    back = await readBack(await zip.generate({ password: 'pw', strength: 'standard' }), 'pw');
    ok('ZipCrypto round-trips', back['a.txt'] === 'legacy');

    // Unencrypted + binary content + count getter.
    zip = createZip(); zip.add('a.txt', 'plain'); zip.add('bin', new Uint8Array([104, 105]));
    ok('count getter', zip.count === 2);
    back = await readBack(await zip.blob());
    ok('plain text entry', back['a.txt'] === 'plain');
    ok('binary entry', back['bin'] === 'hi');

    // Wrong password must fail.
    zip = createZip(); zip.add('a.txt', 'secret');
    const enc = await zip.generate({ password: 'right', strength: 256 });
    let threw = false;
    try { await readBack(enc, 'wrong'); } catch { threw = true; }
    ok('wrong password rejected', threw);

    console.log(`zip.test: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
