import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['web-administrator/plugins/server-log/web/session.ts'], bundle: true,
    write: false, format: 'esm', platform: 'node' });
const { ServerLogSession } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const entry = (id, message = `entry-${id}`, date = id) => ({ id, message, date: { time: date }, serverId: 'engine-one', level: 'INFO' });
const settle = () => new Promise(resolve => setImmediate(resolve));

// Hold each network response explicitly. This makes clear, pause, disposal and
// unmount boundaries independent of event-loop timing and real five-second waits.
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
    const session = new ServerLogSession((size, cursor) => new Promise((resolve, reject) => {
        requests.push({ size, cursor, resolve, reject });
    }));
    t.after(() => session.dispose());
    let unmount = session.subscribe(() => {});
    return {
        session, requests, timers,
        ids: () => session.getSnapshot().items.map(item => item.id),
        async resolve(items, index = requests.length - 1) { requests[index].resolve(items); await settle(); },
        async reject(message, index = requests.length - 1) { requests[index].reject(new Error(message)); await settle(); },
        async tick() {
            assert.equal(timers.size, 1, 'exactly one future poll is scheduled');
            const [id, run] = timers.entries().next().value;
            timers.delete(id);
            run();
            await settle();
        },
        unmount() { unmount(); },
        mount() { unmount = session.subscribe(() => {}); },
    };
}

test('clear before the first response survives failure and retries without restoring history', async t => {
    const h = harness(t);
    h.session.clear();
    await h.reject('offline');
    assert.deepEqual(h.ids(), []);
    assert.equal(h.session.getSnapshot().error, 'offline');
    await h.tick();
    assert.equal(h.requests.at(-1).cursor, null);
    await h.resolve([entry(10), entry(11)]);
    assert.deepEqual(h.ids(), []);
    assert.equal(h.session.getSnapshot().error, null);
    await h.tick();
    assert.equal(h.requests.at(-1).cursor, 11);
    await h.resolve([entry(12)]);
    assert.deepEqual(h.ids(), [12]);
});

test('repeated clear while one request is pending consumes its cursor once', async t => {
    const h = harness(t);
    await h.resolve([entry(10)]);
    await h.tick();
    h.session.clear();
    h.session.clear();
    await h.resolve([entry(11)]);
    assert.deepEqual(h.ids(), []);
    h.session.clear();
    await h.tick();
    assert.equal(h.requests.at(-1).cursor, 11);
    await h.resolve([entry(12)]);
    assert.deepEqual(h.ids(), [12]);
});

for (const result of ['success', 'failure']) {
    test(`disposing a session with a pending ${result} cannot republish data or restart polling`, async t => {
        const h = harness(t);
        h.session.setSize(5);
        h.session.togglePause();
        h.session.dispose();
        const disposed = h.session.getSnapshot();
        if (result === 'success') await h.resolve([entry(10)]);
        else await h.reject('late session failure');
        assert.equal(h.session.getSnapshot(), disposed);
        assert.deepEqual(disposed, { items: [], error: null, paused: false, logSize: 100, resetting: false });
        h.session.clear();
        h.session.togglePause();
        h.session.setSize(2);
        h.mount();
        await settle();
        assert.equal(h.session.getSnapshot(), disposed);
        assert.equal(h.requests.length, 1);
        assert.equal(h.timers.size, 0);
    });
}

test('a replacement session starts independently while the disposed session still has a response pending', async t => {
    const h = harness(t);
    h.session.clear();
    h.session.dispose();
    const calls = [];
    const replacement = new ServerLogSession(async (size, cursor) => {
        calls.push({ size, cursor });
        return [entry(1, 'new user data')];
    });
    t.after(() => replacement.dispose());
    replacement.subscribe(() => {});
    await settle();
    await h.resolve([entry(99, 'old user data')]);
    assert.deepEqual(replacement.getSnapshot().items.map(item => item.message), ['new user data']);
    assert.deepEqual(calls, [{ size: 100, cursor: null }]);
    assert.deepEqual(h.ids(), []);
});

test('an equal-ID restart with different entry identity replaces the old process buffer', async t => {
    const h = harness(t);
    await h.resolve([entry(10), entry(11)]);
    await h.tick();
    await h.resolve([]);
    assert.deepEqual({ size: h.requests.at(-1).size, cursor: h.requests.at(-1).cursor }, { size: 1, cursor: null });
    await h.resolve([entry(11, 'new process', 2000)]);
    assert.equal(h.requests.at(-1).cursor, null);
    await h.resolve([entry(10, 'new process prior', 1999), entry(11, 'new process', 2000)]);
    assert.deepEqual(h.session.getSnapshot().items.map(item => item.message), ['new process', 'new process prior']);
    await h.tick();
    assert.equal(h.requests.at(-1).cursor, 11);
    await h.resolve([entry(12, 'new process live', 2001)]);
    assert.deepEqual(h.ids(), [12, 11, 10]);
});

