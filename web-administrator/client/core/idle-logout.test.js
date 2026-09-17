import assert from 'node:assert/strict';
import { startIdleLogout, stopIdleLogout } from './idle-logout.js';

let now = 0, nextTimer = 0, requests = 0, idle = 0;
const timers = new Map(), listeners = new Map();
Date.now = () => now;
globalThis.setInterval = globalThis.setTimeout = (fn, delay) => {
    timers.set(++nextTimer, { fn, delay }); return nextTimer;
};
globalThis.clearInterval = globalThis.clearTimeout = id => timers.delete(id);
globalThis.window = {
    addEventListener(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); },
    removeEventListener(event, fn) { listeners.get(event)?.delete(fn); },
};
const policy = { administratorAutoLogoutIntervalEnabled: true, administratorAutoLogoutIntervalField: '1' };
let response = () => Response.json(policy);
globalThis.fetch = async () => { requests++; return response(); };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const activity = event => { for (const fn of [...(listeners.get(event) || [])]) fn(); };

response = () => new Response('offline', { status: 503 });
await startIdleLogout(() => idle++);
assert.equal(timers.size, 1, 'transient policy failure schedules recovery');
now = 60_000;
response = () => Response.json(policy);
const retry = [...timers.values()][0].fn;
timers.clear(); retry(); await flush();
assert.equal(idle, 1, 'policy recovery does not reset the user inactivity deadline');
assert.equal(timers.size, 0);

now = 0;
await startIdleLogout(() => idle++);
now = 59_000; activity('pointerdown');
now = 61_000; [...timers.values()][0].fn();
assert.equal(idle, 1, 'real input extends the idle window');
now = 120_000; activity('keydown');
assert.equal(idle, 2, 'first input after a suspended deadline locks before renewing activity');

let release;
response = () => new Promise(resolve => { release = resolve; });
const pending = startIdleLogout(() => idle++);
stopIdleLogout();
response = () => Response.json({ ...policy, administratorAutoLogoutIntervalEnabled: false });
await startIdleLogout(() => idle++);
release(Response.json(policy)); await pending;
assert.equal(timers.size, 0, 'old policy responses cannot resurrect timers after stop/re-login');

response = () => new Response('not supported', { status: 404 });
await startIdleLogout(() => idle++);
assert.equal(timers.size, 0, 'an explicitly unsupported endpoint does not retry');
response = () => Response.json({ ...policy, administratorAutoLogoutIntervalField: '1minute' });
await startIdleLogout(() => idle++);
assert.equal(timers.size, 1, 'malformed enabled policy is retried, never treated as disabled');
stopIdleLogout();
assert.equal(timers.size, 0);
assert.equal([...listeners.values()].reduce((sum, value) => sum + value.size, 0), 0);
assert.ok(requests >= 7);
console.log('idle-logout: recovery, deadline, real input, stale policy, and cleanup passed');
