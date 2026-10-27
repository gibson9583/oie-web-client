import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transform } from 'esbuild';
import { QueryClient } from '@tanstack/react-query';
import api from '../web-administrator/client/core/api.js';

const { code } = await transform(await readFile(new URL('../web-administrator/client/react/channel-list-cache.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' });

function setup() {
    const queryClient = new QueryClient();
    const module = { exports: {} };
    // Real API list normalization and TanStack storage, isolated from the UI.
    new Function('require', 'module', 'exports', code)(name => name === '@oie/web-api'
        ? { __esModule: true, default: api } : { queryClient }, module, module.exports);
    return { ...module.exports, queryClient };
}

test('navigation snapshot preserves display fields without retaining channel payloads or mutating live data', () => {
    const cache = setup();
    const data = {
        hasChannels: true,
        channels: [{ id: 'c', name: 'Display name', description: 'Description', '@class': 'InvalidChannel',
            preprocessingScript: 'PRIVATE-SCRIPT', sourceConnector: { properties: { password: 'PRIVATE-PASSWORD' },
                transformer: { inboundDataType: 'HL7V2', inboundTemplate: 'PRIVATE-MESSAGE' } },
            exportData: { metadata: { enabled: false, lastModified: { time: 123 } } } }],
        groups: [{ id: 'g', name: 'Group', description: 'Group description', channels: { channel: { id: 'c', script: 'PRIVATE-GROUP-PAYLOAD' } } }],
        tags: [{ name: 'Tag', backgroundColor: { red: 1, green: 2, blue: 3 }, channelIds: { string: 'c' } }],
        statusById: { c: { deployedRevisionDelta: 2, codeTemplatesChanged: true, deployedDate: { time: 456 }, childStatuses: [{ password: 'PRIVATE-STATUS' }] } }
    };
    const before = structuredClone(data);
    try {
        cache.cacheChannelListDisplay(data);
        const snapshot = cache.readChannelListDisplay();
        assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE-/);
        assert.deepEqual(snapshot.channels[0], { id: 'c', name: 'Display name', description: 'Description', '@class': 'InvalidChannel',
            sourceConnector: { transformer: { inboundDataType: 'HL7V2' } },
            exportData: { metadata: { enabled: false, lastModified: { time: 123 } } } });
        assert.deepEqual(snapshot.groups[0], { id: 'g', name: 'Group', description: 'Group description', channels: { channel: [{ id: 'c' }] } });
        assert.deepEqual(snapshot.tags, data.tags);
        assert.deepEqual(snapshot.statusById.c, { deployedRevisionDelta: 2, codeTemplatesChanged: true, deployedDate: { time: 456 } });
        snapshot.channels[0].name = 'Changed consumer';
        assert.equal(cache.readChannelListDisplay().channels[0].name, 'Display name');
        assert.deepEqual(data, before);
    } finally { cache.queryClient.clear(); }
});

test('session cache clearing discards even a confirmed empty snapshot', () => {
    const cache = setup();
    try {
        cache.cacheChannelListDisplay({ ...cache.emptyChannelList(), hasChannels: true });
        assert.equal(cache.readChannelListDisplay().hasChannels, true);
        cache.queryClient.clear();
        assert.deepEqual(cache.readChannelListDisplay(), cache.emptyChannelList());
    } finally { cache.queryClient.clear(); }
});
