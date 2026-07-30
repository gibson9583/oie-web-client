import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';
import { CASES as CONNECTOR_CASES, makeChannel } from './connector-fixtures.js';

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
        await expect(page.getByRole('tab', { name: 'Summary', exact: true })).toBeVisible();
        await expect(page.getByRole('tab', { name: 'Source', exact: true })).toBeVisible();
        await expect(page.getByRole('tab', { name: 'Destinations', exact: true })).toBeVisible();
        await expect(page.getByRole('tab', { name: 'Scripts', exact: true })).toBeVisible();

        // The Summary tab (default) shows the channel name in its Name field
        // (value lives on the DOM property, so match with toHaveValue). The Name
        // field is the first text input inside the Channel Properties panel.
        const nameField = page.locator('.panel input[type=text]').first();
        await expect(nameField).toHaveValue('Round Trip Channel');
    });

    test('switching to Destinations shows the destination row', async ({ page }) => {
        await page.goto(`/channels/${CHANNEL_ID}/edit`);

        await page.getByRole('tab', { name: 'Destinations', exact: true }).click();

        // The destinations grid lists the one destination connector (inline-edit
        // name cell carries the value on its DOM property).
        await expect(page.locator('input.grid-name')).toHaveValue('Send To Downstream');
        // Its connector type shows in the Type column (the grid cell, not the
        // detail-editor connector-type <option>).
        await expect(page.getByRole('cell', { name: 'Channel Writer', exact: true })).toBeVisible();
    });

    test('connector settings panel shows a single (non-duplicated) settings heading', async ({ page }) => {
        await page.goto(`/channels/${CHANNEL_ID}/edit`);
        await page.getByRole('tab', { name: 'Destinations', exact: true }).click();

        // The Channel Writer dispatcher panel renders its own "Channel Writer
        // Settings" section title; the host wrapper must not add a second
        // identical header (Swing shows one titled group, not two in a row).
        await expect(page.getByText('Channel Writer Settings', { exact: true })).toHaveCount(1);
        await expect(page.locator('.panel-header', { hasText: 'Channel Writer Settings' })).toHaveCount(0);
    });

    test('Validate Connector task shows on connector tabs and validates the channel', async ({ page }) => {
        await page.goto(`/channels/${CHANNEL_ID}/edit`);
        await expect(page.getByRole('tab', { name: 'Summary', exact: true })).toBeVisible();

        const validate = page.getByRole('button', { name: 'Validate Connector', exact: true });

        // Not a Summary-tab task — Swing shows it only when a connector is visible.
        await expect(validate).toHaveCount(0);

        // Appears on the Source and Destinations tabs, regardless of unsaved changes.
        await page.getByRole('tab', { name: 'Source', exact: true }).click();
        await expect(validate).toBeVisible();
        await page.getByRole('tab', { name: 'Destinations', exact: true }).click();
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
        await page.getByRole('tab', { name: 'Destinations', exact: true }).click();

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

    // Swing BaseEditorPane.accept() runs validateAll() before returning to the
    // channel and aborts navigation when it reports an error — the web editor
    // mirrors that: "Back to Channel" validates every script-bearing step first.
    test('Back to Channel validates the transformer and blocks navigation on a script error', async ({ page }) => {
        const channel = structuredClone(FULL_CHANNEL);
        channel.sourceConnector.transformer.elements = {
            'com.mirth.connect.plugins.javascriptstep.JavaScriptStep': {
                '@version': '4.5.0', name: 'Broken Step', sequenceNumber: '0', enabled: true,
                script: 'var x = ;',
            },
        };
        await mockEngine(page, {
            ...CHANNEL_FIXTURES,
            [`GET /channels/${CHANNEL_ID}`]: { channel },
            'POST /javascript/_validate': { error: 'Error on line 1: syntax error.' },
        });
        await page.goto(`/channels/${CHANNEL_ID}/transformer/0`);
        await expect(page.locator('input.grid-name')).toHaveValue('Broken Step');

        await page.getByRole('button', { name: 'Back to Channel', exact: true }).click();

        // Blocking error modal (Swing's "Error(s)" dialog); navigation aborted.
        await expect(page.getByText('Error validating transformer steps', { exact: true })).toBeVisible();
        await expect(page.getByText(/Error in connector "sourceConnector" at transformer step 0 \("Broken Step"\)/)).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`/channels/${CHANNEL_ID}/transformer/0`));
    });

    test('Back to Channel returns to the channel when validation passes', async ({ page }) => {
        const channel = structuredClone(FULL_CHANNEL);
        channel.sourceConnector.transformer.elements = {
            'com.mirth.connect.plugins.javascriptstep.JavaScriptStep': {
                '@version': '4.5.0', name: 'Good Step', sequenceNumber: '0', enabled: true,
                script: "logger.info('ok');",
            },
        };
        await mockEngine(page, {
            ...CHANNEL_FIXTURES,
            [`GET /channels/${CHANNEL_ID}`]: { channel },
            'POST /javascript/_validate': { error: '' },
        });
        await page.goto(`/channels/${CHANNEL_ID}/transformer/0`);
        await expect(page.locator('input.grid-name')).toHaveValue('Good Step');

        await page.getByRole('button', { name: 'Back to Channel', exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`/channels/${CHANNEL_ID}/edit$`));
    });

    // The Tags field commits on the native change event only (Enter / blur /
    // datalist pick). A regression to React's per-keystroke onChange mints a
    // junk tag for every character typed and clears the input mid-word.
    test('Tags field commits a tag on Enter, not per keystroke', async ({ page }) => {
        let putBody = null;
        await page.route((url) => url.pathname === `/api/channels/${CHANNEL_ID}`, async (route) => {
            const req = route.request();
            if (req.method() === 'PUT') { putBody = req.postData(); return route.fulfill({ status: 200, contentType: 'text/plain', body: '' }); }
            return route.fallback();
        });
        await page.goto(`/channels/${CHANNEL_ID}/edit`);

        // Type character by character (real per-keystroke input events): no chip
        // may appear and the typed text must survive until the commit.
        const tagInput = page.getByPlaceholder('Add tag…');
        await tagInput.pressSequentially('prod');
        await expect(page.getByTitle('Remove tag')).toHaveCount(0);
        await expect(tagInput).toHaveValue('prod');

        // Enter commits: exactly one chip, input cleared, channel dirty.
        await tagInput.press('Enter');
        await expect(page.getByTitle('Remove tag')).toHaveCount(1);
        await expect(tagInput).toHaveValue('');

        // The one committed tag round-trips into the saved channel.
        await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect.poll(() => putBody, { timeout: 8000 }).not.toBeNull();
        const tags = JSON.parse(putBody).channel.exportData.channelTags.channelTag;
        expect(tags).toHaveLength(1);
        expect(tags[0].name).toBe('prod');
        expect(tags[0].channelIds.string).toContain(CHANNEL_ID);
    });

    // Importing a connector of the SAME transport must rebind the settings panel.
    // The transport doesn't change, so nothing remounts unless the panel host also
    // keys off the properties object — regressed, the panel keeps showing the
    // pre-import values and edits write to a detached object (lost on save).
    test('same-transport Import Connector rebinds the settings panel', async ({ page }) => {
        const ID = 'tcp-rebind';
        const tcp = CONNECTOR_CASES.find((c) => c.name === 'TCP Sender');
        const channel = makeChannel(ID, { destination: { transportName: 'TCP Sender', properties: tcp.properties() } });
        await mockEngine(page, { [`GET /channels/${ID}`]: { channel } });
        let putBody = null;
        await page.route((url) => url.pathname === `/api/channels/${ID}`, async (route) => {
            const req = route.request();
            if (req.method() === 'PUT') { putBody = req.postData(); return route.fulfill({ status: 200, contentType: 'text/plain', body: '' }); }
            return route.fallback();
        });

        await page.goto(`/channels/${ID}/edit`);
        await page.getByRole('tab', { name: 'Destinations', exact: true }).click();
        await expect(page.locator('[data-fkey="remoteAddress"]')).toHaveValue('127.0.0.1');

        // Import a TCP Sender export (same transport, different values).
        const imported = { connector: { transportName: 'TCP Sender', mode: 'DESTINATION',
            properties: { ...tcp.properties(), remoteAddress: '10.9.9.9', remotePort: '9999' } } };
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Import Connector', exact: true }).click();
        await (await chooser).setFiles({ name: 'conn.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
        await page.locator('.modal').getByRole('button', { name: 'OK', exact: true }).click();

        // The panel rebinds to the imported properties despite the unchanged transport.
        await expect(page.locator('[data-fkey="remoteAddress"]')).toHaveValue('10.9.9.9');

        // Edits after the import reach the live object — both survive the save.
        await page.locator('[data-fkey="remotePort"]').fill('7777');
        await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect.poll(() => putBody, { timeout: 8000 }).not.toBeNull();
        const sent = JSON.parse(putBody).channel.destinationConnectors.connector[0].properties;
        expect(sent.remoteAddress).toBe('10.9.9.9');
        expect(sent.remotePort).toBe('7777');
    });

    // Per-element field check (Swing checkProperties) — an Iterator with a blank
    // target must block "Back to Channel" the same way the script compile does.
    test('Back to Channel blocks on a per-element field error (blank Iterator target)', async ({ page }) => {
        const channel = structuredClone(FULL_CHANNEL);
        channel.sourceConnector.transformer.elements = {
            'com.mirth.connect.model.IteratorStep': {
                '@version': '4.5.0', name: 'For each ...', sequenceNumber: '0', enabled: true,
                properties: { target: '', indexVariable: 'i', prefixSubstitutions: '', children: '' },
            },
        };
        await mockEngine(page, { ...CHANNEL_FIXTURES, [`GET /channels/${CHANNEL_ID}`]: { channel } });
        await page.goto(`/channels/${CHANNEL_ID}/transformer/0`);
        await expect(page.locator('input.grid-name')).toHaveValue('For each ...');

        await page.getByRole('button', { name: 'Back to Channel', exact: true }).click();

        await expect(page.getByText('Error validating transformer steps', { exact: true })).toBeVisible();
        await expect(page.getByText(/The iteration target expression cannot be blank/)).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`/channels/${CHANNEL_ID}/transformer/0`));
    });

    // Cold deep link to the FILTER sub-editor of a DESTINATION connector. Only
    // the transformer variant of the filter/transformer/response trio was
    // deep-linked before; all three share one component, so the filter route
    // needs its own cold boot (and its own connector resolution: metaDataId 1,
    // not the source).
    test('opening a destination Filter route cold shows the rule grid', async ({ page }) => {
        // FULL_CHANNEL's destination filter is empty (elements: ''), which would
        // render the "No Rules Configured" landing state — seed one Rule Builder
        // rule so the grid itself is what we assert on.
        const channel = structuredClone(FULL_CHANNEL);
        channel.destinationConnectors.connector[0].filter.elements = {
            'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule': {
                '@version': '4.5.0', name: 'Accept ADT Only', sequenceNumber: '0', enabled: true,
                operator: 'NONE', field: "msg['MSH']['MSH.9']['MSH.9.1'].toString()",
                condition: 'EXISTS', values: '',
            },
        };
        await mockEngine(page, { ...CHANNEL_FIXTURES, [`GET /channels/${CHANNEL_ID}`]: { channel } });

        await page.goto(`/channels/${CHANNEL_ID}/filter/1`);

        // The rule held by the DESTINATION's filter — proves the channel was
        // fetched cold AND metaDataId 1 resolved to the right connector/target.
        await expect(page.locator('input.grid-name')).toHaveValue('Accept ADT Only', { timeout: 15_000 });

        // "Operator" is emitted only when kindName === 'filter'; the transformer
        // and response routes share this component and never render that column.
        await expect(page.getByRole('columnheader', { name: 'Operator', exact: true })).toBeVisible();

        // Filter wording throughout the view's own task pane ("Rule", not "Step").
        await expect(page.locator('.rail-pane', { hasText: 'Filter Tasks' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Add New Rule', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Validate Filter', exact: true })).toBeVisible();

        // Filter routes get a Reference-only side panel — no message-tree tabs.
        await expect(page.getByRole('tab', { name: 'Reference', exact: true })).toBeVisible();
        await expect(page.getByRole('tab', { name: 'Message Trees', exact: true })).toHaveCount(0);

        // The rule's plugin editor mounted from the RULE registry (platform.ruleType).
        await expect(page.locator('.step-editor-fill .field:has(label:text-is("Field")) input'))
            .toHaveValue("msg['MSH']['MSH.9']['MSH.9.1'].toString()");

        // Swing-parity banner, built from the fetched channel + resolved connector.
        await expect(page.locator('.view-title'))
            .toHaveText('Edit Channel - Round Trip Channel - Send To Downstream Filter');

        await expect(page).toHaveURL(new RegExp(`/channels/${CHANNEL_ID}/filter/1$`));
        expect(page.url()).not.toContain('#');
    });

    // Cold deep link to the RESPONSE transformer of a destination connector. It
    // shares a component with the filter/transformer routes but reads a third
    // target (responseTransformer) and a third connectorType ('RESPONSE'), so a
    // decoy step is planted on the plain transformer: reading the wrong target
    // surfaces the decoy and fails the grid assertion.
    test('opening a destination Response Transformer route cold shows its own step list', async ({ page }) => {
        const channel = structuredClone(FULL_CHANNEL);
        const dest = channel.destinationConnectors.connector[0];
        dest.transformer.elements = {
            'com.mirth.connect.plugins.javascriptstep.JavaScriptStep': {
                '@version': '4.5.0', name: 'Outbound Step (decoy)', sequenceNumber: '0', enabled: true,
                script: 'return;',
            },
        };
        dest.responseTransformer.elements = {
            'com.mirth.connect.plugins.mapper.MapperStep': {
                '@version': '4.5.0', name: 'Map ACK Code', sequenceNumber: '0', enabled: true,
                variable: 'ackCode', mapping: "msg['MSA']['MSA.1'].toString()",
                defaultValue: '', replacements: '', scope: 'CHANNEL',
            },
        };
        await mockEngine(page, { ...CHANNEL_FIXTURES, [`GET /channels/${CHANNEL_ID}`]: { channel } });

        await page.goto(`/channels/${CHANNEL_ID}/response/1`);

        // The RESPONSE transformer's step — never the destination transformer's decoy.
        await expect(page.locator('input.grid-name')).toHaveValue('Map ACK Code', { timeout: 15_000 });

        // Response wording in the view's own task pane — unique to kindName 'response'.
        await expect(page.locator('.rail-pane', { hasText: 'Response Transformer Tasks' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Add New Step', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Import Response Transformer', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Validate Response Transformer', exact: true })).toBeVisible();

        // Transformer-family side panel (filter routes render Reference only) …
        await expect(page.getByRole('tab', { name: 'Message Trees', exact: true })).toBeVisible();
        await expect(page.getByRole('tab', { name: 'Message Templates', exact: true })).toBeVisible();
        // … and no filter-only Operator column.
        await expect(page.getByRole('columnheader', { name: 'Operator', exact: true })).toHaveCount(0);

        // The Mapper's plugin editor mounted against the RESPONSE step.
        await expect(page.locator('.step-editor-fill .field:has(label:text-is("Variable")) input'))
            .toHaveValue('ackCode');

        // Swing-parity banner, built from the fetched channel + resolved connector.
        await expect(page.locator('.view-title'))
            .toHaveText('Edit Channel - Round Trip Channel - Send To Downstream Response Transformer');

        await expect(page).toHaveURL(new RegExp(`/channels/${CHANNEL_ID}/response/1$`));
        expect(page.url()).not.toContain('#');
    });

});
