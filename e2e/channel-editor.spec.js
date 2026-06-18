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
        await page.goto(`/#/channels/${CHANNEL_ID}/edit`);

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
        await page.goto(`/#/channels/${CHANNEL_ID}/edit`);

        await page.getByRole('button', { name: 'Destinations', exact: true }).click();

        // The destinations grid lists the one destination connector (inline-edit
        // name cell carries the value on its DOM property).
        await expect(page.locator('input.grid-name')).toHaveValue('Send To Downstream');
        // Its connector type shows in the Type column (the grid cell, not the
        // detail-editor connector-type <option>).
        await expect(page.getByRole('cell', { name: 'Channel Writer', exact: true })).toBeVisible();
    });

    test('opening the Source transformer route shows the step list', async ({ page }) => {
        // Deep-link straight to the source (metaDataId 0) transformer sub-editor;
        // it loads the channel from GET /channels/{id} (no store seed) and lists
        // the connector's transformer steps.
        await page.goto(`/#/channels/${CHANNEL_ID}/transformer/0`);

        // The transformer step grid renders the one Mapper step by name (inline
        // editable Name cell; value lives on the DOM property).
        await expect(page.locator('input.grid-name')).toHaveValue('Map Patient Id');

        // The step/rule grid header is present (Name + Type columns), confirming
        // the step list — not the empty state — rendered.
        await expect(page.getByRole('columnheader', { name: 'Name', exact: true })).toBeVisible();
        await expect(page.getByRole('columnheader', { name: 'Type', exact: true })).toBeVisible();
    });
});
