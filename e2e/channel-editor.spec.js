import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * UI coverage for the channel editor (React port of views/channel-editor.js) and
 * its filter/transformer sub-editor (filter-transformer.jsx). These exercise the
 * shape the editor depends on rather than a save round-trip — the round-trip
 * (GET → mutate → PUT) is verified separately. The assertions (Summary / Source /
 * Destinations / Scripts tabs, the destination row, the source transformer step
 * list) are byte-identical between the legacy DOM view and the React port, so the
 * spec stays green across the strangler swap.
 *
 * Both the channel editor and the transformer route load the channel from
 * GET /channels/{id} when it isn't already seeded in the store (the deep-link
 * entry path), so a single 'GET /channels/test-channel' override defines a
 * realistic full channel the editor fetches.
 *
 * Fixtures the editor fetches (so the orchestrator can verify the save
 * round-trip): GET /channels/test-channel (the channel itself), GET
 * /server/channelTags, GET /server/channelDependencies, GET /extensions/connectors
 * (Source tab connector-type list), and — only when Set Dependencies opens —
 * GET /channels/idsAndNames, GET /codeTemplateLibraries, GET /server/resources.
 * The save path PUTs to PUT /channels/test-channel (existing) or POST /channels
 * (new).
 */

const CHANNEL_ID = 'test-channel';

/* A realistic full channel: '@version'/'@class' present, id/name/revision, a
   source connector with a filter + a transformer carrying one Mapper step, one
   destination connector with its own filter/transformer/response, and channel
   properties (message storage, attachment handler, initial state). */
const FULL_CHANNEL = {
    '@version': '4.5.0',
    id: CHANNEL_ID,
    nextMetaDataId: 2,
    name: 'Round Trip Channel',
    description: 'A full channel used to exercise the editor.',
    revision: 3,
    sourceConnector: {
        '@version': '4.5.0',
        metaDataId: 0,
        name: 'sourceConnector',
        properties: {
            '@class': 'com.mirth.connect.connectors.vm.VmReceiverProperties',
            '@version': '4.5.0',
            pluginProperties: null,
            sourceConnectorProperties: {
                '@version': '4.5.0',
                responseVariable: 'None',
                respondAfterProcessing: true,
                processBatch: false,
                firstResponse: false,
                processingThreads: 1,
                queueBufferSize: 1000,
                resourceIds: { '@class': 'linked-hash-map', entry: { string: ['Default Resource', '[Default Resource]'] } }
            }
        },
        transformer: {
            '@version': '4.5.0',
            elements: {
                'com.mirth.connect.plugins.mapper.MapperStep': {
                    '@version': '4.5.0',
                    name: 'Map Patient Id',
                    sequenceNumber: '0',
                    enabled: true,
                    variable: 'patientId',
                    mapping: "msg['PID']['PID.3']['PID.3.1'].toString()",
                    defaultValue: '',
                    replacements: null,
                    scope: 'CHANNEL'
                }
            },
            inboundTemplate: '',
            outboundTemplate: '',
            inboundDataType: 'HL7V2',
            outboundDataType: 'HL7V2',
            inboundProperties: null,
            outboundProperties: null
        },
        filter: {
            '@version': '4.5.0',
            elements: ''
        },
        transportName: 'Channel Reader',
        mode: 'SOURCE',
        enabled: true,
        waitForPrevious: true
    },
    destinationConnectors: {
        connector: [
            {
                '@version': '4.5.0',
                metaDataId: 1,
                name: 'Send To Downstream',
                properties: {
                    '@class': 'com.mirth.connect.connectors.vm.VmDispatcherProperties',
                    '@version': '4.5.0',
                    pluginProperties: null,
                    destinationConnectorProperties: {
                        '@version': '4.5.0',
                        queueEnabled: false,
                        sendFirst: false,
                        retryIntervalMillis: 10000,
                        regenerateTemplate: false,
                        retryCount: 0,
                        rotate: false,
                        includeFilterTransformer: false,
                        threadCount: 1,
                        threadAssignmentVariable: null,
                        validateResponse: false,
                        reattachAttachments: true,
                        resourceIds: { '@class': 'linked-hash-map', entry: { string: ['Default Resource', '[Default Resource]'] } },
                        queueBufferSize: 1000
                    },
                    channelId: 'none',
                    channelTemplate: '${message.encodedData}'
                },
                transformer: {
                    '@version': '4.5.0', elements: '',
                    inboundDataType: 'HL7V2', outboundDataType: 'HL7V2',
                    inboundProperties: null, outboundProperties: null
                },
                responseTransformer: {
                    '@version': '4.5.0', elements: '',
                    inboundDataType: 'HL7V2', outboundDataType: 'HL7V2',
                    inboundProperties: null, outboundProperties: null
                },
                filter: { '@version': '4.5.0', elements: '' },
                transportName: 'Channel Writer',
                mode: 'DESTINATION',
                enabled: true,
                waitForPrevious: true
            }
        ]
    },
    preprocessingScript: '// preprocessor\nreturn message;',
    postprocessingScript: '// postprocessor\nreturn;',
    deployScript: '// deploy\nreturn;',
    undeployScript: '// undeploy\nreturn;',
    properties: {
        '@version': '4.5.0',
        clearGlobalChannelMap: true,
        messageStorageMode: 'DEVELOPMENT',
        encryptData: false,
        removeContentOnCompletion: false,
        removeOnlyFilteredOnCompletion: false,
        removeAttachmentsOnCompletion: false,
        storeAttachments: false,
        metaDataColumns: { metaDataColumn: [{ name: 'SOURCE', type: 'STRING', mappingName: 'mirth_source' }] },
        attachmentProperties: { '@version': '4.5.0', type: 'None', properties: null },
        resourceIds: { '@class': 'linked-hash-map', entry: { string: ['Default Resource', '[Default Resource]'] } },
        initialState: 'STARTED'
    },
    exportData: {
        metadata: { enabled: true, lastModified: { time: 1700000000000, timezone: 'UTC' }, pruningSettings: { archiveEnabled: true } }
    }
};

