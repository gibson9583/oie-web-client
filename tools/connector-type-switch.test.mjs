import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transform } from 'esbuild';
import * as defaults from '../web-administrator/client/core/connector-defaults.js';
import { defaultSourceConnector, defaultDestinationConnector } from '../web-administrator/client/core/oie.js';

// Run the real hook with controlled API/UI boundaries; no browser or engine.
const source = await readFile(new URL('../web-administrator/client/react/connector-type-switch.ts', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'ts', format: 'cjs' });
function setup(mode, settings) {
    const key = mode === 'SOURCE' ? 'sourceConnectorProperties' : 'destinationConnectorProperties';
    const factory = mode === 'SOURCE' ? defaultSourceConnector : defaultDestinationConnector;
    const connector = factory('4.6.0');
    const calls = { changed: 0, prompts: 0, errors: 0, requests: 0 };
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
        '@oie/web-ui': { confirmDialog: async () => { calls.prompts++; return false; }, errorModal: () => { calls.errors++; } },
        '../core/connector-defaults.js': defaults,
        './channel-persistence.js': { channelSessionActive: () => () => active }
    };
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(name => modules[name], module, module.exports);
    const render = (current = connector) => {
        index = 0;
        return module.exports.useConnectorTypeSwitch(current, mode, '4.6.0', () => { calls.changed++; });
    };
    return { connector, key, calls, render, expire: () => { active = false; }, unmount: () => cleanup() };
}

for (const mode of ['SOURCE', 'DESTINATION']) {
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
