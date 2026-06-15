/*
 * Minimal AES block cipher (ECB encrypt only), 128/192/256-bit keys.
 *
 * Used solely to generate the CTR keystream for WinZip-AES ZIP encryption
 * (see core/zip.js). WebCrypto can't be used for this: WinZip increments the
 * 16-byte counter as a *little-endian* integer, whereas WebCrypto's AES-CTR
 * increments big-endian, so the keystreams don't match. PBKDF2 and HMAC are
 * still done with WebCrypto — only the raw block encryption lives here.
 *
 * Standard table-free implementation (S-box + GF(2^8) MixColumns).
 */

function xtime(a) { return ((a << 1) ^ ((a & 0x80) ? 0x11b : 0)) & 0xff; }

// S-box, built once from the multiplicative inverse + affine transform.
const SBOX = (() => {
    const log = new Uint8Array(256);
    const exp = new Uint8Array(256);
    let x = 1;
    for (let i = 0; i < 255; i++) {
        exp[i] = x;
        log[x] = i;
        x ^= xtime(x);            // x *= 3 (generator)
    }
    const inv = (b) => (b === 0 ? 0 : exp[(255 - log[b]) % 255]);
    const box = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
        let s = inv(i);
        let r = s;
        for (let k = 0; k < 4; k++) { r = ((r << 1) | (r >> 7)) & 0xff; s ^= r; }
        box[i] = s ^ 0x63;
    }
    return box;
})();

const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36, 0x6c, 0xd8, 0xab, 0x4d];

/* Expand a 16/24/32-byte key into round-key words (each a 4-byte array). */
export function aesKeySchedule(key) {
    const Nk = key.length / 4;       // 4, 6, 8
    const Nr = Nk + 6;               // 10, 12, 14
    const w = new Array(4 * (Nr + 1));
    for (let i = 0; i < Nk; i++) {
        w[i] = [key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]];
    }
    for (let i = Nk; i < w.length; i++) {
        let t = w[i - 1].slice();
        if (i % Nk === 0) {
            t = [t[1], t[2], t[3], t[0]].map(b => SBOX[b]);   // RotWord + SubWord
            t[0] ^= RCON[i / Nk - 1];
        } else if (Nk > 6 && i % Nk === 4) {
            t = t.map(b => SBOX[b]);                          // SubWord
        }
        const prev = w[i - Nk];
        w[i] = [prev[0] ^ t[0], prev[1] ^ t[1], prev[2] ^ t[2], prev[3] ^ t[3]];
    }
    return { w, Nr };
}

/* Encrypt one 16-byte block (ECB). Returns a new Uint8Array(16). */
export function aesEncryptBlock(sched, input) {
    const { w, Nr } = sched;
    // state[r][c], column-major load
    const s = [new Array(4), new Array(4), new Array(4), new Array(4)];
    for (let i = 0; i < 16; i++) s[i & 3][i >> 2] = input[i];

    const addRoundKey = (round) => {
        for (let c = 0; c < 4; c++) {
            const k = w[4 * round + c];
            s[0][c] ^= k[0]; s[1][c] ^= k[1]; s[2][c] ^= k[2]; s[3][c] ^= k[3];
        }
    };

    addRoundKey(0);
    for (let round = 1; round < Nr; round++) {
        for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) s[r][c] = SBOX[s[r][c]];   // SubBytes
        for (let r = 1; r < 4; r++) {                                                       // ShiftRows
            const row = s[r].slice();
            for (let c = 0; c < 4; c++) s[r][c] = row[(c + r) & 3];
        }
        for (let c = 0; c < 4; c++) {                                                       // MixColumns
            const a0 = s[0][c], a1 = s[1][c], a2 = s[2][c], a3 = s[3][c];
            s[0][c] = xtime(a0) ^ (xtime(a1) ^ a1) ^ a2 ^ a3;
            s[1][c] = a0 ^ xtime(a1) ^ (xtime(a2) ^ a2) ^ a3;
            s[2][c] = a0 ^ a1 ^ xtime(a2) ^ (xtime(a3) ^ a3);
            s[3][c] = (xtime(a0) ^ a0) ^ a1 ^ a2 ^ xtime(a3);
        }
        addRoundKey(round);
    }
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) s[r][c] = SBOX[s[r][c]];        // SubBytes
    for (let r = 1; r < 4; r++) {                                                            // ShiftRows
        const row = s[r].slice();
        for (let c = 0; c < 4; c++) s[r][c] = row[(c + r) & 3];
    }
    addRoundKey(Nr);

    const out = new Uint8Array(16);
    for (let i = 0; i < 16; i++) out[i] = s[i & 3][i >> 2];
    return out;
}
