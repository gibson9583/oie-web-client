import { test, expect } from './base.js';
import { mockEngine, fixtureXml as xml } from './mock.js';
import AxeBuilder from '@axe-core/playwright';

/*
 * The channel editor's read-only Inspector tab: the channel described in
 * engine order, destination chains, find, map-key links and the Channels
 * "Inspect Channel" entry point.
 */

const ID = 'inspect-channel';
const V = '4.6.0';
const MAPPER = 'com.mirth.connect.plugins.mapper.MapperStep';
const JS_STEP = 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep';
const RULE = 'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule';
const queue = (extra = {}) => ({ '@version': V, queueEnabled: false, sendFirst: false, retryIntervalMillis: 10000, retryCount: 0, rotate: false, threadCount: 1, validateResponse: false, ...extra });
const transformer = (elements: any = '') => ({ '@version': V, elements, inboundDataType: 'HL7V2', outboundDataType: 'HL7V2', inboundProperties: null, outboundProperties: null });
const tcpSender = (metaDataId: number, name: string, extra: any = {}) => ({
    '@version': V, metaDataId, name, transportName: 'TCP Sender', mode: 'DESTINATION', enabled: true, waitForPrevious: true,
    properties: {
        '@class': 'com.mirth.connect.connectors.tcp.TcpDispatcherProperties', '@version': V,
        remoteAddress: 'ehr.example', remotePort: '2575', serverMode: false, keepConnectionOpen: true,
        transmissionModeProperties: { pluginPointName: 'MLLP' },
        destinationConnectorProperties: queue()
    },
    filter: { '@version': V, elements: '' }, transformer: transformer(), responseTransformer: transformer(),
    ...extra
});

const CHANNEL: any = {
    '@version': V, id: ID, nextMetaDataId: 4, name: 'Lab results', revision: 12,
    description: 'Normalizes lab results for clinical storage and EHR delivery.',
    sourceConnector: {
        '@version': V, metaDataId: 0, name: 'sourceConnector', transportName: 'TCP Listener', mode: 'SOURCE', enabled: true, waitForPrevious: true,
        properties: {
            '@class': 'com.mirth.connect.connectors.tcp.TcpReceiverProperties', '@version': V,
            listenerConnectorProperties: { host: '0.0.0.0', port: '6663' }, serverMode: true,
            transmissionModeProperties: { pluginPointName: 'MLLP' },
            sourceConnectorProperties: { '@version': V, responseVariable: 'd2', respondAfterProcessing: true, processBatch: false, processingThreads: 1 }
        },
        filter: { '@version': V, elements: { [RULE]: { '@version': V, name: 'Results only', sequenceNumber: '0', enabled: true, operator: 'NONE', field: "msg['MSH']['MSH.9']['MSH.9.1']", condition: 'EQUALS', values: { string: "'ORU'" } } } },
        transformer: transformer({
            [MAPPER]: { '@version': V, name: 'Read facility', sequenceNumber: '0', enabled: true, variable: 'facility', mapping: "msg['MSH']['MSH.4']", scope: 'CHANNEL' },
            [JS_STEP]: { '@version': V, name: 'Route training', sequenceNumber: '1', enabled: true, script: "if ($c('facility') == 'TRAINING') destinationSet.remove(3);\nvar t = $g('alertThreshold');" }
        })
    },
    destinationConnectors: { connector: [
        tcpSender(1, 'Clinical store', { waitForPrevious: false }),
        tcpSender(2, 'EHR delivery'),
        tcpSender(3, 'Analytics API', { waitForPrevious: false, properties: { '@class': 'com.mirth.connect.connectors.http.HttpDispatcherProperties', '@version': V, host: 'https://analytics.example/results', method: 'post', destinationConnectorProperties: queue({ queueEnabled: true, sendFirst: true, retryIntervalMillis: 60000 }) }, transportName: 'HTTP Sender' }),
        tcpSender(4, 'Legacy archive', { enabled: false })
    ] },
    preprocessingScript: '// Modify the message variable below to pre process data\nreturn message;',
    postprocessingScript: '// This script executes once after a message has been processed\nreturn;',
    deployScript: '// deploy\nreturn;',
    undeployScript: '// undeploy\nreturn;',
    properties: {
        '@version': V, messageStorageMode: 'PRODUCTION', encryptData: false, removeContentOnCompletion: false, initialState: 'STARTED',
        attachmentProperties: { '@version': V, type: 'None', properties: null },
        metaDataColumns: { metaDataColumn: [{ name: 'SOURCE', type: 'STRING', mappingName: 'mirth_source' }] }
    },
    exportData: { metadata: { enabled: true, lastModified: { time: 1700000000000, timezone: 'UTC' }, pruningSettings: { pruneMetaDataDays: 90, archiveEnabled: true } } }
};

