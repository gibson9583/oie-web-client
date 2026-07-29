/* Unit tests for the session-expired listener registry (core/api.js). */
import api, { onSessionExpired, resetSessionExpired } from './api.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.error('  FAIL -', label); } };

// Drive the 401 path without a server: every api.get goes through global fetch.
globalThis.fetch = async () => new Response('', { status: 401 });

// One background 401 fires the registered handlers, once.
async function expire() {
    resetSessionExpired();
    try { await api.get('/anything'); } catch { /* the ApiError is expected */ }
}

let a = 0, b = 0;
const offA = onSessionExpired(() => { a++; });
const offB = onSessionExpired(() => { b++; });
ok(typeof offA === 'function', 'onSessionExpired returns an unsubscribe');

await expire();
ok(a === 1 && b === 1, 'both handlers fire on a background 401');

// Unsubscribing removes only that handler — the leak this guards against is a
// component that re-registers on every mount (React StrictMode remounts the
// shell), which would otherwise fire the whole expiry flow once per mount.
offA();
await expire();
ok(a === 1, 'an unsubscribed handler stops firing');
ok(b === 2, 'its sibling still fires');

// Unsubscribing twice is a no-op, and does not disturb the others.
offA();
await expire();
ok(a === 1 && b === 3, 'double-unsubscribe is harmless');

offB();
await expire();
ok(a === 1 && b === 3, 'the last unsubscribe empties the registry');

// Re-registering the SAME function twice registers twice (no dedupe) — the
// double-fire this documents is exactly why callers must unsubscribe.
const twice = () => { a++; };
const off1 = onSessionExpired(twice);
const off2 = onSessionExpired(twice);
await expire();
ok(a === 3, 'the same handler registered twice fires twice');
off1(); off2();

console.log(`api.test: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
