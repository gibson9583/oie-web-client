import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['web-administrator/plugins/server-log/web/session.ts'], bundle: true,
    write: false, format: 'esm', platform: 'node' });
const { ServerLogSession } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const entry = (id, process = 'original') => ({ id, message: process + '-' + id, date: { time: id },
    serverId: 'engine-one', level: 'INFO' });
const rows = (head, process = 'original', first = 1) =>
    Array.from({ length: head - first + 1 }, (_, i) => entry(first + i, process));
const settle = () => new Promise(resolve => setImmediate(resolve));

// Deferred snapshots make action ordering explicit; mock only the five-second
// timer so no test waits for real polling or depends on response timing.
function harness(t) {
    const timers = new Map();
    const requests = [];
    let timerId = 0;
    t.mock.method(globalThis, 'setTimeout', (fn, delay) => {
        assert.equal(delay, 5000);
        timers.set(++timerId, fn);
        return timerId;
    });
    t.mock.method(globalThis, 'clearTimeout', id => { timers.delete(id); });
    const session = new ServerLogSession(() => new Promise((resolve, reject) => requests.push({ resolve, reject })));
    t.after(() => session.dispose());
    let unmount = session.subscribe(() => {});
    return {
        session, requests, timers,
        state: () => session.getSnapshot(),
        ids: () => session.getSnapshot().items.map(item => item.id),
        async resolve(items, index = requests.length - 1) { requests[index].resolve(items); await settle(); },
        async reject(status = 503, index = requests.length - 1) {
            requests[index].reject(Object.assign(new Error('failure-' + status), { status }));
            await settle();
        },
        async tick() {
            assert.equal(timers.size, 1, 'exactly one future poll');
            const [id, run] = timers.entries().next().value;
            timers.delete(id);
            run();
            await settle();
        },
        unmount() { unmount(); },
        mount() { unmount = session.subscribe(() => {}); },
    };
}

test('snapshots sort, deduplicate, apply the current size and do not restore trimmed history', async t => {
    const h = harness(t);
    h.session.setSize(3);
    await h.resolve([entry(2), entry('2'), entry(1), entry(3), entry('invalid')]);
    assert.deepEqual(h.ids(), [3, 2, 1]);
    await h.tick();
    h.session.setSize(1);
    await h.resolve(rows(4));
    assert.deepEqual(h.ids(), [4]);
    h.session.setSize(5);
    await h.tick();
    await h.resolve(rows(5));
    assert.deepEqual(h.ids(), [5, 4], 'growing the display only admits new rows');
    h.session.reset();
    await h.resolve(rows(5));
    assert.deepEqual(h.ids(), [5, 4, 3, 2, 1], 'Reset explicitly restores history');
});

for (const initiallyEmpty of [false, true]) {
    test('idle Clear retains its baseline, including an empty baseline: ' + initiallyEmpty, async t => {
        const h = harness(t);
        await h.resolve(initiallyEmpty ? [] : rows(3));
        h.session.clear();
        h.unmount();
        h.mount();
        await h.resolve(initiallyEmpty ? [entry(1)] : rows(4));
        assert.deepEqual(h.ids(), [initiallyEmpty ? 1 : 4]);
        await h.tick();
        await h.resolve(initiallyEmpty ? [entry(1)] : rows(4));
        assert.deepEqual(h.ids(), [initiallyEmpty ? 1 : 4]);
    });
}

test('Clear before the first response survives failure and consumes one successful baseline', async t => {
    const h = harness(t);
    h.session.clear();
    await h.reject();
    assert.deepEqual(h.ids(), []);
    assert.equal(h.state().error, 'failure-503');
    await h.tick();
    await h.resolve(rows(3));
    assert.deepEqual(h.ids(), []);
    await h.tick();
    await h.resolve(rows(4));
    assert.deepEqual(h.ids(), [4]);
    assert.equal(h.state().error, null);
});

test('repeated Clear during a request consumes its baseline once, including while paused', async t => {
    const h = harness(t);
    await h.resolve(rows(3));
    await h.tick();
    h.session.clear();
    h.session.clear();
    h.session.togglePause();
    await h.resolve(rows(4));
    assert.deepEqual(h.ids(), []);
    assert.equal(h.timers.size, 0);
    h.session.clear();
    h.session.togglePause();
    await h.resolve(rows(5));
    assert.deepEqual(h.ids(), [5]);
});