test('an idle engine head matching the cursor does not resurrect cleared history', async t => {
    const h = harness(t);
    await h.resolve([entry(11)]);
    h.session.clear();
    await h.tick();
    await h.resolve([]);
    await h.resolve([entry(11)]);
    assert.deepEqual(h.ids(), []);
    assert.equal(h.requests.length, 3);
    await h.tick();
    assert.equal(h.requests.at(-1).cursor, 11);
    await h.resolve([entry(12)]);
    assert.deepEqual(h.ids(), [12]);
});

test('pausing during a read freezes both rows and cursor so resume can retrieve the unread entries', async t => {
    const h = harness(t);
    await h.resolve([entry(10)]);
    await h.tick();
    h.session.togglePause();
    await h.resolve([entry(11)]);
    assert.deepEqual(h.ids(), [10]);
    assert.equal(h.timers.size, 0);
    h.session.togglePause();
    assert.equal(h.requests.at(-1).cursor, 10);
    await h.resolve([entry(11)]);
    assert.deepEqual(h.ids(), [11, 10]);
});

test('a clear may establish its pending baseline while paused without displaying those rows', async t => {
    const h = harness(t);
    h.session.clear();
    h.session.togglePause();
    await h.resolve([entry(11)]);
    assert.deepEqual(h.ids(), []);
    assert.equal(h.timers.size, 0);
    h.session.togglePause();
    assert.equal(h.requests.at(-1).cursor, 11);
    await h.resolve([entry(12)]);
    assert.deepEqual(h.ids(), [12]);
});

test('unmount stops future polling while an existing response can populate the same session for remount', async t => {
    const h = harness(t);
    h.unmount();
    await h.resolve([entry(11)]);
    assert.equal(h.timers.size, 0);
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.ids(), [11]);
    h.mount();
    assert.equal(h.requests.at(-1).cursor, 11);
    await h.resolve([entry(12)]);
    assert.deepEqual(h.ids(), [12, 11]);
    h.unmount();
    assert.equal(h.timers.size, 0);
});

test('remount and rapid pause/resume share the pending request and schedule one subsequent poll', async t => {
    const h = harness(t);
    h.unmount();
    h.mount();
    h.session.togglePause();
    h.session.togglePause();
    assert.equal(h.requests.length, 1);
    await h.resolve([entry(11)]);
    assert.equal(h.timers.size, 1);
    await h.tick();
    assert.equal(h.requests.length, 2);
    await h.resolve([entry(12)]);
    assert.deepEqual(h.ids(), [12, 11]);
    assert.equal(h.timers.size, 1);
});

test('responses apply the current size and deduplicate rows instead of using the size at request time', async t => {
    const h = harness(t);
    h.session.setSize(2);
    await h.resolve([entry(10), entry(11), entry('11'), entry(12)]);
    assert.deepEqual(h.ids(), [12, 11]);
    await h.tick();
    assert.equal(h.requests.at(-1).size, 2);
    h.session.setSize(1);
    await h.resolve([entry(13), entry(14)]);
    assert.deepEqual(h.ids(), [14]);
    assert.equal(h.session.getSnapshot().logSize, 1);
});

for (const pauseDuring of ['head', 'reload']) {
    test(`pausing during a restart ${pauseDuring} read preserves the existing buffer and cursor until resume`, async t => {
        const h = harness(t);
        await h.resolve([entry(10), entry(11)]);
        await h.tick();
        await h.resolve([]);
        if (pauseDuring === 'head') h.session.togglePause();
        await h.resolve([entry(1, 'new process')]);
        if (pauseDuring === 'reload') h.session.togglePause();
        assert.deepEqual(h.ids(), [11, 10]);
        await h.resolve([entry(1, 'new process')]);
        assert.deepEqual(h.ids(), [11, 10]);
        assert.equal(h.timers.size, 0);
        h.session.togglePause();
        assert.equal(h.requests.at(-1).cursor, 11);
        await h.resolve([]);
        await h.resolve([entry(1, 'new process')]);
        await h.resolve([entry(1, 'new process')]);
        assert.deepEqual(h.ids(), [1]);
    });
}

