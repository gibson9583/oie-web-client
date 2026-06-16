/*
 * ZIP writer backed by @zip.js/zip.js (vendored at client/vendor/zipjs.min.js,
 * loaded lazily on first use). Supports DEFLATE + WinZip-AES (AES-128/256) and
 * traditional ZipCrypto ("Standard"), matching the engine's zip4j output so the
 * archives open in 7-Zip / WinZip / Keka / macOS Archive Utility with the
 * password.
 *
 *   const zip = createZip();
 *   zip.add('a.txt', 'hello');
 *   zip.add('bin', uint8array);
 *   const blob = await zip.blob();                            // unencrypted
 *   const blob = await zip.generate({ password, strength });  // encrypted
 *
 * strength: 128 | 256 (WinZip-AES) | 'standard' (ZipCrypto). Default AES-256.
 */

// `new URL(..., import.meta.url)` resolves to the served `/vendor/zipjs.min.js`
// in the browser and to a file path under Node (so this module is testable).
// @vite-ignore keeps the build from trying to bundle the vendored artifact —
// it's served as a static asset, like the externalized /core/* modules.
const VENDOR_URL = new URL('../vendor/zipjs.min.js', import.meta.url).href;
let libPromise = null;
function lib() {
    if (!libPromise) {
        libPromise = import(/* @vite-ignore */ VENDOR_URL).then((zipjs) => {
            zipjs.configure({ useWebWorkers: false });   // inline codec; no worker/wasm fetch
            return zipjs;
        });
    }
    return libPromise;
}

export function createZip() {
    const entries = [];   // { name, content }

    function add(name, content) {
        entries.push({ name, content });
    }

    async function build(options) {
        const zipjs = await lib();
        const writer = new zipjs.ZipWriter(new zipjs.BlobWriter('application/zip'), options);
        for (const e of entries) {
            const reader = e.content instanceof Uint8Array ? new zipjs.Uint8ArrayReader(e.content)
                : e.content instanceof Blob ? new zipjs.BlobReader(e.content)
                    : new zipjs.TextReader(String(e.content == null ? '' : e.content));
            await writer.add(e.name, reader);
        }
        return writer.close();
    }

    /** Unencrypted ZIP. */
    function blob() {
        return build({});
    }

    /** Encrypted ZIP when a password is given; otherwise plain. */
    async function generate(opts = {}) {
        if (!opts.password) return build({});
        const strength = opts.strength == null ? 256 : opts.strength;
        if (strength === 'standard') return build({ password: opts.password, zipCrypto: true });
        const encryptionStrength = strength === 128 ? 1 : strength === 192 ? 2 : 3;
        return build({ password: opts.password, encryptionStrength });
    }

    return { add, blob, generate, get count() { return entries.length; } };
}