for (const restarted of [false, true]) {
    test('Pause freezes rows and cursor until resume, including restart: ' + restarted, async t => {
        const h = harness(t);
        await h.resolve(rows(3));
        await h.tick();
        h.session.togglePause();
        const next = rows(4, restarted ? 'restarted' : 'original');
        await h.resolve(next);
        assert.deepEqual(h.ids(), [3, 2, 1]);
        assert.equal(h.timers.size, 0);
        h.session.togglePause();
        await h.resolve(next);
        assert.deepEqual(h.state().items.map(item => item.message), next.reverse().map(item => item.message));
    });
}

test('remounts and rapid pause/resume share the active request; hidden views stop polling', async t => {
    const h = harness(t);
    h.unmount();
    h.mount();
    h.session.togglePause();
    h.session.togglePause();
    assert.equal(h.requests.length, 1);
    await h.resolve(rows(3));
    await h.tick();
    h.unmount();
    await h.resolve(rows(4));
    assert.deepEqual(h.ids(), [4, 3, 2, 1]);
    assert.equal(h.timers.size, 0);
    h.mount();
    await h.resolve(rows(5));
    assert.deepEqual(h.ids(), [5, 4, 3, 2, 1]);
    assert.equal(h.requests.length, 3);
    assert.equal(h.timers.size, 1);
});

test('only the final subscriber leaving stops polling', async t => {
    const h = harness(t);
    const unsubscribe = h.session.subscribe(() => {});
    assert.equal(h.requests.length, 1);
    await h.resolve(rows(2));
    h.unmount();
    assert.equal(h.timers.size, 1);
    unsubscribe();
    assert.equal(h.timers.size, 0);
});

for (const size of [1, 100]) {
    for (const context of ['live', 'remount', 'resume']) {
        for (const head of [2, 5, 6]) {
            test('restart at head ' + head + ', size ' + size + ', ' + context + ' replaces old process rows', async t => {
                const h = harness(t);
                h.session.setSize(size);
                await h.resolve(rows(5));
                if (context === 'remount') { h.unmount(); h.mount(); }
                else if (context === 'resume') { h.session.togglePause(); h.session.togglePause(); }
                else await h.tick();
                const next = rows(head, 'restarted');
                await h.resolve(next);
                assert.deepEqual(h.state().items.map(item => item.message),
                    next.reverse().slice(0, size).map(item => item.message));
                await h.tick();
                await h.resolve(rows(head + 1, 'restarted'));
                assert.equal(h.state().items[0].message, 'restarted-' + (head + 1));
            });
        }
    }
}

test('an empty snapshot preserves restart identity until a later snapshot can verify it', async t => {
    const h = harness(t);
    await h.resolve(rows(3));
    h.unmount();
    h.mount();
    await h.resolve([]);
    assert.deepEqual(h.ids(), [3, 2, 1]);
    await h.tick();
    await h.resolve(rows(4, 'restarted'));
    assert.deepEqual(h.state().items.map(item => item.message),
        ['restarted-4', 'restarted-3', 'restarted-2', 'restarted-1']);
});

test('a cursor outside the retained window does not falsely discard accumulated display rows', async t => {
    const h = harness(t);
    h.session.setSize(300);
    await h.resolve(rows(100));
    await h.tick();
    await h.resolve(rows(150, 'original', 51));
    h.unmount();
    h.mount();
    await h.resolve(rows(350, 'original', 251));
    assert.equal(h.ids().length, 250);
    assert.equal(h.ids()[0], 350);
    assert.equal(h.ids().at(-1), 1);
});

test('failed restart reads preserve Clear until one successful snapshot consumes its baseline', async t => {
    const h = harness(t);
    await h.resolve(rows(5));
    await h.tick();
    h.session.clear();
    await h.reject();
    await h.tick();
    await h.resolve(rows(2, 'restarted'));
    assert.deepEqual(h.ids(), []);
    await h.tick();
    await h.resolve(rows(3, 'restarted'));
    assert.deepEqual(h.state().items.map(item => item.message), ['restarted-3']);
});