for (const clearDuringReload of [false, true]) {
    test(`a failed restart reload preserves the old cursor${clearDuringReload ? ' and pending clear' : ' and rows'} for retry`, async t => {
        const h = harness(t);
        await h.resolve([entry(10), entry(11)]);
        await h.tick();
        await h.resolve([]);
        await h.resolve([entry(1, 'new process')]);
        if (clearDuringReload) h.session.clear();
        await h.reject('restart reload failed');
        assert.deepEqual(h.ids(), clearDuringReload ? [] : [11, 10]);
        assert.equal(h.session.getSnapshot().error, 'restart reload failed');
        await h.tick();
        assert.equal(h.requests.at(-1).cursor, 11);
        await h.resolve([]);
        await h.resolve([entry(1, 'new process')]);
        await h.resolve([entry(1, 'new process')]);
        assert.deepEqual(h.ids(), clearDuringReload ? [] : [1]);
        assert.equal(h.session.getSnapshot().error, null);
        await h.tick();
        assert.equal(h.requests.at(-1).cursor, 1);
        await h.resolve([entry(2, 'new process live')]);
        assert.deepEqual(h.ids(), clearDuringReload ? [2] : [2, 1]);
    });
}

for (const failureStage of ['incremental', 'head', 'restart reload']) {
    for (const pendingClear of [false, true]) {
        test(`403 during ${failureStage} removes cached rows and preserves ${pendingClear ? 'pending clear' : 'cursor'} on retry`, async t => {
            const h = harness(t);
            await h.resolve([entry(10), entry(11)]);
            await h.tick();
            if (failureStage !== 'incremental') await h.resolve([]);
            if (failureStage === 'restart reload') await h.resolve([entry(1, 'restarted engine')]);
            if (pendingClear) h.session.clear();
            h.requests.at(-1).reject(Object.assign(new Error('access denied'), { status: 403 }));
            await settle();
            assert.deepEqual(h.ids(), []);
            assert.equal(h.session.getSnapshot().error, 'access denied');
            h.unmount();
            h.mount();
            assert.deepEqual(h.ids(), []);
            assert.equal(h.requests.at(-1).cursor, 11);
            const restoredId = failureStage === 'restart reload' ? 1 : 12;
            if (failureStage === 'restart reload') {
                await h.resolve([]);
                await h.resolve([entry(1, 'restarted engine')]);
            }
            await h.resolve([entry(restoredId, 'restored access')]);
            assert.deepEqual(h.ids(), pendingClear ? [] : [restoredId]);
            assert.equal(h.session.getSnapshot().error, null);
            await h.tick();
            assert.equal(h.requests.at(-1).cursor, restoredId);
            await h.resolve([entry(restoredId + 1, 'new authorized entry')]);
            assert.deepEqual(h.ids(), pendingClear ? [restoredId + 1] : [restoredId + 1, restoredId]);
        });
    }
}

test('Reset replaces the retained buffer and applies current size while preserving pause', async t => {
    const h = harness(t);
    await h.resolve([entry(10), entry(11)]);
    h.session.togglePause();
    h.session.setSize(3);
    h.session.reset();
    assert.equal(h.session.getSnapshot().resetting, true);
    assert.equal(h.requests.at(-1).cursor, null);
    assert.equal(h.requests.at(-1).size, 3);
    h.session.setSize(2);
    await h.resolve([entry(20), entry(21), entry(22)]);
    assert.deepEqual(h.ids(), [22, 21]);
    assert.equal(h.session.getSnapshot().resetting, false);
    assert.equal(h.session.getSnapshot().paused, true);
    assert.equal(h.session.getSnapshot().logSize, 2);
    assert.equal(h.timers.size, 0);
    h.session.togglePause();
    assert.equal(h.requests.at(-1).cursor, 22);
    await h.resolve([entry(23)]);
    assert.deepEqual(h.ids(), [23, 22]);
});

test('Reset after Clear wins over a pending initial clear baseline and restores retained history', async t => {
    const h = harness(t);
    h.session.clear();
    h.session.reset();
    await h.resolve([entry(10), entry(11)], 0);
    assert.deepEqual(h.ids(), []);
    assert.equal(h.requests.length, 2);
    assert.equal(h.requests.at(-1).cursor, null);
    await h.resolve([entry(10), entry(11)]);
    assert.deepEqual(h.ids(), [11, 10]);
});

