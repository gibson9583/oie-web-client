import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * Serialization safety net for the React channel editor: load a full channel,
 * make one edit, Save, and assert the PUT body round-trips the whole channel
 * (source connector + @class, the transformer's Mapper step, the destination,
 * channel properties, @version) with revision bumped and the edit applied.
 * The save path reuses the legacy serialization verbatim, so this proves the
 * JSX port did not drop/corrupt any of it (which would break channel deploys).
 */

const CHANNEL_ID = 'rt-channel';

const FULL_CHANNEL = {
    '@version': '4.5.0', id: CHANNEL_ID, nextMetaDataId: 2, name: 'RT Channel',
    description: 'desc', revision: 3,
    sourceConnector: {
        '@version': '4.5.0', metaDataId: 0, name: 'sourceConnector',
        properties: {
            '@class': 'com.mirth.connect.connectors.vm.VmReceiverProperties', '@version': '4.5.0',
            pluginProperties: null,
            sourceConnectorProperties: { '@version': '4.5.0', responseVariable: 'None', respondAfterProcessing: true, processBatch: false, firstResponse: false, processingThreads: 1, queueBufferSize: 1000, resourceIds: { '@class': 'linked-hash-map', entry: { string: ['Default Resource', '[Default Resource]'] } } }
        },
        transformer: {
            '@version': '4.5.0',
            elements: { 'com.mirth.connect.plugins.mapper.MapperStep': { '@version': '4.5.0', name: 'Map Patient Id', sequenceNumber: '0', enabled: true, variable: 'patientId', mapping: "msg['PID']['PID.3']['PID.3.1'].toString()", defaultValue: '', replacements: null, scope: 'CHANNEL' } },
            inboundTemplate: '', outboundTemplate: '', inboundDataType: 'HL7V2', outboundDataType: 'HL7V2', inboundProperties: null, outboundProperties: null
        },
        filter: { '@version': '4.5.0', elements: '' },
        transportName: 'Channel Reader', mode: 'SOURCE', enabled: true, waitForPrevious: true
    },
    destinationConnectors: {
        connector: [{
            '@version': '4.5.0', metaDataId: 1, name: 'Send To Downstream',
            properties: { '@class': 'com.mirth.connect.connectors.vm.VmDispatcherProperties', '@version': '4.5.0', pluginProperties: null, destinationConnectorProperties: { '@version': '4.5.0', queueEnabled: false, sendFirst: false, retryIntervalMillis: 10000, regenerateTemplate: false, retryCount: 0, rotate: false, includeFilterTransformer: false, threadCount: 1, threadAssignmentVariable: null, validateResponse: false, reattachAttachments: true, resourceIds: { '@class': 'linked-hash-map', entry: { string: ['Default Resource', '[Default Resource]'] } }, queueBufferSize: 1000 }, channelId: 'none', channelTemplate: '${message.encodedData}' },
            transformer: { '@version': '4.5.0', elements: '', inboundDataType: 'HL7V2', outboundDataType: 'HL7V2', inboundProperties: null, outboundProperties: null },
            responseTransformer: { '@version': '4.5.0', elements: '', inboundDataType: 'HL7V2', outboundDataType: 'HL7V2', inboundProperties: null, outboundProperties: null },
            filter: { '@version': '4.5.0', elements: '' }, transportName: 'Channel Writer', mode: 'DESTINATION', enabled: true, waitForPrevious: true
        }]
    },
    preprocessingScript: 'return message;', postprocessingScript: 'return;', deployScript: 'return;', undeployScript: 'return;',
    properties: { '@version': '4.5.0', clearGlobalChannelMap: true, messageStorageMode: 'DEVELOPMENT', encryptData: false, removeContentOnCompletion: false, removeOnlyFilteredOnCompletion: false, removeAttachmentsOnCompletion: false, storeAttachments: false, metaDataColumns: { metaDataColumn: [{ name: 'SOURCE', type: 'STRING', mappingName: 'mirth_source' }] }, attachmentProperties: { '@version': '4.5.0', type: 'None', properties: null }, resourceIds: { '@class': 'linked-hash-map', entry: { string: ['Default Resource', '[Default Resource]'] } }, initialState: 'STARTED' },
    // A stored last-modified marks this a HEALTHY channel: the editor's concurrent-
    // edit guard applies (override=false + startEdit on save). Channels without one
    // are unguardable — the engine substitutes "now" for a missing stored value, so
    // the check always false-positives — and take the skip path (see the test below).
    exportData: { metadata: { enabled: true, lastModified: { time: 1751000000000, timezone: 'America/New_York' } }, channelTags: null }
};

