import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transform } from 'esbuild';
import * as defaults from '../web-administrator/client/core/connector-defaults.js';
import { defaultSourceConnector, defaultDestinationConnector } from '../web-administrator/client/core/oie.js';
import { loadChannelForEdit, saveChannelModel } from '../web-administrator/client/core/channel-save.js';

// Run the real hook with controlled API/UI boundaries; no browser or engine.
const source = await readFile(new URL('../web-administrator/client/react/connector-type-switch.ts', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'ts', format: 'cjs' });
const { code: saveLockCode } = await transform(await readFile(new URL('../web-administrator/client/react/save-lock.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' });
function setup(mode, settings, options = {}) {
    const key = mode === 'SOURCE' ? 'sourceConnectorProperties' : 'destinationConnectorProperties';
    const factory = mode === 'SOURCE' ? defaultSourceConnector : defaultDestinationConnector;
    const connector = options.connector || factory('4.6.0');
    const calls = { changed: 0, prompts: 0, errors: 0, requests: 0 };
    const state = {};
    const lock = { exports: {} };
    // Exercise the real shared lock with only its store/DOM boundaries stubbed.
    new Function('require', 'module', 'exports', 'document', saveLockCode)(() => ({
        getState: key => state[key], setState: (key, value) => { state[key] = value; }
    }), lock, lock.exports, { querySelector: () => null, createElement: () => ({ setAttribute() {}, remove() {} }) });
    const refs = [];
    let active = true, cleanup, index = 0;
    const modules = {
        react: {
            useReducer: () => [0, () => {}], useState: () => [false, () => {}],
            useRef: value => refs[index++] ||= { current: value },
            useEffect: effect => { cleanup = effect(); }
        },
        '@oie/web-api': { server: { publicSettings: () => { calls.requests++; return settings(); } } },
        '@oie/web-shell': { platform: {
            connectorPanel: () => ({ defaults: () => factory('4.6.0').properties }),
            connectorPropertiesPanels: () => []
        } },
        '@oie/web-ui': { confirmDialog: async () => { calls.prompts++; return options.confirm?.() ?? false; }, errorModal: () => { calls.errors++; } },
        '../core/connector-defaults.js': defaults,
        './channel-persistence.js': { channelSessionActive: () => () => active },
        './save-lock.js': lock.exports
    };
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(name => modules[name], module, module.exports);
    const render = (current = connector) => {
        index = 0;
        return module.exports.useConnectorTypeSwitch(current, mode, '4.6.0', () => { calls.changed++; state.editingChannelDirty = true; });
    };
    return { connector, key, calls, render, state, ...lock.exports, expire: () => { active = false; }, unmount: () => cleanup() };
}

const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};