test.describe('Channel Inspector', () => {
    test.beforeEach(async ({ page }) => {
        await mockEngine(page, { [`GET /channels/${ID}`]: { channel: CHANNEL } });
    });

    test('opens as the first editor tab and reads in engine order', async ({ page }) => {
        await page.goto(`/channels/${ID}/edit?tab=Inspector`);
        const tabs = page.getByRole('tablist', { name: 'Channel sections' }).getByRole('tab');
        await expect(tabs.first()).toHaveText('Inspector');
        await expect(page.getByRole('tab', { name: 'Inspector', exact: true })).toHaveAttribute('aria-selected', 'true');

        await expect(page.getByText('Normalizes lab results for clinical storage and EHR delivery.')).toBeVisible();
        await expect(page.getByText('Includes the latest saved global scripts.')).toBeVisible();
        const sections = page.locator('.ci-section-head .ci-section-title');
        await expect(sections).toHaveText([
            'Prepare the channel', 'Receive HL7 v2.x over TCP Listener', 'Preprocess the raw message', 'Accept or filter the message',
            'Transform the HL7 v2.x message', 'Send to destinations', 'Postprocess', 'Respond to the sender',
            'Retry queued sends', 'Store and prune messages', 'Maps and variables'
        ]);
        // Default hooks are still configured source, including their comments.
        await expect(page.locator('#ci-preprocess')).not.toHaveClass(/empty/);
        await expect(page.locator('#ci-deploy .ci-name')).toHaveText(['Global deploy script', 'Deploy script', 'Undeploy script', 'Global undeploy script']);
        await page.getByRole('button', { name: 'Expand all', exact: true }).click();
        await expect(page.locator('#ci-preprocess .ci-code .lc')).toHaveText(['return message;', ...CHANNEL.preprocessingScript.split('\n')]);
        await expect(page.locator('#ci-deploy .ci-code .lc')).toHaveText(['return;', ...CHANNEL.deployScript.split('\n'), ...CHANNEL.undeployScript.split('\n'), 'return;']);
        await expect(page.locator('#ci-postprocess .ci-code .lc')).toHaveText([...CHANNEL.postprocessingScript.split('\n'), 'return;']);

        // Chains follow waitForPrevious; disabled destinations are separate.
        const map = page.getByLabel('Chain map');
        await expect(map.locator('.ci-chain-row')).toHaveText([/Chain 1\s*D1\s*Clinical store\s*D2\s*EHR delivery/, /Chain 2\s*D3\s*Analytics API/, /Disabled\s*D4\s*Legacy archive/]);
        const wait = page.locator('.ci-wait').first();
        await expect(wait).toContainText(/D2 waits for D1 to finish initial processing/);
        await expect(page.locator('#ci-destinations-content > .ci-lead')).toContainText(/send error.*continue/);
        await expect(page.locator('#ci-destinations-content > .ci-lead')).toContainText(/initial filter\/transformer.*stops the rest of that chain/);
        await expect(page.locator('#ci-respond')).toContainText('The sender gets the response from D2 EHR delivery.');
        await expect(page.locator('#ci-queue')).toContainText('D3 · Analytics API');
        await expect(page.locator('#ci-receive')).toContainText('0.0.0.0:6663');
        await expect(page.getByText('can remove destinations for each message', { exact: false })).toBeVisible();
    });

    test('distinguishes queued filter and transformer work from send-only queues', async ({ page }) => {
        const channel = structuredClone(CHANNEL);
        const cases = [
            { name: 'Always with transforms', queueEnabled: true, sendFirst: false, regenerate: true, include: true, effective: true },
            { name: 'On failure with transforms', queueEnabled: true, sendFirst: true, regenerate: true, include: true, effective: true },
            { name: 'Always send only', queueEnabled: true, sendFirst: false, regenerate: true, include: false, effective: false },
            { name: 'No regeneration', queueEnabled: true, sendFirst: false, regenerate: false, include: true, effective: false },
            { name: 'Queue disabled', queueEnabled: false, sendFirst: false, regenerate: true, include: true, effective: false }
        ];
        channel.destinationConnectors.connector = cases.map((value, i) => {
            const destination = tcpSender(i + 1, value.name, { waitForPrevious: i > 0 });
            destination.properties.destinationConnectorProperties = queue({
                queueEnabled: value.queueEnabled, sendFirst: value.sendFirst,
                regenerateTemplate: value.regenerate, includeFilterTransformer: value.include
            });
            return destination;
        });
        await mockEngine(page, { [`GET /channels/${ID}`]: { channel } });
        await page.goto(`/channels/${ID}/edit?tab=Inspector`);
        for (const [i, value] of cases.entries()) {
            const destination = page.locator('#ci-dest-' + (i + 1));
            const include = destination.locator('.ci-fact').filter({ has: page.locator('dt', { hasText: 'Include filter/transformer' }) });
            if (value.queueEnabled) await expect(include.locator('dd')).toHaveText(value.effective ? 'Yes' : 'No');
            else await expect(include).toHaveCount(0);
        }
        const always = page.locator('#ci-dest-1');
        await expect(always).toContainText(/Filter, transformer and send run in the queue/);
        await expect(always).toContainText(/next destination.*before this work finishes/);
        const onFailure = page.locator('#ci-dest-2');
        await expect(onFailure).toContainText(/immediate send.*filter and transformer run first/);
        await expect(onFailure).toContainText(/Otherwise this work starts in the queue/);
        await expect(onFailure).toContainText(/queued attempt repeats the filter and transformer/);
        for (const id of [3, 4, 5]) {
            await expect(page.locator('#ci-dest-' + id)).not.toContainText(/this work starts in the queue|Filter, transformer and send run in the queue/);
        }
        await page.getByRole('button', { name: 'Print', exact: true }).click();
        const preview = page.getByRole('dialog', { name: 'Print preview', exact: true });
        await expect(preview.locator('#print-ci-dest-1')).toContainText(/next destination.*before this work finishes/);
        await expect(preview.locator('#print-ci-dest-2')).toContainText(/queued attempt repeats the filter and transformer/);
        await expect(preview.locator('section[aria-labelledby="print-ci-destinations"] > .ci-lead')).toContainText(/initial filter\/transformer.*stops the rest of that chain/);
    });

    test('keeps numbered stages independent of code and detail disclosures', async ({ page }) => {
        await page.goto('/channels/' + ID + '/edit?tab=Inspector');
        await expect(page.getByText('Includes the latest saved global scripts.')).toBeVisible();
        const transform = page.locator('#ci-transform .ci-section-toggle');
        const receive = page.locator('#ci-receive .ci-section-toggle');
        const route = page.locator('details.ci-item', { hasText: 'Route training' });
        await expect(transform).toHaveAttribute('aria-expanded', 'true');
        await page.locator('#ci-transform .ci-index').click();
        await expect(transform).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('#ci-transform-content')).toBeHidden();
        await expect(receive).toHaveAttribute('aria-expanded', 'true');

        await page.getByRole('button', { name: 'Expand all', exact: true }).click();
        await expect(transform).toHaveAttribute('aria-expanded', 'false');
        await expect(receive).toHaveAttribute('aria-expanded', 'true');
        await expect(route).toHaveAttribute('open', '');
        await expect(route.locator('.ci-code')).toBeHidden();
        await transform.focus();
        await page.keyboard.press('Enter');
        await expect(transform).toHaveAttribute('aria-expanded', 'true');
        await expect(route.locator('.ci-code')).toBeVisible();
        await page.keyboard.press('Space');
        await expect(transform).toHaveAttribute('aria-expanded', 'false');

        await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
        await expect(transform).toHaveAttribute('aria-expanded', 'false');
        await expect(receive).toHaveAttribute('aria-expanded', 'true');
        await expect(route).not.toHaveAttribute('open', '');
        await page.getByLabel('Show all code').check();
        await expect(transform).toHaveAttribute('aria-expanded', 'false');
        await receive.click();
        await page.getByLabel('Show all code').uncheck();
        await expect(receive).toHaveAttribute('aria-expanded', 'false');
        await expect(transform).toHaveAttribute('aria-expanded', 'false');
        await page.getByLabel('Include global scripts').uncheck();
        await expect(page.getByText('Global scripts excluded.')).toBeVisible();
        await expect(transform).toHaveAttribute('aria-expanded', 'false');
        await expect(receive).toHaveAttribute('aria-expanded', 'false');
        await transform.click();
        await expect(route).not.toHaveAttribute('open', '');
        await expect(page.locator('#ci-preprocess .ci-section-toggle')).toHaveAttribute('aria-expanded', 'true');
    });

    test('reveals folded stages for find, contents and map reference navigation', async ({ page }) => {
        await page.goto('/channels/' + ID + '/edit?tab=Inspector');
        const transform = page.locator('#ci-transform .ci-section-toggle');
        const receive = page.locator('#ci-receive .ci-section-toggle');
        const destinations = page.locator('#ci-destinations .ci-section-toggle');
        const find = page.getByPlaceholder('Find in channel');
        const route = page.locator('details.ci-item', { hasText: 'Route training' });
        await transform.click();
        await find.fill('destinationSet');
        await expect(transform).toHaveAttribute('aria-expanded', 'true');
        await expect(route.locator('.ci-code')).toBeVisible();
        await transform.click();
        await find.press('Enter');
        await expect(transform).toHaveAttribute('aria-expanded', 'true');
        await expect(route.locator('.ci-code')).toBeVisible();

        await find.fill('');
        await receive.click();
        await find.fill('Keep connection open');
        await expect(receive).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('#ci-receive .ci-fact.hit')).toBeVisible();

        await find.fill('');
        await destinations.click();
        await page.getByRole('navigation', { name: 'Steps in this channel' }).getByRole('link', { name: 'D4 Legacy archive', exact: true }).click();
        await expect(destinations).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('#ci-dest-4')).toBeVisible();

        await transform.click();
        await page.locator('#ci-key-channelMap\\.facility').getByRole('button', { name: 'Source transformer · Read facility', exact: true }).click();
        await expect(transform).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('#ci-transform details.ci-item').first()).toHaveAttribute('open', '');
    });

    test('finds text, follows map keys and opens editor tabs', async ({ page }) => {
        await page.goto(`/channels/${ID}/edit?tab=Inspector`);
        const route = page.locator('details.ci-item', { hasText: 'Route training' });
        await expect(route).not.toHaveAttribute('open', '');

        await page.getByPlaceholder('Find in channel').fill('destinationSet');
        await expect(route).toHaveAttribute('open', '');
        await expect(route.locator('.ci-code')).toContainText("destinationSet.remove(3)");
        await expect(page.locator('.ci-count')).toHaveText('1 of 1');

        // A key read with no writer in the channel is flagged.
        await route.getByRole('button', { name: /reads alertThreshold/ }).click();
        const row = page.locator('#ci-key-globalMap\\.alertThreshold');
        await expect(row).toHaveClass(/target/);
        await expect(row).toContainText('No writer in this channel.');
        await expect(page.locator('#ci-key-channelMap\\.facility')).toContainText('Source transformer · Read facility');

        await page.locator('#ci-filter').getByRole('button', { name: 'Open in Source' }).click();
        await expect(page.getByRole('tab', { name: 'Source', exact: true })).toHaveAttribute('aria-selected', 'true');
    });

    test('the editor still opens on Summary without the tab parameter', async ({ page }) => {
        await page.goto(`/channels/${ID}/edit`);
        await expect(page.getByRole('tab', { name: 'Summary', exact: true })).toHaveAttribute('aria-selected', 'true');
    });

    test('Channels offers Inspect Channel for one selected channel', async ({ page }) => {
        await page.goto('/channels');
        await expect(page.getByRole('button', { name: 'Inspect Channel', exact: true })).toHaveCount(0);
        await page.getByText('Demo Stopped', { exact: true }).click();
        await page.getByRole('button', { name: 'Inspect Channel', exact: true }).click();
        await expect(page).toHaveURL(/\/channels\/c-stopped\/edit\?tab=Inspector$/);
    });

    test('includes exact global script text, toggles it, and retries failed reads', async ({ page }) => {
        let attempts = 0;
        await mockEngine(page, {
            [`GET /channels/${ID}`]: { channel: CHANNEL },
            'GET /server/globalScripts': () => ++attempts === 1 ? { __status: 503 } : { map: { entry: [
                { string: ['Deploy', 'return;'] }, { string: ['Undeploy', 'return;'] },
                { string: ['Preprocessor', '123'] }, { string: ['Postprocessor', "globalMap.put('completed', true);"] }
            ] } },
            [`GET /channels/${ID}/status`]: { dashboardStatus: { channelId: ID, state: 'STARTED', deployedRevisionDelta: 1 } }
        });
        await page.goto(`/channels/${ID}/edit?tab=Inspector`);
        await expect(page.getByText('Global scripts could not be loaded.', { exact: false })).toBeVisible();
        await expect(page.getByText('Latest saved channel is 1 revision ahead of deployed.', { exact: false })).toBeVisible();
        await page.getByRole('button', { name: 'Retry global scripts' }).click();
        const global = page.locator('.ci-item', { hasText: 'Global preprocessor' });
        await global.locator('summary').click();
        await expect(global.locator('.lc')).toHaveText('123');
        await expect(page.locator('#ci-key-globalMap\\.completed')).toContainText('Global postprocessor');
        await page.getByLabel('Include global scripts').uncheck();
        await expect(global).toHaveCount(0);
        await expect(page.locator('#ci-key-globalMap\\.completed')).toHaveCount(0);
        await expect(page.getByText('Global scripts excluded.')).toBeVisible();
    });

    test('distinguishes undeployed channels from denied status reads and can refresh', async ({ page }) => {
        let reads = 0;
        await mockEngine(page, {
            [`GET /channels/${ID}`]: { channel: CHANNEL },
            [`GET /channels/${ID}/status`]: () => ++reads === 1 ? { __status: 404 }
                : reads === 2 ? { __status: 403 }
                : { dashboardStatus: { channelId: ID, state: 'STOPPED', deployedRevisionDelta: 2 } }
        });
        await page.goto(`/channels/${ID}/edit?tab=Inspector`);
        await expect(page.getByText('Channel is not deployed.', { exact: false })).toBeVisible();
        await page.getByRole('button', { name: 'Refresh status' }).click();
        await expect(page.getByText('Deployment status unavailable.', { exact: false })).toBeVisible();
        await page.getByRole('button', { name: 'Refresh status' }).click();
        await expect(page.getByText('Latest saved channel is 2 revisions ahead of deployed.', { exact: false })).toBeVisible();
    });

    test('includes JavaScript bodies serialized as JSON primitives in the story and print', async ({ page }) => {
        const channel = structuredClone(CHANNEL);
        const values = ['false', 'true', '123', 'null', ''];
        const elements = values.map((script, sequenceNumber) => ({ '@version': V, name: `Literal ${script}`, sequenceNumber, enabled: true, operator: 'AND', script }));
        channel.sourceConnector.filter.elements = { 'com.mirth.connect.plugins.javascriptrule.JavaScriptRule': elements };
        channel.sourceConnector.transformer.elements = { [JS_STEP]: elements };
        channel.deployScript = 'null';
        channel.undeployScript = '';
        const wire = structuredClone(channel);
        for (const list of [wire.sourceConnector.filter.elements['com.mirth.connect.plugins.javascriptrule.JavaScriptRule'], wire.sourceConnector.transformer.elements[JS_STEP]]) {
            for (const el of list) el.script = el.script === '' ? null : JSON.parse(el.script);
        }
        wire.deployScript = wire.undeployScript = null;
        await mockEngine(page, { [`GET /channels/${ID}`]: (request: any) => request.headers().accept?.includes('application/xml') ? xml('channel', channel) : { channel: wire } });
        await page.goto(`/channels/${ID}/edit?tab=Inspector`);
        await page.getByLabel('Include global scripts').uncheck();
        await page.getByRole('button', { name: 'Expand all' }).click();
        await expect(page.locator('#ci-filter .ci-code .lc')).toHaveText(values);
        await expect(page.locator('#ci-transform .ci-code .lc')).toHaveText(values);
        await expect(page.locator('#ci-deploy .ci-name')).toHaveText(['Deploy script', 'Undeploy script']);
        await expect(page.locator('#ci-deploy .ci-code .lc')).toHaveText(['null', '']);
        await page.getByRole('button', { name: 'Print', exact: true }).click();
        const preview = page.getByRole('dialog', { name: 'Print preview', exact: true });
        await expect(preview.locator('section[aria-labelledby="print-ci-filter"] .ci-code .lc')).toHaveText(values);
        await expect(preview.locator('section[aria-labelledby="print-ci-transform"] .ci-code .lc')).toHaveText(values);
    });

    test('restores code and XSLT keys on a single read without fetching code XML per list row', async ({ page }) => {
        const channel = structuredClone(CHANNEL);
        const XSLT = 'com.mirth.connect.plugins.xsltstep.XsltStep';
        channel.sourceConnector.transformer.elements[XSLT] = { name: 'Zero key', enabled: true, sequenceNumber: 2, sourceXml: "'<root/>'", resultVariable: '0', template: "'<xsl:stylesheet xmlns:xsl=\"http://www.w3.org/1999/XSL/Transform\" version=\"1.0\"><xsl:template match=\"/\"><root/></xsl:template></xsl:stylesheet>'" };
        const wire = structuredClone(channel);
        wire.sourceConnector.transformer.elements[XSLT].resultVariable = 0;
        wire.postprocessingScript = null;
        channel.postprocessingScript = '';
        let xmlReads = 0;
        await mockEngine(page, {
            'GET /channels': { list: { channel: [wire] } },
            [`GET /channels/${ID}`]: (request: any) => request.headers().accept?.includes('application/xml') ? (xmlReads++, xml('channel', channel)) : { channel: wire }
        });
        await page.goto('/channels');
        await expect(page.getByText('Lab results', { exact: true })).toBeVisible();
        expect(xmlReads).toBe(0);
        await page.goto(`/channels/${ID}/edit?tab=Inspector`);
        await expect(page.locator('#ci-key-channelMap\\.0')).toContainText('Zero key');
        await expect(page.locator('#ci-key-channelMap\\.0')).not.toContainText('No writer');
        await expect(page.locator('#ci-postprocess')).not.toHaveClass(/empty/);
        const globalPostprocess = page.locator('#ci-postprocess .ci-item')
            .filter({ has: page.locator('.ci-name', { hasText: /^Global postprocessor$/ }) });
        await expect(globalPostprocess.locator('.ci-code .lc')).toHaveText('return;');
        expect(xmlReads).toBe(1);
    });

    test('preserves literal rule values and nested iterator expressions', async ({ page }) => {
        const channel = structuredClone(CHANNEL);
        channel.sourceConnector.filter.elements[RULE].values = { string: ['null', '0', 'false'] };
        const ITERATOR = 'com.mirth.connect.model.IteratorStep';
        channel.sourceConnector.transformer.elements = { [ITERATOR]: { name: 'Empty collection', enabled: true, properties: { target: 'null', indexVariable: 'i', children: '' } } };
        const wire = structuredClone(channel);
        wire.sourceConnector.filter.elements[RULE].values.string = [null, 0, false];
        wire.sourceConnector.transformer.elements[ITERATOR].properties.target = null;
        await mockEngine(page, { [`GET /channels/${ID}`]: (request: any) => request.headers().accept?.includes('application/xml') ? xml('channel', channel) : { channel: wire } });
        await page.goto(`/channels/${ID}/edit?tab=Inspector`);
        await page.getByRole('button', { name: 'Expand all' }).click();
        await expect(page.locator('#ci-filter .ci-expr')).toHaveText("msg['MSH']['MSH.9']['MSH.9.1'] equals null or 0 or false");
        await expect(page.locator('#ci-transform .ci-expr')).toHaveText('For each null · index variable i');
    });

    test('explains iterator rule acceptance and early exit independently of editable names', async ({ page }) => {
        const channel = structuredClone(CHANNEL);
        const ITERATOR_RULE = 'com.mirth.connect.model.IteratorRule';
        const JS_RULE = 'com.mirth.connect.plugins.javascriptrule.JavaScriptRule';
        const children = { [JS_RULE]: { '@version': V, name: 'Iteration result', enabled: true, operator: 'NONE', script: 'return [true, false][i];' } };
        const iterator = (name: string, all: boolean | string, early: boolean | string, rules: any, enabled = true) => ({
            '@version': V, name, enabled, operator: 'NONE',
            properties: { target: '[true, false]', indexVariable: 'i', intersectIterations: all, breakEarly: early, children: rules }
        });
        const source = iterator('Custom acceptance', false, false, {
            [ITERATOR_RULE]: iterator('Nested acceptance', true, true, children)
        });
        const disabled = iterator('Disabled outer acceptance', false, true, {
            [ITERATOR_RULE]: iterator('Skipped nested acceptance', true, false, {
                [JS_RULE]: { '@version': V, name: 'Skipped side effect', enabled: true, operator: 'NONE', script: 'channelMap.put("disabledIteratorChild", true); return true;' }
            })
        }, false);
        channel.sourceConnector.filter.elements = { [ITERATOR_RULE]: [source, disabled] };
        // The same custom name must not hide different source/destination behavior.
        channel.destinationConnectors.connector[0].filter.elements = {
            [ITERATOR_RULE]: iterator('Custom acceptance', 'true', 'true', children)
        };
        await mockEngine(page, { [`GET /channels/${ID}`]: { channel } });
        await page.goto(`/channels/${ID}/edit?tab=Inspector`);
        await page.getByRole('button', { name: 'Expand all', exact: true }).click();
        const namedRow = (scope: string, name: string) => page.locator(scope + ' .ci-item')
            .filter({ has: page.locator('.ci-name', { hasText: new RegExp('^' + name + '$') }) });
        const sourceRow = namedRow('#ci-filter', 'Custom acceptance');
        const destinationRow = namedRow('#ci-dest-1', 'Custom acceptance');
        await expect(sourceRow.locator('.ci-expr')).toContainText('Accept if: Any iteration passes');
        await expect(sourceRow.locator('.ci-expr')).toContainText('Stop early: No · evaluate every iteration');
        await expect(destinationRow.locator('.ci-expr')).toContainText('Accept if: All iterations pass');
        await expect(destinationRow.locator('.ci-expr')).toContainText('Stop early: On first failing iteration');
        await expect(namedRow('#ci-filter', 'Nested acceptance').locator('.ci-expr')).toContainText('Accept if: All iterations pass');
        const skipped = namedRow('#ci-filter', 'Skipped nested acceptance');
        await expect(skipped).toHaveClass(/off/);
        await expect(skipped).toContainText('Iterator disabled · skipped');
        await expect(skipped.locator('.ci-expr')).toContainText('Stop early: No · evaluate every iteration');
        await expect(namedRow('#ci-filter', 'Disabled outer acceptance').locator('.ci-expr')).toContainText('Stop early: On first passing iteration');
        await expect(page.locator('#ci-key-channelMap\\.disabledIteratorChild')).toHaveCount(0);

        await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
        await page.getByPlaceholder('Find in channel').fill('All iterations pass');
        await expect(destinationRow).toHaveAttribute('open', '');
        await expect(namedRow('#ci-filter', 'Nested acceptance')).toHaveAttribute('open', '');
        await expect(skipped).toHaveAttribute('open', '');
        await expect(sourceRow).not.toHaveAttribute('open', '');
        await page.getByRole('button', { name: 'Print', exact: true }).click();
        const preview = page.getByRole('dialog', { name: 'Print preview', exact: true });
        await expect(namedRow('section[aria-labelledby="print-ci-filter"]', 'Custom acceptance').locator('.ci-expr')).toContainText('Any iteration passes');
        await expect(namedRow('#print-ci-dest-1', 'Custom acceptance').locator('.ci-expr')).toContainText('On first failing iteration');
        await expect(namedRow('section[aria-labelledby="print-ci-filter"]', 'Skipped nested acceptance')).toContainText('Iterator disabled · skipped');
        await expect(preview.locator('.ci-print-map', { hasText: 'disabledIteratorChild' })).toHaveCount(0);
        await page.keyboard.press('Escape');

        source.properties.intersectIterations = true;
        source.properties.breakEarly = true;
        await mockEngine(page, { [`GET /channels/${ID}`]: { channel } });
        await page.reload();
        await page.getByPlaceholder('Find in channel').fill('Custom acceptance');
        await expect(sourceRow.locator('.ci-expr')).toContainText('Accept if: All iterations pass');
        await expect(sourceRow.locator('.ci-expr')).toContainText('Stop early: On first failing iteration');
        await expect(sourceRow.locator('.ci-expr')).not.toContainText('Any iteration passes');
        await page.getByRole('button', { name: 'Print', exact: true }).click();
        await expect(namedRow('section[aria-labelledby="print-ci-filter"]', 'Custom acceptance').locator('.ci-expr')).toContainText('All iterations pass');
    });

    for (const failure of ['revision', 'timestamp', 'unavailable']) {
        test(`rejects ${failure} code XML instead of combining channel snapshots`, async ({ page }) => {
            const channel = structuredClone(CHANNEL);
            channel.deployScript = 'false';
            const wire = structuredClone(channel);
            wire.deployScript = false;
            if (failure === 'revision') channel.revision++;
            if (failure === 'timestamp') channel.exportData.metadata.lastModified.time++;
            await mockEngine(page, { [`GET /channels/${ID}`]: (request: any) => request.headers().accept?.includes('application/xml')
                ? failure === 'unavailable' ? { __status: 503, body: { message: 'Code XML unavailable' } } : xml('channel', channel) : { channel: wire } });
            await page.goto(`/channels/${ID}/edit?tab=Inspector`);
            await expect(page).toHaveURL(/\/channels$/);
            await expect(page.getByText(failure === 'unavailable' ? 'Code XML unavailable' : /Channel changed while reading text fields/)).toBeVisible();
        });
    }

    test('previews and prints complete content without changing editor state', async ({ page }, info) => {
        const channel = structuredClone(CHANNEL);
        channel.sourceConnector.transformer.elements[JS_STEP].script = Array.from({ length: 80 }, (_, i) => `var printLine${i} = ${i};`).join('\n') + "\nlogger.info('PRINT_LAST_LINE');";
        await mockEngine(page, { [`GET /channels/${ID}`]: { channel } });
        const writes: string[] = [];
        page.on('request', req => { if (req.url().includes('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method())) writes.push(req.url()); });
        await page.goto(`/channels/${ID}/edit?tab=Inspector`);
        await expect(page.getByText('Includes the latest saved global scripts.')).toBeVisible();
        if (await page.locator('html').getAttribute('data-theme') !== 'dark') await page.getByRole('button', { name: 'Toggle light/dark mode' }).click();
        await page.getByRole('button', { name: 'Collapse all' }).click();
        await expect(page.locator('details.ci-item[open]')).toHaveCount(0);
        await page.locator('#ci-transform .ci-section-toggle').click();
        await page.locator('#ci-destinations .ci-section-toggle').click();
        const stageStates = await page.locator('.ci-section-toggle').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-expanded')));
        await page.getByRole('button', { name: 'Print', exact: true }).click();
        const preview = page.getByRole('dialog', { name: 'Print preview', exact: true });
        await expect(preview).toBeVisible();
        await expect(preview.getByRole('heading', { name: 'Lab results', exact: true })).toBeVisible();
        await expect(preview.getByText('PRINT_LAST_LINE', { exact: false })).toBeVisible();
        await expect(preview.locator('#print-ci-dest-4')).toContainText('Legacy archive');
        await expect(preview.locator('details, .ci-code.long')).toHaveCount(0);
        expect(await preview.evaluate(el => el.parentElement === document.body)).toBe(true);
        expect((await new AxeBuilder({ page }).include('.ci-print-dialog').analyze()).violations).toEqual([]);
        if (process.env.INSPECTOR_SCREENSHOTS === '1') await page.screenshot({ path: info.outputPath('print-preview.png'), animations: 'disabled' });
        await page.evaluate(() => { (window as any).__printCalls = 0; window.print = () => { (window as any).__printCalls++; }; });
        await preview.getByRole('button', { name: 'Print / Save PDF', exact: true }).click();
        expect(await page.evaluate(() => (window as any).__printCalls)).toBe(1);
        await page.emulateMedia({ media: 'print' });
        await expect(page.locator('.shell')).toBeHidden();
        await expect(preview.locator('.ci-print-toolbar')).toBeHidden();
        await expect(preview.getByText('PRINT_LAST_LINE', { exact: false })).toBeVisible();
        const paper = preview.locator('.ci-print-paper');
        expect((await paper.boundingBox())!.height).toBeGreaterThan(page.viewportSize()!.height);
        if (process.env.INSPECTOR_PDF === '1' && info.project.name === 'ui') {
            await page.pdf({ path: info.outputPath('inspection.pdf'), format: 'Letter', printBackground: false });
            await page.pdf({ path: info.outputPath('inspection-a4.pdf'), format: 'A4', printBackground: false });
        }
        await page.emulateMedia({ media: 'screen' });
        await preview.getByRole('button', { name: 'Back to Inspector', exact: true }).click();
        await expect(preview).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeFocused();
        await expect(page.locator('details.ci-item[open]')).toHaveCount(0);
        expect(await page.locator('.ci-section-toggle').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-expanded')))).toEqual(stageStates);
        await page.setViewportSize({ width: 430, height: 900 });
        await page.locator('.rail-backdrop').click({ position: { x: 320, y: 300 } });
        await page.getByRole('button', { name: 'Print', exact: true }).click();
        await expect(preview).toBeVisible();
        expect(await preview.locator('.ci-print-paper').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        if (process.env.INSPECTOR_SCREENSHOTS === '1') await page.screenshot({ path: info.outputPath('print-preview-mobile.png'), animations: 'disabled' });
        await page.keyboard.press('Escape');
        await expect(preview).toHaveCount(0);
        expect(writes).toEqual([]);
    });

    test('shows source, destination and response outbound templates with no steps', async ({ page }) => {
        const channel = structuredClone(CHANNEL);
        const values = ['SOURCE_TEMPLATE_MARKER\n' + Array.from({ length: 80 }, (_, i) => 'template line ' + i).join('\n') + '\nliteral $c("templateLiteral")',
            'DESTINATION_TEMPLATE_MARKER', 'RESPONSE_TEMPLATE_MARKER'];
        const transforms = [channel.sourceConnector.transformer, channel.destinationConnectors.connector[0].transformer,
            channel.destinationConnectors.connector[0].responseTransformer];
        transforms.forEach((t, i) => { t.elements = ''; t.outboundTemplate = { '@encoding': 'base64', $: Buffer.from(values[i]).toString('base64') }; });
        await mockEngine(page, { ['GET /channels/' + ID]: { channel } });
        await page.goto('/channels/' + ID + '/edit?tab=Inspector');
        await page.getByPlaceholder('Find in channel').fill('TEMPLATE_MARKER');
        const templates = page.locator('.ci-template .ci-item');
        await expect(templates).toHaveCount(3);
        for (const row of await templates.all()) await expect(row).toHaveAttribute('open', '');
        const longTemplate = page.locator('#ci-transform .ci-template .ci-expr');
        await longTemplate.focus();
        await expect(longTemplate).toBeFocused();
        expect(await longTemplate.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
        await expect(page.locator('#ci-transform')).not.toHaveClass(/empty/);
        await expect(page.locator('#ci-transform')).toContainText('The outbound template supplies the source output.');
        await expect(page.locator('#ci-dest-1')).toContainText('The outbound template supplies the destination output.');
        await expect(page.locator('#ci-dest-1')).not.toContainText('Sends the source output');
        await expect(page.locator('#ci-dest-1')).not.toContainText('No response transformer steps.');
        await expect(page.locator('#ci-key-channelMap\\.templateLiteral')).toHaveCount(0);
        await page.getByRole('button', { name: 'Print', exact: true }).click();
        const preview = page.getByRole('dialog', { name: 'Print preview', exact: true });
        for (const value of values) await expect(preview).toContainText(value);
        expect(await preview.locator('.ci-template .ci-expr').first().evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
        await expect(preview.locator('details')).toHaveCount(0);
    });

    test('inspects replacement expressions and XSLT inputs through search, map links and print', async ({ page }) => {
        const channel = structuredClone(CHANNEL);
        const BUILDER = 'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep';
        const XSLT = 'com.mirth.connect.plugins.xsltstep.XsltStep';
        const pair = (left: string, right: string) => ({ left: { '@class': 'string', $: left }, right: { '@class': 'string', $: right } });
        const mapperPattern = "$c('mapperPattern')", mapperReplacement = "$g('mapperReplacement')";
        const builderPattern = "$c('builderPattern')", builderReplacement = "$co('builderReplacement')";
        const sourceXml = "$c('xsltInput')";
        const template = '<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">' +
            '<!-- <img src="x" onerror="window.__inspectorExecuted=true"> -->' +
            '<xsl:template match="/"><result /></xsl:template></xsl:stylesheet>';
        channel.sourceConnector.transformer.elements = {
            [MAPPER]: {
                '@version': V, name: 'Normalize mapped value', sequenceNumber: 0, enabled: true,
                variable: 'normalized', mapping: "'initial'", scope: 'CHANNEL',
                replacements: { 'org.apache.commons.lang3.tuple.ImmutablePair': [pair(mapperPattern, mapperReplacement), pair("'second pattern'", "'second replacement'")] }
            },
            [BUILDER]: {
                '@version': V, name: 'Build normalized field', sequenceNumber: 1, enabled: true,
                messageSegment: "msg['PID']['PID.5']", mapping: "'input'",
                replacements: { 'org.apache.commons.lang3.tuple.ImmutablePair': pair(builderPattern, builderReplacement) }
            },
            [XSLT]: { '@version': V, name: 'Transform selected XML', sequenceNumber: 2, enabled: true, sourceXml, resultVariable: 'transformedXml', template }
        };
        await mockEngine(page, { [`GET /channels/${ID}`]: { channel } });
        await page.goto(`/channels/${ID}/edit?tab=Inspector`);
        const find = page.getByPlaceholder('Find in channel');
        await find.fill('mapperReplacement');
        const mapper = page.locator('#ci-transform .ci-item', { hasText: 'Normalize mapped value' });
        await expect(mapper).toHaveAttribute('open', '');
        await expect(mapper.locator('.ci-expr')).toContainText(mapperPattern);
        await expect(mapper.locator('.ci-expr')).toContainText(mapperReplacement);
        const mapperText = await mapper.locator('.ci-expr').innerText();
        expect(mapperText.indexOf(mapperPattern)).toBeLessThan(mapperText.indexOf("'second pattern'"));
        await mapper.getByRole('button', { name: 'reads mapperReplacement', exact: true }).click();
        const mapRow = page.locator('#ci-key-globalMap\\.mapperReplacement');
        await expect(mapRow).toHaveClass(/target/);
        await mapRow.getByRole('button', { name: /Normalize mapped value/ }).click();
        await expect(mapper.locator('.ci-expr')).toBeVisible();

        await find.fill('builderPattern');
        const builder = page.locator('#ci-transform .ci-item', { hasText: 'Build normalized field' });
        await expect(builder).toHaveAttribute('open', '');
        await expect(builder.locator('.ci-expr')).toContainText(builderReplacement);
        await expect(page.locator('#ci-key-connectorMap\\.builderReplacement')).toContainText('Build normalized field');
        await find.fill('xsltInput');
        const xslt = page.locator('#ci-transform .ci-item', { hasText: 'Transform selected XML' });
        await expect(xslt).toHaveAttribute('open', '');
        await expect(xslt.locator('.ci-expr')).toContainText(sourceXml);
        await expect(xslt.locator('.ci-expr')).toContainText(template);
        await expect(page.locator('#ci-key-channelMap\\.xsltInput')).toContainText('Transform selected XML');
        await expect(page.locator('.ci-root img')).toHaveCount(0);

        await page.getByRole('button', { name: 'Print', exact: true }).click();
        const preview = page.getByRole('dialog', { name: 'Print preview', exact: true });
        for (const expression of [mapperPattern, mapperReplacement, builderPattern, builderReplacement, sourceXml, template]) {
            await expect(preview).toContainText(expression);
        }
        await expect(preview.locator('.ci-print-map', { hasText: 'xsltInput' })).toContainText('Transform selected XML');
        await expect(preview.locator('img')).toHaveCount(0);
        expect(await page.evaluate(() => (window as any).__inspectorExecuted)).toBeUndefined();
    });

    test('inspects an attachment script before preprocessing without executing it', async ({ page }) => {
        const channel = structuredClone(CHANNEL);
        const script = 'this.__inspectorExecuted = true;\n' +
            'var markup = \'<img src="x" onerror="window.__inspectorExecuted=true">\';\n' +
            'globalMap.put("attachmentRun", "ATTACHMENT_SCRIPT_MARKER");\nreturn message;';
        channel.properties.attachmentProperties = {
            '@version': V, type: 'JavaScript',
            className: 'com.mirth.connect.server.attachments.javascript.JavaScriptAttachmentHandlerProvider',
            properties: { entry: { string: ['javascript.script', script] } }
        };
        await mockEngine(page, { [`GET /channels/${ID}`]: { channel } });
        const writes: string[] = [];
        page.on('request', request => { if (request.url().includes('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.url()); });
        await page.goto(`/channels/${ID}/edit?tab=Inspector`);
        await expect(page.locator('#ci-attachments')).toBeVisible();
        const stages = await page.locator('.ci-section').evaluateAll(nodes => nodes.map(node => node.id));
        expect(stages.indexOf('ci-attachments')).toBe(stages.indexOf('ci-receive') + 1);
        expect(stages.indexOf('ci-preprocess')).toBe(stages.indexOf('ci-attachments') + 1);
        await page.getByPlaceholder('Find in channel').fill('attachmentRun');
        const handler = page.locator('#ci-attachments .ci-item');
        await expect(handler).toHaveAttribute('open', '');
        await expect(handler.locator('.ci-code .lc')).toHaveText(script.split('\n'));
        await handler.getByRole('button', { name: 'writes attachmentRun', exact: true }).click();
        const mapRow = page.locator('#ci-key-globalMap\\.attachmentRun');
        await expect(mapRow).toHaveClass(/target/);
        await mapRow.getByRole('button', { name: /Attachment handler script/ }).click();
        await expect(handler.locator('.ci-code')).toBeVisible();
        await page.getByRole('button', { name: 'Print', exact: true }).click();
        const preview = page.getByRole('dialog', { name: 'Print preview', exact: true });
        await expect(preview.locator('section[aria-labelledby="print-ci-attachments"] .ci-code .lc')).toHaveText(script.split('\n'));
        await expect(preview.locator('.ci-print-map', { hasText: 'attachmentRun' })).toContainText('Attachment handler script');
        await expect(preview.locator('img')).toHaveCount(0);
        expect(await page.evaluate(() => (window as any).__inspectorExecuted)).toBeUndefined();
        await page.keyboard.press('Escape');

        // A stored script on an inactive handler must not be described as running.
        channel.properties.attachmentProperties.type = 'None';
        await mockEngine(page, { [`GET /channels/${ID}`]: { channel } });
        await page.reload();
        await expect(page.locator('#ci-receive')).toBeVisible();
        await expect(page.locator('#ci-attachments')).toHaveCount(0);
        await expect(page.locator('#ci-key-globalMap\\.attachmentRun')).toHaveCount(0);
        await page.getByRole('button', { name: 'Print', exact: true }).click();
        await expect(preview).not.toContainText('ATTACHMENT_SCRIPT_MARKER');
        expect(await page.evaluate(() => (window as any).__inspectorExecuted)).toBeUndefined();
        expect(writes).toEqual([]);
    });

    // Exact source strings and attachment property shape from saved OIE 4.6.0
    // channels in PR 140's live-defaults captures (d4b78e4 re-review) and its
    // blank-runtime follow-up. Live evidence establishes execution semantics;
    // these tests verify inspection, including JSON null recovered from XML.
    for (const sample of [
        { name: 'preprocessor control', script: 'return message;', section: 'ci-preprocess', row: 'Preprocessor' },
        { name: 'preprocessor bare return', script: 'return;', section: 'ci-preprocess', row: 'Preprocessor' },
        { name: 'preprocessor return followed by a newline', script: 'return\nmessage;', section: 'ci-preprocess', row: 'Preprocessor' },
        { name: 'preprocessor empty body', script: '', section: 'ci-preprocess', row: 'Preprocessor' },
        { name: 'preprocessor whitespace body', script: ' \t\n ', section: 'ci-preprocess', row: 'Preprocessor' },
        { name: 'attachment bare return', script: 'return;', section: 'ci-attachments', row: 'Attachment handler script' },
        { name: 'attachment empty body', script: '', section: 'ci-attachments', row: 'Attachment handler script' },
        { name: 'attachment whitespace body', script: ' \t\n ', section: 'ci-attachments', row: 'Attachment handler script' }
    ]) {
        test('preserves saved ' + sample.name + ' source in search and Print', async ({ page }) => {
            const channel = structuredClone(CHANNEL);
            if (sample.section === 'ci-attachments') {
                channel.preprocessingScript = 'return message;';
                channel.properties.attachmentProperties = {
                    '@version': V,
                    className: 'com.mirth.connect.server.attachments.javascript.JavaScriptAttachmentHandlerProvider',
                    type: 'JavaScript',
                    properties: { entry: { string: ['javascript.script', sample.script] } }
                };
            } else channel.preprocessingScript = sample.script;
            const wire = structuredClone(channel);
            if (sample.script === '') {
                if (sample.section === 'ci-attachments') wire.properties.attachmentProperties.properties.entry.string[1] = null;
                else wire.preprocessingScript = null;
            }
            await mockEngine(page, { [`GET /channels/${ID}`]: (request: any) => request.headers().accept?.includes('application/xml')
                ? xml('channel', channel) : { channel: wire } });
            await page.goto(`/channels/${ID}/edit?tab=Inspector`);
            await page.getByPlaceholder('Find in channel').fill(sample.script.trim() ? 'return' : sample.row);
            const section = page.locator('#' + sample.section);
            const name = page.locator('.ci-name', { hasText: new RegExp('^' + sample.row + '$') });
            const row = section.locator('.ci-item').filter({ has: name });
            await expect(row).toHaveAttribute('open', '');
            await expect(row.locator('.ci-code')).toBeVisible();
            // Empty code still has one blank display line; whitespace is retained.
            const displayedLines = sample.script.split('\n').map(line => line || ' ');
            expect(await row.locator('.ci-code .lc').allTextContents()).toEqual(displayedLines);
            await expect(section).not.toContainText('The raw message is not changed.');

            await page.getByRole('button', { name: 'Print', exact: true }).click();
            const preview = page.getByRole('dialog', { name: 'Print preview', exact: true });
            const printedSection = preview.locator(`section[aria-labelledby="print-${sample.section}"]`);
            const printedRow = printedSection.locator('.ci-item').filter({ has: name });
            await expect(printedRow.locator('.ci-code')).toBeVisible();
            expect(await printedRow.locator('.ci-code .lc').allTextContents()).toEqual(displayedLines);
            await expect(printedSection).not.toContainText('The raw message is not changed.');
        });
    }

    for (const source of ['absent', 'local null']) {
        test('does not infer unchanged messages from ' + source + ' preprocessor source', async ({ page }) => {
            const channel = structuredClone(CHANNEL);
            if (source === 'absent') delete channel.preprocessingScript;
            await mockEngine(page, { [`GET /channels/${ID}`]: { channel } });
            await page.goto(`/channels/${ID}/edit?tab=Inspector`);
            await expect(page.locator('#ci-preprocess')).toBeVisible();
            if (source === 'local null') {
                // Saved empty source is recovered as ''. Exercise an explicit
                // null in the working draft separately from that API contract.
                await page.evaluate(async () => {
                    const store = await import(String('/core/store.js'));
                    store.getState('editingChannel').preprocessingScript = null;
                });
                await page.getByRole('tab', { name: 'Summary', exact: true }).click();
                await page.getByRole('tab', { name: 'Inspector', exact: true }).click();
            }
            await page.getByLabel('Include global scripts').uncheck();
            const section = page.locator('#ci-preprocess');
            await expect(section.locator('.ci-item')).toHaveCount(0);
            await expect(section).toContainText('No preprocessor source is included here.');
            await expect(section).toContainText('A global preprocessor can still run.');
            await expect(section).not.toContainText('The raw message is not changed.');
            await page.getByRole('button', { name: 'Print', exact: true }).click();
            const printed = page.getByRole('dialog', { name: 'Print preview', exact: true })
                .locator('section[aria-labelledby="print-ci-preprocess"]');
            await expect(printed.locator('.ci-item')).toHaveCount(0);
            await expect(printed).toContainText('No preprocessor source is included here.');
            await expect(printed).not.toContainText('The raw message is not changed.');
        });
    }

    for (const mode of [1, 2, 3]) {
        test('describes Database Reader post-process mode ' + mode, async ({ page }) => {
            const channel = structuredClone(CHANNEL);
            channel.sourceConnector.transportName = 'Database Reader';
            channel.sourceConnector.properties = {
                '@class': 'com.mirth.connect.connectors.jdbc.DatabaseReceiverProperties', '@version': V,
                sourceConnectorProperties: channel.sourceConnector.properties.sourceConnectorProperties,
                useScript: true, select: 'return new java.util.ArrayList();', updateMode: mode, aggregateResults: true,
                update: 'globalChannelMap.put("dbProcessed", "DB_POSTPROCESS_MARKER");'
            };
            await mockEngine(page, { ['GET /channels/' + ID]: { channel } });
            await page.goto('/channels/' + ID + '/edit?tab=Inspector');
            if (mode === 1) {
                await expect(page.locator('#ci-source-postprocess')).toHaveCount(0);
                await expect(page.locator('#ci-key-globalChannelMap\\.dbProcessed')).toHaveCount(0);
                await expect(page.locator('#ci-receive')).toContainText('Never');
            } else {
                await page.getByPlaceholder('Find in channel').fill('dbProcessed');
                await expect(page.locator('#ci-source-postprocess .ci-item')).toHaveAttribute('open', '');
                await expect(page.locator('#ci-source-postprocess')).toContainText(mode === 2 ? 'Runs once after dispatching' : 'Runs once per row after dispatching');
                await expect(page.locator('#ci-source-postprocess')).toContainText('combined results');
                await expect(page.locator('#ci-source-postprocess')).toContainText('If the script returns a nonempty ResultSet:');
                await expect(page.locator('#ci-source-postprocess')).toContainText('If it returns a Java List, rows are dispatched individually.');
                await expect(page.locator('#ci-source-postprocess')).toContainText(mode === 2
                    ? 'The post-process is skipped for a Java List while Aggregate Results is enabled.'
                    : 'Runs once per row after dispatching its message.');
                await expect(page.locator('#ci-key-globalChannelMap\\.dbProcessed')).toContainText('Source post-process');
            }
            await page.getByRole('button', { name: 'Print', exact: true }).click();
            const preview = page.getByRole('dialog', { name: 'Print preview', exact: true });
            if (mode === 1) await expect(preview).not.toContainText('DB_POSTPROCESS_MARKER');
            else {
                await expect(preview).toContainText('DB_POSTPROCESS_MARKER');
                await expect(preview.locator('.ci-print-map', { hasText: 'dbProcessed' })).toContainText('Source post-process');
                await expect(preview.locator('section[aria-labelledby="print-ci-source-postprocess"]')).toContainText(mode === 2
                    ? 'The post-process is skipped for a Java List while Aggregate Results is enabled.'
                    : 'If it returns a Java List, rows are dispatched individually. Runs once per row after dispatching its message.');
            }
        });
    }

    test('describes Database Reader batch response timing and after-poll failures', async ({ page }) => {
        const channel = structuredClone(CHANNEL);
        channel.sourceConnector.transportName = 'Database Reader';
        channel.sourceConnector.properties = {
            '@class': 'com.mirth.connect.connectors.jdbc.DatabaseReceiverProperties', '@version': V,
            sourceConnectorProperties: { ...channel.sourceConnector.properties.sourceConnectorProperties, processBatch: true, firstResponse: true },
            useScript: true, select: 'return new java.util.ArrayList();', updateMode: 2, aggregateResults: true,
            update: 'logger.info("batch post-process");'
        };
        await mockEngine(page, { ['GET /channels/' + ID]: { channel } });
        await page.goto('/channels/' + ID + '/edit?tab=Inspector');
        await expect(page.locator('#ci-source-postprocess')).toContainText('first batch message for the combined results');
        await expect(page.locator('#ci-source-postprocess')).toContainText('If the script returns a nonempty ResultSet:');
        await expect(page.locator('#ci-source-postprocess')).toContainText('The post-process is skipped for a Java List while Aggregate Results is enabled.');
        await page.getByRole('button', { name: 'Print', exact: true }).click();
        const preview = page.getByRole('dialog', { name: 'Print preview', exact: true });
        const printedPostprocess = preview.locator('section[aria-labelledby="print-ci-source-postprocess"]');
        await expect(printedPostprocess).toContainText('first batch message for the combined results');
        await expect(printedPostprocess).toContainText('The post-process is skipped for a Java List while Aggregate Results is enabled.');
        await page.keyboard.press('Escape');
        channel.sourceConnector.properties.sourceConnectorProperties.firstResponse = false;
        await mockEngine(page, { ['GET /channels/' + ID]: { channel } });
        await page.reload();
        await expect(page.locator('#ci-source-postprocess')).toContainText('last batch message for the combined results');

        channel.sourceConnector.properties.updateMode = 3;
        await mockEngine(page, { ['GET /channels/' + ID]: { channel } });
        await page.reload();
        await expect(page.locator('#ci-source-postprocess')).toContainText('If it returns a Java List, rows are dispatched individually.');
        await expect(page.locator('#ci-source-postprocess')).toContainText('Runs once for each dispatched batch message from a row.');
        await expect(page.locator('#ci-source-postprocess')).not.toContainText('post-process is skipped');
        await page.getByRole('button', { name: 'Print', exact: true }).click();
        await expect(printedPostprocess).toContainText('last batch message for the combined results');
        await expect(printedPostprocess).toContainText('If it returns a Java List, rows are dispatched individually. Runs once for each dispatched batch message from a row.');
        await page.keyboard.press('Escape');

        // SQL "once after all results" runs after the poll even with aggregation;
        // JavaScript aggregate mode instead depends on the returned ResultSet/List.
        channel.sourceConnector.properties.updateMode = 2;
        channel.sourceConnector.properties.useScript = false;
        channel.sourceConnector.properties.select = 'SELECT id FROM pending_messages';
        channel.sourceConnector.properties.update = 'UPDATE poll_state SET completed = 1';
        await mockEngine(page, { ['GET /channels/' + ID]: { channel } });
        await page.reload();
        const sqlPostprocess = page.locator('#ci-source-postprocess');
        await expect(sqlPostprocess).toContainText(/end of each poll.*polling fails or returns no rows/);
        await expect(sqlPostprocess).not.toContainText('combined results');
        await expect(sqlPostprocess).not.toContainText('Java List');
        await expect(sqlPostprocess.locator('.ci-section-toggle')).toHaveCount(0);
        await page.getByRole('button', { name: 'Print', exact: true }).click();
        await expect(preview.locator('section[aria-labelledby="print-ci-source-postprocess"]')).toContainText(/end of each poll.*polling fails or returns no rows/);
        await expect(printedPostprocess).not.toContainText('Java List');
        await expect(preview).toContainText('UPDATE poll_state SET completed = 1');
        await page.keyboard.press('Escape');

        channel.sourceConnector.properties.useScript = true;
        channel.sourceConnector.properties.select = 'return new java.util.ArrayList();';
        channel.sourceConnector.properties.update = 'logger.info("batch post-process");';
        channel.sourceConnector.properties.aggregateResults = false;
        await mockEngine(page, { ['GET /channels/' + ID]: { channel } });
        await page.reload();
        await expect(page.locator('#ci-source-postprocess')).toContainText('including when polling fails');
        await expect(page.locator('#ci-source-postprocess')).not.toContainText('Java List');
        channel.sourceConnector.properties.updateMode = 3;
        await mockEngine(page, { ['GET /channels/' + ID]: { channel } });
        await page.reload();
        await expect(page.locator('#ci-source-postprocess')).toContainText('each dispatched batch message from a row');
    });

    test('keeps long map reference lists readable with 196 destinations', async ({ page }, info) => {
        test.setTimeout(120_000);
        const channel = structuredClone(CHANNEL);
        const key = 'LargeChannelSharedKey';
        channel.name = 'Large channel regression';
        channel.sourceConnector.filter.elements = '';
        channel.sourceConnector.transformer.elements = '';
        channel.destinationConnectors.connector = Array.from({ length: 196 }, (_, i) => tcpSender(i + 1,
            'RoutingDestination_' + String(i + 1).padStart(3, '0') + '_WithALongDescriptiveNameForIntegrationOperations', {
                transportName: 'JavaScript Writer', waitForPrevious: i > 0,
                properties: { '@class': 'com.mirth.connect.connectors.js.JavaScriptDispatcherProperties', '@version': V,
                    destinationConnectorProperties: queue(), script: 'channelMap.put("' + key + '", ' + i + ');\nreturn "sent";' }
            }));
        await mockEngine(page, { ['GET /channels/' + ID]: { channel } });
        await page.goto('/channels/' + ID + '/edit?tab=Inspector');
        await expect(page.locator('.ci-chain-label')).toHaveText('Chain 1196 destinations, in configured order');
        const row = page.locator('#ci-key-channelMap\\.' + key);
        await row.scrollIntoViewIfNeeded();
        const disclosure = row.locator('details');
        await expect(disclosure).not.toHaveAttribute('open', '');
        await expect(disclosure.locator('summary')).toHaveText('196 references');
        expect((await row.boundingBox())!.height).toBeLessThan(100);
        await disclosure.locator('summary').click();
        await disclosure.getByRole('button').last().click();
        await expect(page.locator('#ci-dest-196 .ci-code')).toBeVisible();
        await page.getByRole('button', { name: 'Print', exact: true }).click();
        const preview = page.getByRole('dialog', { name: 'Print preview', exact: true });
        await expect(preview.locator('.ci-dest')).toHaveCount(196);
        await expect(preview.locator('.ci-print-map')).toHaveCount(1);
        await expect(preview.locator('.ci-print-map tbody tr')).toHaveCount(197);
        await expect(preview.locator('.ci-print-map')).toContainText('RoutingDestination_196');
        await expect(preview.locator('details')).toHaveCount(0);
        expect(await preview.locator('.ci-print-paper').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        if (process.env.INSPECTOR_SCREENSHOTS === '1') {
            await preview.locator('.ci-print-map thead').scrollIntoViewIfNeeded();
            await page.screenshot({ path: info.outputPath('large-references-desktop.png'), animations: 'disabled' });
        }
        if (process.env.INSPECTOR_PDF === '1' && info.project.name === 'ui') {
            await page.pdf({ path: info.outputPath('large-channel-letter.pdf'), format: 'Letter', printBackground: false });
            await page.pdf({ path: info.outputPath('large-channel-a4.pdf'), format: 'A4', printBackground: false });
        }
        await page.setViewportSize({ width: 430, height: 900 });
        expect(await preview.locator('.ci-print-paper').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        // Resizing while preview is open must not put the mobile navigation rail
        // above the document or its controls.
        expect(await preview.locator('.ci-preview-title').evaluate(el => {
            const box = el.getBoundingClientRect();
            return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
        })).toBe(true);
        await preview.locator('.ci-print-map thead').scrollIntoViewIfNeeded();
        if (process.env.INSPECTOR_SCREENSHOTS === '1') await page.screenshot({ path: info.outputPath('large-references-mobile.png'), animations: 'disabled' });
    });

    test('keeps destination numbers beside wrapped long names', async ({ page }, info) => {
        const channel = structuredClone(CHANNEL);
        const name = 'ChannelOperations_S3DataExchangeV2ToRepository_AnExtremelyLongDestinationName';
        channel.destinationConnectors.connector[1].name = name;
        await mockEngine(page, { [`GET /channels/${ID}`]: { channel } });
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto(`/channels/${ID}/edit?tab=Inspector`);
        const link = page.getByRole('navigation', { name: 'Steps in this channel' }).getByRole('link', { name: `D2 ${name}`, exact: true });
        await expect(link).toBeVisible();
        const labelBox = (await link.locator('.n').boundingBox())!;
        const nameBox = (await link.locator('.ci-toc-name').boundingBox())!;
        expect(Math.abs(labelBox.y - nameBox.y)).toBeLessThan(3);
        expect(nameBox.x).toBeGreaterThan(labelBox.x + labelBox.width);
        expect(nameBox.height).toBeGreaterThan(labelBox.height * 1.5);
        expect(await page.locator('.ci-toc').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        if (process.env.INSPECTOR_SCREENSHOTS === '1') await page.screenshot({ path: info.outputPath('long-names.png'), animations: 'disabled' });
        const title = page.locator('#ci-dest-2 .ci-dest-title');
        await title.scrollIntoViewIfNeeded();
        const prefix = (await title.locator('.dn').boundingBox())!;
        const heading = (await title.getByRole('heading', { name, exact: true }).boundingBox())!;
        expect(Math.abs(prefix.y - heading.y)).toBeLessThan(6);
        expect(heading.x).toBeGreaterThan(prefix.x + prefix.width);
    });

    test('shows edits made before switching to Inspector', async ({ page }) => {
        await page.goto(`/channels/${ID}/edit`);
        const description = page.getByPlaceholder('Describe what this channel does…');
        await description.fill('Updated handover description');
        await page.getByRole('tab', { name: 'Inspector', exact: true }).click();
        await expect(page.locator('.ci-desc')).toHaveText('Updated handover description');
        await expect(page.getByText('Current editor · revision 12 · unsaved changes', { exact: false })).toBeVisible();
    });

    test('find reveals disabled destinations', async ({ page }) => {
        const channel = structuredClone(CHANNEL);
        channel.sourceConnector.transformer.inboundProperties = { serializationProperties: { stripNamespaces: true } };
        channel.destinationConnectors.connector[3].transformer = transformer({ [JS_STEP]: { name: 'Disabled-only marker', enabled: true, script: "channelMap.put('disabledOnly', true);" } });
        await mockEngine(page, { [`GET /channels/${ID}`]: { channel } });
        await page.goto(`/channels/${ID}/edit?tab=Inspector`);
        await page.getByPlaceholder('Find in channel').fill('Disabled-only marker');
        await page.getByPlaceholder('Find in channel').press('Enter');
        await expect(page.locator('#ci-dest-4 .ci-code')).toBeVisible();
        await expect(page.locator('#ci-key-channelMap\\.disabledOnly')).toHaveCount(0);
    });

    test('ignores a late global read after exclusion and keeps failed status separate', async ({ page }) => {
        let release!: () => void;
        const pending = new Promise<void>(resolve => { release = resolve; });
        await mockEngine(page, {
            [`GET /channels/${ID}`]: { channel: CHANNEL },
            'GET /server/globalScripts': async () => { await pending; return { map: { entry: [
                { string: ['Deploy', 'return;'] }, { string: ['Undeploy', 'return;'] },
                { string: ['Preprocessor', "logger.info('Late global'); return message;"] }, { string: ['Postprocessor', 'return;'] }
            ] } }; },
            [`GET /channels/${ID}/status`]: { __status: 403 }
        });
        await page.goto(`/channels/${ID}/edit?tab=Inspector`);
        await expect(page.getByText('Loading global scripts…')).toBeVisible();
        await page.getByLabel('Include global scripts').uncheck();
        release();
        await expect(page.getByText('Deployment status unavailable.', { exact: false })).toBeVisible();
        await expect(page.getByText('Global scripts excluded.')).toBeVisible();
        await expect(page.locator('.ci-item', { hasText: 'Late global' })).toHaveCount(0);
        await expect(page.locator('.ci-desc')).toHaveText(CHANNEL.description);
    });

    test('the contents follow settled scrolling in a wide editor', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`/channels/${ID}/edit?tab=Inspector`);
        await page.locator('#ci-filter').evaluate(el => el.scrollIntoView({ block: 'start' }));
        await expect(page.locator('.ci-toc a.on')).toHaveAttribute('href', '#ci-filter');
        await page.locator('#ci-destinations').evaluate(el => el.scrollIntoView({ block: 'start' }));
        await expect(page.locator('.ci-toc a.on')).toHaveAttribute('href', '#ci-destinations');
        await page.getByRole('navigation', { name: 'Steps in this channel' }).getByRole('link', { name: '3 Accept or filter the message', exact: true }).click();
        await expect(page.locator('.ci-toc a.on')).toHaveAttribute('href', '#ci-filter');
        await page.locator('.ci-scroll').evaluate(el => { el.scrollTop = 0; });
        await expect(page.locator('.ci-toc a.on')).toHaveAttribute('href', '#ci-deploy');
    });

    test('keeps inspection readable in both themes and at narrow widths', async ({ page }, info) => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(`/channels/${ID}/edit?tab=Inspector`);
        await expect(page.getByText('Includes the latest saved global scripts.')).toBeVisible();
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.evaluate(() => document.fonts.ready);
        if (await page.locator('html').getAttribute('data-theme') !== 'dark') await page.getByRole('button', { name: 'Toggle light/dark mode' }).click();
        const settle = () => page.locator('.ci-root').evaluate(async root => {
            await Promise.all(root.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
        });
        const capture = async (name: string) => {
            await settle();
            if (process.env.INSPECTOR_SCREENSHOTS === '1') await page.screenshot({ path: info.outputPath(name + '.png'), fullPage: true, animations: 'disabled' });
        };
        const overflow = () => page.locator('.ci-root').evaluate(root => [...root.querySelectorAll<HTMLElement>('.ci-story, .ci-toolbar, .ci-dest')]
            .filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.className));
        expect(await overflow()).toEqual([]);
        await settle();
        const results = await new AxeBuilder({ page }).include('.ci-root').analyze();
        expect(results.violations).toEqual([]);
        await capture('desktop');
        await page.locator('#ci-destinations').evaluate(el => el.scrollIntoView({ block: 'start' }));
        await capture('desktop-destinations');
        await page.locator('.ci-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
        await capture('desktop-reference');
        await page.locator('.ci-scroll').evaluate(el => { el.scrollTop = 0; });
        await page.getByRole('button', { name: 'Toggle light/dark mode' }).click();
        await capture('light');
        expect((await new AxeBuilder({ page }).include('.ci-root').analyze()).violations).toEqual([]);
        await page.setViewportSize({ width: 430, height: 900 });
        await page.locator('.rail-backdrop').click({ position: { x: 320, y: 300 } });
        await expect(page.locator('.shell')).toHaveClass(/rail-collapsed/);
        expect(await overflow()).toEqual([]);
        await capture('mobile');
        await page.getByLabel('Show all code').check();
        await expect(page.getByRole('button', { name: /reads alertThreshold/ })).toBeVisible();
    });
});
