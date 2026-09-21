import assert from 'node:assert/strict';

const values = new Map();
globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
};
globalThis.document = { querySelector: selector => selector.includes('app-base') ? { content: '/nested/admin' } : null };
const { migrateLegacyCache } = await import('./cache-migration.js');
const marker = 'oie-http-cache-migration-v1:/nested/admin/';
const success = () => new Response(null, { status: 204, headers: { 'X-OIE-Cache-Migration': '1' } });
let calls = 0, reply;
globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, '/nested/admin/webadmin/cache-reset');
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers['X-Requested-With'], 'OpenIntegrationEngine-WebAdmin');
    return reply();
};

let release;
reply = () => new Promise(resolve => { release = resolve; });
const pending = migrateLegacyCache();
assert.equal(migrateLegacyCache(), pending, 'overlapping mounts share cleanup');
assert.equal(calls, 1);
assert.equal(values.has(marker), false, 'a pending cleanup must not suppress future retries');
release(success());
await pending;
assert.equal(values.get(marker), 'done');
await migrateLegacyCache();
assert.equal(calls, 1, 'completed cleanup is skipped on later mounts');

for (const failure of [
    () => { throw new Error('offline'); },
    () => new Response(null, { status: 503 }),
    () => new Response(null, { status: 204 }),
    () => ({ status: 204, headers: new Headers({ 'X-OIE-Cache-Migration': '1' }), text: async () => { throw new Error('lost response'); } }),
]) {
    values.clear();
    reply = failure;
    await assert.rejects(migrateLegacyCache());
    assert.equal(values.has(marker), false, 'failure is not checkpointed');
    reply = success;
    await migrateLegacyCache();
    assert.equal(values.get(marker), 'done', 'a failed attempt releases its in-flight guard');
}

values.clear();
globalThis.localStorage = {
    getItem: () => { throw new Error('storage blocked'); },
    setItem: () => { throw new Error('storage blocked'); },
};
const before = calls;
await migrateLegacyCache();
await migrateLegacyCache();
assert.equal(calls, before + 2, 'unavailable storage cannot prevent cleanup or falsely record completion');
console.log('cache-migration: context paths, concurrent mounts, completion, failure retries and unavailable storage passed');