test('channel save round-trips the full channel (serialization preserved)', async ({ page }) => {
    await mockEngine(page, { [`GET /channels/${CHANNEL_ID}`]: { channel: FULL_CHANNEL } });

    // Capture the PUT body; fall through to the mock for everything else.
    let putBody = null;
    await page.route((url) => url.pathname === `/api/channels/${CHANNEL_ID}`, async (route) => {
        const req = route.request();
        if (req.method() === 'PUT') { putBody = req.postData(); return route.fulfill({ status: 200, contentType: 'text/plain', body: '' }); }
        return route.fallback();
    });

    await page.goto(`/channels/${CHANNEL_ID}/edit`);
    await expect(page.getByRole('button', { name: 'Summary', exact: true })).toBeVisible();

    // One edit (Name) to dirty the channel so Save Changes appears.
    const nameField = page.locator('.panel input[type=text]').first();
    await expect(nameField).toHaveValue('RT Channel');
    await nameField.fill('RT Channel EDITED');

    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect.poll(() => putBody, { timeout: 8000 }).not.toBeNull();

    const sent = JSON.parse(putBody).channel;
    // The edit applied + revision bumped.
    expect(sent.name).toBe('RT Channel EDITED');
    expect(Number(sent.revision)).toBe(4);
    // @version preserved.
    expect(sent['@version']).toBe('4.5.0');
    // Source connector + its @class preserved.
    expect(sent.sourceConnector).toBeTruthy();
    expect(sent.sourceConnector.properties['@class']).toBe('com.mirth.connect.connectors.vm.VmReceiverProperties');
    // Transformer Mapper step preserved (not dropped/corrupted).
    const tx = JSON.stringify(sent.sourceConnector.transformer.elements);
    expect(tx).toContain('MapperStep');
    expect(tx).toContain('Map Patient Id');
    // Destination preserved.
    const dests = sent.destinationConnectors.connector;
    const destArr = Array.isArray(dests) ? dests : [dests];
    expect(destArr).toHaveLength(1);
    expect(destArr[0].name).toBe('Send To Downstream');
    expect(destArr[0].properties['@class']).toBe('com.mirth.connect.connectors.vm.VmDispatcherProperties');
    // Channel properties preserved.
    expect(sent.properties.messageStorageMode).toBe('DEVELOPMENT');
});

test('a conflicting save prompts "Channel Modified" and Overwrite retries with override=true', async ({ page }) => {
    await mockEngine(page, { [`GET /channels/${CHANNEL_ID}`]: { channel: FULL_CHANNEL } });

    // First save attempt goes out with override=false + a startEdit timestamp (the
    // engine's modified-since-opened check). Answer "false" = conflict; the retry
    // after Overwrite must carry override=true.
    const puts = [];
    await page.route((url) => url.pathname === `/api/channels/${CHANNEL_ID}`, async (route) => {
        const req = route.request();
        if (req.method() === 'PUT') {
            const params = new URL(req.url()).searchParams;
            puts.push({ override: params.get('override'), startEdit: params.get('startEdit') });
            const conflict = params.get('override') !== 'true';
            return route.fulfill({ status: 200, contentType: 'application/json', body: conflict ? 'false' : 'true' });
        }
        return route.fallback();
    });

    await page.goto(`/channels/${CHANNEL_ID}/edit`);
    const nameField = page.locator('.panel input[type=text]').first();
    await expect(nameField).toHaveValue('RT Channel');
    await nameField.fill('RT Channel EDITED');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();

    // Swing-parity prompt appears; the conflicting attempt sent override=false + startEdit.
    await expect(page.getByText('This channel has been modified since you first opened it', { exact: false })).toBeVisible();
    expect(puts).toHaveLength(1);
    expect(puts[0].override).toBe('false');
    // The engine parses startEdit with SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssZ"):
    // NO milliseconds (they make the parse throw and the check silently degrade),
    // RFC-822 zone. The client sends UTC (+0000).
    expect(puts[0].startEdit).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+0000$/);

    await page.getByRole('button', { name: 'Overwrite', exact: true }).click();
    await expect.poll(() => puts.length, { timeout: 8000 }).toBe(2);
    expect(puts[1].override).toBe('true');
    await expect(page.getByText('Saved RT Channel EDITED')).toBeVisible();
});

test('a channel with no stored last-modified saves once WITHOUT the guard (override=true, no prompt)', async ({ page }) => {
    // Channels created/saved before the client stamped lastModified have no stored
    // value; the engine substitutes "now" when it's absent, so an override=false
    // save would ALWAYS false-positive. The editor detects the missing timestamp
    // and skips the check for that first save — which also stamps a real
    // last-modified, healing the channel so the guard applies afterwards.
    const { exportData, ...UNGUARDED_CHANNEL } = FULL_CHANNEL;
    await mockEngine(page, { [`GET /channels/${CHANNEL_ID}`]: { channel: UNGUARDED_CHANNEL } });

    const puts = [];
    await page.route((url) => url.pathname === `/api/channels/${CHANNEL_ID}`, async (route) => {
        const req = route.request();
        if (req.method() === 'PUT') {
            const params = new URL(req.url()).searchParams;
            puts.push({ override: params.get('override'), body: JSON.parse(req.postData()).channel });
            return route.fulfill({ status: 200, contentType: 'application/json', body: 'true' });
        }
        return route.fallback();
    });

    await page.goto(`/channels/${CHANNEL_ID}/edit`);
    const nameField = page.locator('.panel input[type=text]').first();
    await expect(nameField).toHaveValue('RT Channel');
    await nameField.fill('RT Channel EDITED');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();

    await expect(page.getByText('Saved RT Channel EDITED')).toBeVisible();
    // Exactly one PUT, guard skipped, and NO "Channel Modified" prompt.
    expect(puts).toHaveLength(1);
    expect(puts[0].override).toBe('true');
    await expect(page.getByText('This channel has been modified', { exact: false })).not.toBeVisible();
    // The save healed the channel: a real last-modified was stamped into the body.
    expect(puts[0].body.exportData.metadata.lastModified.time).toBeGreaterThan(0);
});