for (const paused of [false, true]) {
    test('Reset replaces rows, applies current size and preserves pause: ' + paused, async t => {
        const h = harness(t);
        await h.resolve(rows(3));
        if (paused) h.session.togglePause();
        h.session.reset();
        h.session.setSize(2);
        assert.equal(h.state().resetting, true);
        await h.resolve(rows(6));
        assert.deepEqual(h.ids(), [6, 5]);
        assert.equal(h.state().resetting, false);
        assert.equal(h.state().paused, paused);
        assert.equal(h.timers.size, paused ? 0 : 1);
        if (paused) h.session.togglePause();
        else await h.tick();
        await h.resolve(rows(7));
        assert.deepEqual(h.ids(), [7, 6]);
    });
}

test('queued Reset coalesces and discards superseded successful rows', async t => {
    const h = harness(t);
    await h.resolve(rows(3));
    await h.tick();
    h.session.clear();
    h.session.reset();
    h.session.reset();
    assert.equal(h.requests.length, 2);
    await h.resolve(rows(4));
    assert.deepEqual(h.ids(), []);
    assert.equal(h.requests.length, 3, 'Reset requests a snapshot after the older read settles');
    h.session.reset();
    await h.resolve(rows(5));
    assert.deepEqual(h.ids(), [5, 4, 3, 2, 1]);
    assert.equal(h.requests.length, 3);
});

for (const activeRead of ['initial', 'poll', 'reset']) {
    for (const paused of [false, true]) {
        test('Clear cancels Reset behind ' + activeRead + ', paused: ' + paused, async t => {
            const h = harness(t);
            if (activeRead !== 'initial') {
                await h.resolve(rows(3));
                if (activeRead === 'poll') await h.tick();
            }
            h.session.reset();
            h.session.clear();
            if (paused) h.session.togglePause();
            const count = h.requests.length;
            await h.resolve(rows(4));
            assert.deepEqual(h.ids(), []);
            assert.equal(h.state().resetting, false);
            assert.equal(h.requests.length, count, 'Clear cancels any queued Reset');
            if (paused) h.session.togglePause();
            else await h.tick();
            await h.resolve(rows(5));
            assert.deepEqual(h.ids(), [5], 'the completed read consumes Clear; subsequent rows remain visible');
        });
    }
}

for (const actions of [['clear', 'reset', 'clear', 'reset'], ['reset', 'clear', 'reset', 'clear']]) {
    test('the final action wins: ' + actions.join(', '), async t => {
        const h = harness(t);
        actions.forEach(action => h.session[action]());
        await h.resolve(rows(3));
        assert.deepEqual(h.ids(), []);
        if (actions.at(-1) === 'reset') {
            assert.equal(h.requests.length, 2);
            await h.resolve(rows(4));
            assert.deepEqual(h.ids(), [4, 3, 2, 1]);
        } else {
            assert.equal(h.requests.length, 1);
            await h.tick();
            await h.resolve(rows(4));
            assert.deepEqual(h.ids(), [4]);
        }
        assert.equal(h.state().resetting, false);
    });
}

for (const paused of [false, true]) {
    test('failed Reset retains intent and can retry, paused: ' + paused, async t => {
        const h = harness(t);
        await h.resolve(rows(3));
        h.session.clear();
        if (paused) h.session.togglePause();
        h.session.reset();
        await h.reject();
        assert.equal(h.state().resetting, false);
        assert.equal(h.state().error, 'failure-503');
        if (paused) { assert.equal(h.timers.size, 0); h.session.reset(); }
        else await h.tick();
        assert.equal(h.state().resetting, true);
        await h.resolve(rows(4));
        assert.deepEqual(h.ids(), [4, 3, 2, 1]);
        assert.equal(h.state().error, null);
        assert.equal(h.state().paused, paused);
    });
}

test('Clear cancels a failed Reset retry without suppressing later rows', async t => {
    const h = harness(t);
    await h.resolve(rows(3));
    h.session.reset();
    await h.reject();
    h.session.clear();
    await h.tick();
    await h.resolve(rows(4));
    assert.deepEqual(h.ids(), [4]);
});