test('repeated Reset coalesces and a pre-reset poll cannot publish after the reset request', async t => {
    const h = harness(t);
    await h.resolve([entry(10)]);
    await h.tick();
    const observed = [];
    h.session.subscribe(() => { observed.push(h.ids()); });
    h.session.reset();
    h.session.reset();
    h.session.reset();
    assert.equal(h.requests.length, 2, 'the reset waits for the existing read');
    await h.resolve([entry(11)], 1);
    assert.equal(h.requests.length, 3);
    assert.equal(h.requests.at(-1).cursor, null);
    h.session.reset();
    await h.resolve([entry(20)]);
    assert.deepEqual(h.ids(), [20]);
    assert.equal(h.requests.length, 3, 'repeated reset does not queue a second reload');
    assert.equal(observed.some(ids => ids.includes(11)), false, 'the superseded read never reaches observers');
    assert.equal(h.timers.size, 1);
});

test('Clear after Reset suppresses the pending historical reload and advances its cursor for live rows', async t => {
    const h = harness(t);
    await h.resolve([entry(11)]);
    h.session.reset();
    assert.equal(h.session.getSnapshot().resetting, true);
    h.session.clear();
    assert.equal(h.session.getSnapshot().resetting, false);
    await h.resolve([entry(10), entry(11)]);
    assert.deepEqual(h.ids(), []);
    await h.tick();
    assert.equal(h.requests.at(-1).cursor, 11);
    await h.resolve([entry(12)]);
    assert.deepEqual(h.ids(), [12]);
});

test('a failed Reset can be retried while paused without losing its history-restoration intent', async t => {
    const h = harness(t);
    await h.resolve([entry(11)]);
    h.session.clear();
    h.session.togglePause();
    h.session.reset();
    await h.reject('reset snapshot unavailable');
    assert.equal(h.session.getSnapshot().resetting, false);
    assert.deepEqual(h.ids(), []);
    assert.equal(h.session.getSnapshot().error, 'reset snapshot unavailable');
    assert.equal(h.session.getSnapshot().paused, true);
    assert.equal(h.timers.size, 0);
    h.session.reset();
    assert.equal(h.requests.at(-1).cursor, null);
    await h.resolve([entry(10), entry(11)]);
    assert.deepEqual(h.ids(), [11, 10]);
    assert.equal(h.session.getSnapshot().error, null);
    assert.equal(h.session.getSnapshot().paused, true);
    assert.equal(h.timers.size, 0);
});

test('disposing a session during Reset prevents its response or another Reset from reviving the session', async t => {
    const h = harness(t);
    await h.resolve([entry(11)]);
    h.session.reset();
    h.session.dispose();
    const disposed = h.session.getSnapshot();
    await h.resolve([entry(99, 'departed session secret')]);
    h.session.reset();
    assert.equal(h.session.getSnapshot(), disposed);
    assert.deepEqual(h.ids(), []);
    assert.equal(h.requests.length, 2);
    assert.equal(h.timers.size, 0);
});

test('a Reset completing while hidden updates the session buffer without starting hidden polling', async t => {
    const h = harness(t);
    await h.resolve([entry(11)]);
    h.session.reset();
    h.unmount();
    await h.resolve([entry(20)]);
    assert.deepEqual(h.ids(), [20]);
    assert.equal(h.timers.size, 0);
    h.mount();
    assert.equal(h.requests.at(-1).cursor, 20);
    await h.resolve([entry(21)]);
    assert.deepEqual(h.ids(), [21, 20]);
});

test('an empty Reset replaces stale rows and establishes zero as the cursor for a newly started stream', async t => {
    const h = harness(t);
    await h.resolve([entry(11)]);
    h.session.reset();
    await h.resolve([]);
    assert.deepEqual(h.ids(), []);
    assert.equal(h.requests.length, 2, 'an empty explicit snapshot does not need a restart probe');
    await h.tick();
    assert.equal(h.requests.at(-1).cursor, 0);
    await h.resolve([entry(1)]);
    assert.deepEqual(h.ids(), [1]);
});

test('a failed live Reset retains existing rows and retries a full snapshot on the next poll', async t => {
    const h = harness(t);
    await h.resolve([entry(11)]);
    h.session.reset();
    await h.reject('temporary snapshot failure');
    assert.deepEqual(h.ids(), [11]);
    assert.equal(h.session.getSnapshot().error, 'temporary snapshot failure');
    assert.equal(h.session.getSnapshot().resetting, false);
    await h.tick();
    assert.equal(h.requests.at(-1).cursor, null, 'retry must still restore history rather than use the old cursor');
    assert.equal(h.session.getSnapshot().resetting, true);
    await h.resolve([entry(20)]);
    assert.deepEqual(h.ids(), [20]);
    assert.equal(h.session.getSnapshot().error, null);
    assert.equal(h.session.getSnapshot().resetting, false);
});