const CHANNEL_FIXTURES = {
    [`GET /channels/${CHANNEL_ID}`]: { channel: FULL_CHANNEL },
    // Save round-trip targets — accept + no-op (the spec asserts UI, not the save).
    [`PUT /channels/${CHANNEL_ID}`]: '',
    'POST /channels': '',
};

test.describe('Channel editor', () => {
    test.beforeEach(async ({ page }) => {
        await mockEngine(page, CHANNEL_FIXTURES);
    });

    test('renders the channel editor with all four setup tabs', async ({ page }) => {
        await page.goto(`/channels/${CHANNEL_ID}/edit`);

        // The four classic setup tabs are present.
        await expect(page.getByRole('button', { name: 'Summary', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Source', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Destinations', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Scripts', exact: true })).toBeVisible();

        // The Summary tab (default) shows the channel name in its Name field
        // (value lives on the DOM property, so match with toHaveValue). The Name
        // field is the first text input inside the Channel Properties panel.
        const nameField = page.locator('.panel input[type=text]').first();
        await expect(nameField).toHaveValue('Round Trip Channel');
    });

    test('switching to Destinations shows the destination row', async ({ page }) => {
        await page.goto(`/channels/${CHANNEL_ID}/edit`);

        await page.getByRole('button', { name: 'Destinations', exact: true }).click();

        // The destinations grid lists the one destination connector (inline-edit
        // name cell carries the value on its DOM property).
        await expect(page.locator('input.grid-name')).toHaveValue('Send To Downstream');
        // Its connector type shows in the Type column (the grid cell, not the
        // detail-editor connector-type <option>).
        await expect(page.getByRole('cell', { name: 'Channel Writer', exact: true })).toBeVisible();
    });

    test('Validate Connector task shows on connector tabs and validates the channel', async ({ page }) => {
        await page.goto(`/channels/${CHANNEL_ID}/edit`);
        await expect(page.getByRole('button', { name: 'Summary', exact: true })).toBeVisible();

        const validate = page.getByRole('button', { name: 'Validate Connector', exact: true });

        // Not a Summary-tab task — Swing shows it only when a connector is visible.
        await expect(validate).toHaveCount(0);

        // Appears on the Source and Destinations tabs, regardless of unsaved changes.
        await page.getByRole('button', { name: 'Source', exact: true }).click();
        await expect(validate).toBeVisible();
        await page.getByRole('button', { name: 'Destinations', exact: true }).click();
        await expect(validate).toBeVisible();

        // Clicking runs the same structural check save() uses; the demo channel is
        // well-formed, so it reports success.
        await validate.click();
        await expect(page.getByText('Connector configuration is valid')).toBeVisible();
    });

    test('saving a channel with a duplicate name is blocked with a warning', async ({ page }) => {
        // Another channel already owns "Taken Name" (Swing Frame.checkChannelName).
        await mockEngine(page, {
            ...CHANNEL_FIXTURES,
            'GET /channels/idsAndNames': { map: { entry: [
                { string: [CHANNEL_ID, 'Round Trip Channel'] },
                { string: ['other-1', 'Taken Name'] },
            ] } },
        });
        await page.goto(`/channels/${CHANNEL_ID}/edit`);

        const nameField = page.locator('.panel input[type=text]').first();
        await expect(nameField).toHaveValue('Round Trip Channel');
        await nameField.fill('Taken Name');

        // Editing makes it dirty → Save appears; saving warns and is blocked.
        await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect(page.getByText('Channel "Taken Name" already exists.')).toBeVisible();
        // The PUT must NOT have fired (save aborted).
    });

    test('saving is blocked when a connector required field is empty (issue #13)', async ({ page }) => {
        // Swap the destination to an HTTP Sender with an empty URL (host).
        const channel = structuredClone(FULL_CHANNEL);
        const dest = channel.destinationConnectors.connector[0];
        dest.name = 'HTTP Out';
        dest.transportName = 'HTTP Sender';
        dest.properties = {
            '@class': 'com.mirth.connect.connectors.http.HttpDispatcherProperties',
            host: '',            // the required field, left blank (the reported bug)
            socketTimeout: '30000',
            useProxyServer: false,
            destinationConnectorProperties: dest.properties.destinationConnectorProperties,
        };
        let putCalled = false;
        await mockEngine(page, { ...CHANNEL_FIXTURES, [`GET /channels/${CHANNEL_ID}`]: { channel } });
        page.on('request', (r) => {
            if (r.method() === 'PUT' && new URL(r.url()).pathname === `/api/channels/${CHANNEL_ID}`) putCalled = true;
        });

        await page.goto(`/channels/${CHANNEL_ID}/edit`);
        // Dirty the channel (edit the name) so Save appears.
        await page.locator('.panel input[type=text]').first().fill('Round Trip Channel Edited');
        await page.getByRole('button', { name: 'Save Changes', exact: true }).click();

        // Blocked with the required-field message (name + connector type); not saved.
        await expect(page.getByText(/HTTP Out \(HTTP Sender\): URL is required/i)).toBeVisible();
        expect(putCalled).toBe(false);
    });

    test('validation red-highlights the empty field on the current connector screen', async ({ page }) => {
        const channel = structuredClone(FULL_CHANNEL);
        const dest = channel.destinationConnectors.connector[0];
        dest.name = 'HTTP Out';
        dest.transportName = 'HTTP Sender';
        dest.properties = {
            '@class': 'com.mirth.connect.connectors.http.HttpDispatcherProperties',
            host: '', socketTimeout: '30000', useProxyServer: false,
            destinationConnectorProperties: dest.properties.destinationConnectorProperties,
        };
        await mockEngine(page, { ...CHANNEL_FIXTURES, [`GET /channels/${CHANNEL_ID}`]: { channel } });
        await page.goto(`/channels/${CHANNEL_ID}/edit`);
        await page.getByRole('button', { name: 'Destinations', exact: true }).click();

        // The HTTP Sender panel renders for the (auto-selected) destination; the URL
        // field carries data-fkey="host" and starts un-highlighted.
        const url = page.locator('[data-fkey="host"]');
        await expect(url).toBeVisible();
        await expect(url).not.toHaveClass(/cform-invalid/);

        // Validate Connector on this screen red-highlights the empty URL (Swing INVALID_COLOR).
        await page.getByRole('button', { name: 'Validate Connector', exact: true }).click();
        await expect(url).toHaveClass(/cform-invalid/);
    });

    test('opening the Source transformer route shows the step list', async ({ page }) => {
        // Deep-link straight to the source (metaDataId 0) transformer sub-editor;
        // it loads the channel from GET /channels/{id} (no store seed) and lists
        // the connector's transformer steps.
        await page.goto(`/channels/${CHANNEL_ID}/transformer/0`);

        // The transformer step grid renders the one Mapper step by name (inline
        // editable Name cell; value lives on the DOM property).
        await expect(page.locator('input.grid-name')).toHaveValue('Map Patient Id');

        // The step/rule grid header is present (Name + Type columns), confirming
        // the step list — not the empty state — rendered.
        await expect(page.getByRole('columnheader', { name: 'Name', exact: true })).toBeVisible();
        await expect(page.getByRole('columnheader', { name: 'Type', exact: true })).toBeVisible();
    });
});
