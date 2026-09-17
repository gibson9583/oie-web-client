import assert from 'node:assert/strict';
import * as router from './router.js';

globalThis.window = new EventTarget();
globalThis.location = { pathname: '/', search: '' };
globalThis.Node = class {};
const move = (_state, _title, path) => {
    const url = new URL(path, 'https://localhost');
    location.pathname = url.pathname;
    location.search = url.search;
};
globalThis.history = { pushState: move, replaceState: move };
const outlet = { firstChild: null, appendChild() {} };
const settle = () => new Promise(resolve => setImmediate(resolve));
let disposed = 0;
let destinationLoads = 0;
router.register('/editor', () => ({ el: new Node(), teardown: () => disposed++ }));
router.register('/destination', () => { destinationLoads++; return new Node(); });

for (const verdict of [false, true, '/destination']) {
    router.setOutlet(outlet);
    router.setGuard(null);
    router.navigate('/editor');
    await settle();
    const before = disposed;
    let decide;
    router.setGuard(() => new Promise(resolve => { decide = resolve; }));
    router.navigate('/destination');
    router.setOutlet(null);
    history.replaceState(null, '', '/');
    assert.equal(disposed, before + 1, 'ending the shell disposes its active view');
    decide(verdict);
    await settle();
    assert.equal(router.currentPath(), '/', 'a departed guard cannot restore or redirect the login URL');
    assert.equal(destinationLoads, 0);
    assert.equal(disposed, before + 1);
}

// Ordinary cancellation still restores the editor while the shell is active.
router.setOutlet(outlet);
router.setGuard(null);
router.navigate('/editor');
await settle();
const before = disposed;
router.setGuard(() => false);
router.navigate('/destination');
await settle();
assert.equal(router.currentPath(), '/editor');
assert.equal(disposed, before);

let finishLoad;
let staleDisposed = 0;
router.register('/lazy', () => new Promise(resolve => { finishLoad = resolve; }));
router.setGuard(null);
router.navigate('/lazy');
router.setOutlet(null);
history.replaceState(null, '', '/');
finishLoad({ el: new Node(), teardown: () => staleDisposed++ });
await settle();
assert.equal(staleDisposed, 1, 'an already-built stale route releases its owned view');
assert.equal(router.currentPath(), '/');
router.start();
history.pushState(null, '', '/destination');
window.dispatchEvent(new Event('popstate'));
await settle();
assert.equal(destinationLoads, 0, 'history navigation cannot mount a view without a shell');

router.setOutlet(outlet);
router.navigate('/destination');
await settle();
assert.equal(destinationLoads, 1, 'a new shell can route normally');
console.log('router: pending guards/routes stop with the shell; active cancellation and remount remain intact');
