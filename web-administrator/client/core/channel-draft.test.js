import assert from 'node:assert/strict';
import { purgeChannelDrafts } from './channel-draft.js';

const values = new Map([
    ['webadmin.channel-draft', 'legacy secret'],
    ['webadmin.channel-draft:engine-a:1', 'secret a'],
    ['webadmin.channel-draft:engine-b:99', 'secret b'],
    ['oie-theme:engine-a:1', 'dark'],
    ['webadmin.channel-draft-unrelated', 'keep']
]);
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    get length() { return values.size; },
    key(i) { return [...values.keys()][i]; },
    removeItem(key) { values.delete(key); }
} });
purgeChannelDrafts();
purgeChannelDrafts(); // repeated boot/logout cleanup is safe
assert.deepEqual([...values], [
    ['oie-theme:engine-a:1', 'dark'], ['webadmin.channel-draft-unrelated', 'keep']
]);
Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('unavailable'); } });
assert.doesNotThrow(purgeChannelDrafts);
delete globalThis.localStorage;
console.log('channel-draft: all legacy scopes purged, unrelated preferences preserved, unavailable storage safe');