for (const mode of ['SOURCE', 'DESTINATION']) {
    for (const switchFirst of [true, false]) test(`${mode}: ${switchFirst ? 'switch' : 'save'} excludes the competing action and the next Save persists the switch`, async t => {
        let server = { id: `race-${mode}`, name: 'Original', revision: 1,
            sourceConnector: defaultSourceConnector('4.6.0'),
            destinationConnectors: { connector: [defaultDestinationConnector('4.6.0', 1)] },
            exportData: { metadata: { lastModified: { time: 1 }, userId: 4 } } };
        const connectorOf = channel => mode === 'SOURCE' ? channel.sourceConnector : channel.destinationConnectors.connector[0];
        const settings = deferred(), write = deferred(), writing = deferred();
        let writes = 0;
        t.mock.method(globalThis, 'fetch', async (_url, init) => {
            if (init.method === 'GET') return Response.json({ channel: server });
            server = JSON.parse(init.body).channel;
            writes++;
            writing.resolve();
            await write.promise;
            return Response.json(true);
        });
        const channel = await loadChannelForEdit(server.id);
        channel.name = 'Unrelated edit';
        const h = setup(mode, () => settings.promise, { connector: connectorOf(channel) }), hook = h.render();
        h.state.editingChannelDirty = true;
        const save = () => h.withEditorSave(async () => {
            const saved = await saveChannelModel(channel, { userId: 4, skipUnchanged: true, confirmConflict: async () => true });
            if (saved) h.state.editingChannelDirty = false;
            return saved;
        });
        let pending;
        try {
            if (switchFirst) {
                pending = hook.switchType('New');
                assert.ok(h.state.editorSave, 'the switch must hold the shared lock during settings lookup');
                assert.equal(await save(), false, 'Save cannot capture the old connector during a switch');
                assert.equal(writes, 0);
                settings.resolve({ queueBufferSize: 2048 });
                await pending;
            } else {
                pending = save();
                await writing.promise;
                const attempted = hook.switchType('New');
                assert.equal(h.calls.requests, 0, 'a switch cannot start during Save');
                assert.equal(await attempted, false);
                write.resolve();
                await pending;
                settings.resolve({ queueBufferSize: 2048 });
                await hook.switchType('New');
            }
            assert.equal(h.connector.transportName, 'New');
            assert.equal(h.state.editingChannelDirty, true);
            write.resolve();
            assert.equal(await save(), true);
            assert.equal(connectorOf(server).transportName, 'New');
            assert.equal(h.state.editingChannelDirty, false);
            assert.equal(writes, switchFirst ? 1 : 2);
            await save();
            assert.equal(writes, switchFirst ? 1 : 2, 'only a persisted switch may be skipped on retry');
        } finally { settings.resolve({ queueBufferSize: 2048 }); write.resolve(); await pending; }
    });
    for (const accepted of [false, true]) test(`${mode}: pending confirmation holds the save lock and ${accepted ? 'acceptance' : 'cancellation'} releases it`, async () => {
        const decision = deferred(), prompted = deferred();
        const h = setup(mode, async () => ({ queueBufferSize: 2048 }), {
            confirm: () => { prompted.resolve(); return decision.promise; }
        });
        h.connector.properties.custom = 'keep';
        const before = structuredClone(h.connector), pending = h.render().switchType('New');
        await prompted.promise;
        try {
            assert.equal(await h.withEditorSave(async () => assert.fail('Save ran during confirmation')), false);
            decision.resolve(accepted);
            await pending;
            if (!accepted) assert.deepEqual(h.connector, before);
            assert.equal(h.calls.changed, accepted ? 1 : 0);
            assert.equal(await h.withEditorSave(async () => true), true);
        } finally { decision.resolve(false); }
    });
    test(`${mode}: an untouched new connector inherits a non-1000 server default without confirmation`, async () => {
        const h = setup(mode, async () => ({ queueBufferSize: 2048 }));
        await h.render().switchType('New');
        assert.equal(h.connector.transportName, 'New');
        assert.equal(h.connector.properties[h.key].queueBufferSize, 2048);
        assert.deepEqual(h.calls, { changed: 1, prompts: 0, errors: 0, requests: 1 });
    });
    test(`${mode}: failed settings preserve the draft; retry fetches the recovered default`, async () => {
        let recovered = false;
        const h = setup(mode, async () => { if (!recovered) throw Error('503'); return { queueBufferSize: 2048 }; });
        const before = structuredClone(h.connector), hook = h.render();
        await hook.switchType('New');
        assert.deepEqual(h.connector, before);
        assert.deepEqual(h.calls, { changed: 0, prompts: 0, errors: 1, requests: 1 });
        assert.equal(h.state.editorSave, null, 'settings failure must release the shared lock');
        recovered = true;
        await hook.switchType('New');
        assert.equal(h.connector.transportName, 'New');
        assert.equal(h.connector.properties[h.key].queueBufferSize, 2048);
        assert.deepEqual(h.calls, { changed: 1, prompts: 0, errors: 1, requests: 2 });
    });
    for (const stale of ['unmount', 'session', 'connector', 'properties']) {
        for (const failed of [false, true]) test(`${mode}: stale ${stale} suppresses ${failed ? 'error' : 'confirmation'} dialog`, async () => {
            let resolve, reject;
            const h = setup(mode, () => new Promise((ok, fail) => { resolve = ok; reject = fail; }));
            h.connector.properties.custom = 'keep';
            const pending = h.render().switchType('New');
            if (stale === 'unmount') h.unmount();
            if (stale === 'session') h.expire();
            if (stale === 'connector') h.render(structuredClone(h.connector));
            if (stale === 'properties') h.connector.properties = { ...h.connector.properties, imported: true };
            const before = structuredClone(h.connector);
            if (failed) reject(Error('503')); else resolve({ queueBufferSize: 2048 });
            await pending;
            assert.deepEqual(h.connector, before);
            assert.deepEqual(h.calls, { changed: 0, prompts: 0, errors: 0, requests: 1 });
            assert.equal(h.state.editorSave, null, 'stale actions must release the shared lock');
        });
    }
}

// Exercise the actual advanced-dialog draft and OK handler with lightweight controls.
const editorSource = await readFile(new URL('../web-administrator/client/react/views/channel-editor.tsx', import.meta.url), 'utf8');
const queueDialogSource = editorSource.slice(editorSource.indexOf('function openAdvancedQueueSettings('), editorSource.indexOf('/* Debug deploy'));
const { code: queueDialogCode } = await transform(queueDialogSource, { loader: 'ts' });
for (const size of [0, 1000, 2048]) {
    test(`advanced queue settings preserve ${size} on cancel/OK and allow server inheritance`, () => {
        let dialog, changes = 0;
        const fields = new Map();
        const input = (value, options) => ({ value, ...options });
        const open = new Function('h', 'numberInput', 'textInput', 'field', 'modal',
            `${queueDialogCode}\nreturn openAdvancedQueueSettings;`)(() => ({}), input, input,
            (name, control) => { fields.set(name, control); return control; }, value => { dialog = value; });
        const properties = { queueEnabled: true, queueBufferSize: size };
        const before = structuredClone(properties);
        open(properties, () => { changes++; }, () => {});
        assert.equal(fields.get('Queue Buffer Size').value, size);
        fields.get('Queue Threads').onInput({ target: { value: '2' } });
        assert.deepEqual(properties, before, 'unconfirmed edits leave the connector untouched');
        assert.equal(changes, 0);
        dialog.buttons.find(button => button.label === 'OK').onClick();
        assert.equal(properties.queueBufferSize, size, 'editing another setting must preserve the queue size');
        assert.equal(properties.threadCount, 2);
        open(properties, () => { changes++; }, () => {});
        fields.get('Queue Buffer Size').onInput({ target: { value: '0' } });
        dialog.buttons.find(button => button.label === 'OK').onClick();
        assert.equal(properties.queueBufferSize, 0);
        assert.equal(changes, 2);
    });
}