for (const lifecycle of ['live', 'paused', 'remount']) {
    for (const next of ['unchanged', 'new', 'restarted']) {
        test('Clear cancels an empty Reset: ' + lifecycle + ', next snapshot ' + next, async t => {
            const h = harness(t);
            await h.resolve(rows(3));
            if (lifecycle === 'paused') h.session.togglePause();
            h.session.reset();
            h.session.clear();
            if (lifecycle === 'remount') h.unmount();
            await h.resolve([]);
            assert.deepEqual(h.ids(), []);
            assert.equal(h.state().resetting, false);
            if (lifecycle === 'paused') h.session.togglePause();
            else if (lifecycle === 'remount') h.mount();
            else await h.tick();
            await h.resolve(rows(next === 'new' ? 4 : 3, next === 'restarted' ? 'restarted' : 'original'));
            assert.deepEqual(h.ids(), next === 'unchanged' ? [] : next === 'new' ? [4] : [3, 2, 1]);
            assert.ok(h.state().items.every(item => item.message.startsWith(next === 'restarted' ? 'restarted-' : 'original-')));
        });
    }
}

test('an empty Reset replaces stale rows and a hidden Reset does not restart polling', async t => {
    const h = harness(t);
    await h.resolve(rows(3));
    h.session.reset();
    h.unmount();
    await h.resolve([]);
    assert.deepEqual(h.ids(), []);
    assert.equal(h.state().resetting, false);
    assert.equal(h.timers.size, 0);
    h.mount();
    await h.resolve(rows(2));
    assert.deepEqual(h.ids(), [2, 1]);
});

for (const status of [403, 503]) {
    for (const pendingClear of [false, true]) {
        test('failure ' + status + ' preserves retry semantics, pending Clear: ' + pendingClear, async t => {
            const h = harness(t);
            await h.resolve(rows(3));
            await h.tick();
            if (pendingClear) { h.session.reset(); h.session.clear(); }
            await h.reject(status);
            assert.deepEqual(h.ids(), pendingClear || status === 403 ? [] : [3, 2, 1]);
            assert.equal(h.state().error, 'failure-' + status);
            h.unmount();
            h.mount();
            await h.resolve(rows(4));
            assert.deepEqual(h.ids(), pendingClear ? [] : status === 403 ? [4] : [4, 3, 2, 1]);
            await h.tick();
            await h.resolve(rows(5));
            assert.equal(h.ids()[0], 5);
            assert.equal(h.state().error, null);
        });
    }
    test('superseded failure ' + status + ' handles cached rows even when paused Reset then fails', async t => {
        const h = harness(t);
        await h.resolve(rows(3));
        await h.tick();
        h.session.togglePause();
        h.session.reset();
        await h.reject(status);
        assert.deepEqual(h.ids(), status === 403 ? [] : [3, 2, 1]);
        assert.equal(h.state().resetting, true);
        assert.equal(h.state().error, null, 'the fresh Reset owns ordinary error presentation');
        assert.equal(h.requests.length, 3);
        await h.reject();
        assert.deepEqual(h.ids(), status === 403 ? [] : [3, 2, 1]);
        assert.equal(h.state().error, 'failure-503');
        assert.equal(h.timers.size, 0);
        h.session.reset();
        await h.resolve(rows(4));
        assert.deepEqual(h.ids(), [4, 3, 2, 1]);
    });
}

for (const outcome of ['success', '403', '503']) {
    test('disposal blocks late ' + outcome + ', queued Reset and later actions without affecting a replacement', async t => {
        const h = harness(t);
        await h.resolve(rows(3));
        await h.tick();
        h.session.reset();
        h.session.dispose();
        const disposed = h.state();
        const replacement = new ServerLogSession(async () => rows(2, 'new-user'));
        t.after(() => replacement.dispose());
        replacement.subscribe(() => {});
        await settle();
        if (outcome === 'success') await h.resolve(rows(4));
        else await h.reject(Number(outcome));
        h.session.clear();
        h.session.reset();
        h.session.togglePause();
        h.session.setSize(1);
        h.mount();
        assert.equal(h.state(), disposed);
        assert.deepEqual(disposed, { items: [], paused: false, logSize: 100, error: null, resetting: false });
        assert.equal(h.requests.length, 2);
        assert.deepEqual(replacement.getSnapshot().items.map(item => item.message), ['new-user-2', 'new-user-1']);
        assert.equal(h.timers.size, 1, 'only the replacement session schedules polling');
    });
}
