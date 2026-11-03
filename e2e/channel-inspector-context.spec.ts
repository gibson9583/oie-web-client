import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';
import { expectInspectorCode } from './inspector-code.js';
import AxeBuilder from '@axe-core/playwright';

const ID = 'inspector-context';
const resourceMap = (id: string, name: string) => ({ entry: { string: [id, name] } });

for (const body of ['', 'null', 'false', "globalMap.put('batch-marker', reader.readLine());\r\nreturn null;"]) {
    test(`batch source is searchable, printable and ordered before attachment/preprocessing: ${JSON.stringify(body)}`, async ({ page }) => {
        const channel: any = makeChannel(ID);
        channel.sourceConnector.properties.sourceConnectorProperties.processBatch = true;
        channel.sourceConnector.transformer.inboundProperties = { batchProperties: { '@class': 'com.mirth.connect.plugins.datatypes.hl7v2.HL7v2BatchProperties', splitType: 'JavaScript', batchScript: body } };
        await mockEngine(page, { [`GET /channels/${ID}`]: { channel } });
        await page.goto(`/channels/${ID}/inspect`);
        const batch = page.locator('#ci-batch');
        await expect(batch).toContainText('returns the next message');
        await batch.locator('.ci-item summary').click();
        await expectInspectorCode(batch, [body]);
        const order = await page.locator('.ci-section').evaluateAll(sections => sections.map(section => section.id));
        expect(order.indexOf('ci-batch')).toBeLessThan(order.indexOf('ci-preprocess'));
        if (body.includes('batch-marker')) {
            await page.getByPlaceholder('Find in channel').fill('batch-marker');
            await expect(batch.locator('.ci-item')).toHaveAttribute('data-hit', 'true');
            await expect(page.locator('#ci-maps')).toContainText('Source batch · Batch splitting script');
        }
        await page.getByRole('button', { name: 'Print', exact: true }).click();
        const printed = page.locator('.ci-print-section').filter({ has: page.locator('#print-ci-batch') });
        await expect(printed.locator('.ci-code .lc')).toHaveText(body.split(/\r\n|\r|\n/).map(line => line || ' '));
    });
}

for (const scenario of [{ process: false, mode: 'JavaScript' }, { process: true, mode: 'MSH_Segment' }, { process: true, mode: undefined }]) {
    test(`inactive batch source stays visible without active map claims: ${JSON.stringify(scenario)}`, async ({ page }) => {
        const channel: any = makeChannel(ID);
        channel.sourceConnector.properties.sourceConnectorProperties.processBatch = scenario.process;
        channel.sourceConnector.transformer.inboundProperties = { batchProperties: { '@class': 'com.mirth.connect.plugins.datatypes.hl7v2.HL7v2BatchProperties', splitType: scenario.mode, batchScript: "globalMap.put('inactive-batch-marker', 1);" } };
        await mockEngine(page, { [`GET /channels/${ID}`]: { channel } });
        await page.goto(`/channels/${ID}/inspect`);
        await expect(page.locator('#ci-batch .ci-item')).toHaveClass(/off/);
        await expect(page.locator('#ci-maps')).not.toContainText('inactive-batch-marker');
        await page.getByPlaceholder('Find in channel').fill('inactive-batch-marker');
        await expect(page.locator('#ci-batch .ci-code')).toBeVisible();
    });
}

test('library membership, deploy order and per-context resources share a printable snapshot', async ({ page }) => {
    const channel: any = makeChannel(ID);
    channel.properties.resourceIds = resourceMap('scripts-jar', 'Stored scripts name');
    channel.sourceConnector.properties.sourceConnectorProperties.resourceIds = resourceMap('Default Resource', 'Default Resource');
    const destination = channel.destinationConnectors.connector[0];
    destination.properties.destinationConnectorProperties.resourceIds = resourceMap('removed-jar', 'Missing resource');
    let libraryReads = 0, dependencyReads = 0, resourceReads = 0;
    const libraries = [
        { id: 'global-library', name: 'Shared helpers', includeNewChannels: true, codeTemplates: { codeTemplate: { id: 'template', name: 'normalizePatient', properties: { type: 'FUNCTION' }, contextSet: { delegate: { contextType: ['CHANNEL_BATCH', 'CHANNEL_PREPROCESSOR'] } } } } },
        { id: 'disabled-library', name: 'Excluded helpers', includeNewChannels: true, disabledChannelIds: { string: ID } },
        { id: 'explicit-library', name: 'Explicit helpers', includeNewChannels: false, enabledChannelIds: { string: ID } }
    ];
    await mockEngine(page, {
        [`GET /channels/${ID}`]: { channel },
        'GET /channels/idsAndNames': { map: { entry: [{ string: ['before', 'Prerequisite'] }, { string: ['after', 'Dependent'] }] } },
        'GET /codeTemplateLibraries': () => { libraryReads++; return { list: { codeTemplateLibrary: libraries } }; },
        'GET /server/channelDependencies': () => { dependencyReads++; return { set: { channelDependency: [{ dependentId: ID, dependencyId: 'before' }, { dependentId: 'after', dependencyId: ID }] } }; },
        'GET /server/resources': () => { resourceReads++; return { list: { 'com.mirth.connect.plugins.directoryresource.DirectoryResourceProperties': { id: 'scripts-jar', name: 'Shared Java', type: 'Directory', directory: '/opt/oie/custom-lib' } } }; }
    });
    await page.goto(`/channels/${ID}/inspect`);
    const context = page.locator('#ci-dependencies');
    await expect(context).toContainText('normalizePatient');
    await expect(context).toContainText('Explicit helpers');
    await expect(context).toContainText('channel batch, channel preprocessor');
    await expect(context).toContainText('Channel scripts · includes attachment, batch and response transformers');
    await expect(context).not.toContainText('Excluded helpers');
    await expect(context).toContainText('Prerequisite (before)');
    await expect(context).toContainText('Dependent (after)');
    await expect(context).toContainText('/opt/oie/custom-lib');
    await expect(context).toContainText('Missing resource (removed-jar) · unavailable on the server');
    await page.getByPlaceholder('Find in channel').fill('normalizePatient');
    await expect(context.locator('[data-hit]')).toHaveCount(1);
    const reads = [libraryReads, dependencyReads, resourceReads];
    await page.getByRole('button', { name: 'Print', exact: true }).click();
    await expect(page.locator('.ci-print-paper')).toContainText('normalizePatient');
    await expect(page.locator('.ci-print-paper')).toContainText('/opt/oie/custom-lib');
    expect([libraryReads, dependencyReads, resourceReads]).toEqual(reads);
});

test('reference rows keep template and resource details together across screen sizes and print', async ({ page }, info) => {
    const channel: any = makeChannel(ID);
    channel.properties.resourceIds = resourceMap('shared-java', 'Stored shared Java');
    channel.sourceConnector.properties.sourceConnectorProperties.resourceIds = resourceMap('Default Resource', 'Default Resource');
    const destination = channel.destinationConnectors.connector[0];
    channel.destinationConnectors.connector = ['Clinical store', 'EHR delivery', 'Archive', 'Analytics'].map((name, i) => ({
        ...structuredClone(destination), name, metaDataId: i + 1,
        properties: { ...structuredClone(destination.properties), destinationConnectorProperties: { ...destination.properties.destinationConnectorProperties, resourceIds: resourceMap('Default Resource', 'Default Resource') } }
    }));
    const contexts = ['SOURCE_RECEIVER', 'SOURCE_FILTER_TRANSFORMER', 'DESTINATION_FILTER_TRANSFORMER', 'DESTINATION_DISPATCHER', 'DESTINATION_RESPONSE_TRANSFORMER'];
    const names = ['normalizePatientIdentifier', 'archiveClinicalResult', 'lookupPatientEncounter', 'formatClinicalObservation', 'routeResultToDestination', 'initializeChannelResources'];
    await mockEngine(page, {
        [`GET /channels/${ID}`]: { channel },
        'GET /codeTemplateLibraries': { list: { codeTemplateLibrary: [
            { id: '9afb6aa5-2747-4180-a397-e3c98da2c5b0', name: 'Shared clinical helpers', includeNewChannels: true,
                description: 'Common functions used by channel scripts and connector transformers.',
                codeTemplates: { codeTemplate: names.map((name, i) => ({ id: 'template-' + i, name, properties: { type: 'FUNCTION' }, contextSet: { delegate: { contextType: i === 5 ? ['CHANNEL_DEPLOY'] : contexts } } })) } },
            { id: 'empty-library', name: 'Deployment helpers', includeNewChannels: true }
        ] } },
        'GET /server/resources': { list: { resource: [
            { id: 'Default Resource', name: '[Default Resource]', type: 'Directory', directory: 'custom-lib' },
            { id: 'shared-java', name: 'Shared Java libraries', type: 'Directory', directory: '/opt/oie/shared/java/libraries' }
        ] } }
    });
    await page.setViewportSize({ width: 1600, height: 1100 });
    await page.goto(`/channels/${ID}/inspect`);
    const context = page.locator('#ci-dependencies');
    const library = context.getByRole('region', { name: 'Shared clinical helpers', exact: true });
    const rows = library.getByRole('row');
    await expect(rows).toHaveCount(names.length + 1);
    await expect(rows.nth(1).getByRole('cell')).toHaveText([names[0], 'function', contexts.map(value => value.replaceAll('_', ' ').toLowerCase()).join(', ')]);
    await expect(rows.last().getByRole('cell')).toHaveText([names[5], 'function', 'channel deploy']);
    const resources = context.locator('.ci-reference-facts').last();
    await expect(resources.locator('dt')).toHaveCount(6);
    await expect(resources.locator('div').first()).toContainText('/opt/oie/shared/java/libraries');
    const wide = await resources.locator('div').first().evaluate(el => {
        const row = el.getBoundingClientRect();
        const label = el.querySelector('dt')!.getBoundingClientRect();
        const value = el.querySelector('dd')!.getBoundingClientRect();
        return { width: row.width, valueWidth: value.width, sideBySide: value.left > label.right && Math.abs(value.top - label.top) < 1 };
    });
    expect(wide.width).toBeGreaterThan(600);
    expect(wide.valueWidth).toBeGreaterThan(wide.width / 2);
    expect(wide.sideBySide).toBe(true);
    await library.scrollIntoViewIfNeeded();
    const capture = async (name: string) => {
        if (process.env.INSPECTOR_SCREENSHOTS === '1') await page.screenshot({ path: info.outputPath(name + '.png'), animations: 'disabled' });
    };
    if (await page.locator('html').getAttribute('data-theme') !== 'light') await page.getByRole('button', { name: 'Toggle light/dark mode' }).click();
    await capture('libraries-light');
    await resources.scrollIntoViewIfNeeded();
    await capture('resources-light');
    expect((await new AxeBuilder({ page }).include('#ci-dependencies').analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: 'Toggle light/dark mode' }).click();
    await library.scrollIntoViewIfNeeded();
    await capture('libraries-dark');
    expect((await new AxeBuilder({ page }).include('#ci-dependencies').analyze()).violations).toEqual([]);
    await page.setViewportSize({ width: 430, height: 900 });
    await page.locator('.rail-backdrop').click({ position: { x: 320, y: 300 } });
    const firstCells = rows.nth(1).getByRole('cell');
    const positions = await firstCells.evaluateAll(cells => cells.map(cell => cell.getBoundingClientRect().top));
    expect(positions[1]).toBeGreaterThan(positions[0]);
    expect(positions[2]).toBeGreaterThan(positions[1]);
    expect(await context.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await library.scrollIntoViewIfNeeded();
    await capture('libraries-mobile');
    await resources.scrollIntoViewIfNeeded();
    await capture('resources-mobile');
    await page.getByPlaceholder('Find in channel').fill(names[2]);
    await expect(context.locator('[data-hit]')).toHaveCount(1);
    await page.getByPlaceholder('Find in channel').fill('Template type');
    await expect(context.locator('[data-hit]')).toHaveCount(names.length);
    await page.getByRole('button', { name: 'Print', exact: true }).click();
    const preview = page.getByRole('dialog', { name: 'Print preview', exact: true });
    await expect(preview.getByRole('table', { name: 'Shared clinical helpers code templates' }).getByRole('row')).toHaveCount(names.length + 1);
    await expect(preview.locator('.ci-reference-facts').last().locator('dt')).toHaveCount(6);
    await expect(preview).toContainText('/opt/oie/shared/java/libraries');
});

test('denied libraries and a failed resource read preserve dependency and saved resource details, with retry', async ({ page }) => {
    const channel: any = makeChannel(ID);
    channel.properties.resourceIds = resourceMap('scripts-jar', 'Saved resource name');
    let failed = true;
    await mockEngine(page, {
        [`GET /channels/${ID}`]: { channel },
        'GET /codeTemplateLibraries': { __status: 403 },
        'GET /channels/idsAndNames': { __status: 403 },
        'GET /server/channelDependencies': { set: { channelDependency: { dependentId: ID, dependencyId: 'visible-id' } } },
        'GET /server/resources': () => failed ? { __status: 503 } : { list: { resource: { id: 'scripts-jar', name: 'Recovered resource', type: 'Directory' } } }
    });
    await page.goto(`/channels/${ID}/inspect`);
    const context = page.locator('#ci-dependencies');
    await expect(context).toContainText('Code template libraries unavailable with your permissions.');
    await expect(context).toContainText('visible-id');
    await expect(context).toContainText('Saved resource name');
    failed = false;
    await context.getByRole('button', { name: 'Retry Resource details', exact: true }).click();
    await expect(context).toContainText('Recovered resource');
    await expect(context).toContainText('Code template libraries unavailable with your permissions.');
});

test('plugin connector and unknown step settings are readable and credentials are omitted from screen and print', async ({ page }) => {
    const channel: any = makeChannel(ID);
    channel.sourceConnector.transportName = 'SQS Listener';
    Object.assign(channel.sourceConnector.properties, { queueUrl: 'https://sqs.us-east-1.amazonaws.com/123/test', maxMessages: 5, secretAccessKey: 'SECRET_SQS', region: 'us-east-1' });
    channel.sourceConnector.transformer.elements = { 'example.PluginStep': { name: 'Plugin settings', enabled: true, expression: "return msg['patient'];", config: { entry: [{ string: ['mode', 'merge'] }, { string: ['apiToken', 'SECRET_TOKEN'] }] } } };
    await mockEngine(page, { [`GET /channels/${ID}`]: { channel } });
    await page.goto(`/channels/${ID}/inspect`);
    await expect(page.locator('#ci-receive')).toContainText('https://sqs.us-east-1.amazonaws.com/123/test');
    await expect(page.locator('#ci-receive')).toContainText('us-east-1');
    await page.getByPlaceholder('Find in channel').fill('merge');
    await expect(page.locator('#ci-transform .ci-expr')).toContainText("return msg['patient'];");
    await expect(page.locator('.ci-root')).not.toContainText('SECRET_');
    await page.getByRole('button', { name: 'Print', exact: true }).click();
    await expect(page.locator('.ci-print-paper')).toContainText('merge');
    await expect(page.locator('.ci-print-paper')).not.toContainText('SECRET_');
});

test('Inspector merges fresh context with staged wizard intent without saving or mutating the draft', async ({ page }) => {
    const channel: any = makeChannel(ID);
    let graph: any[] = [], concurrent = false;
    const writes: string[] = [];
    await mockEngine(page, {
        [`GET /channels/${ID}`]: { channel },
        'GET /codeTemplateLibraries': () => ({ list: { codeTemplateLibrary: [
            { id: 'local-library', name: 'Locally selected helpers', revision: 1, includeNewChannels: false },
            { id: 'external-library', name: 'Concurrent helpers', revision: 1, includeNewChannels: concurrent }
        ] } }),
        'GET /channels/idsAndNames': { map: { entry: [{ string: ['local', 'Local prerequisite'] }, { string: ['external', 'External prerequisite'] }] } },
        'GET /server/channelDependencies': () => ({ set: { channelDependency: graph } })
    });
    page.on('request', request => { if (request.url().includes('/api/') && request.method() !== 'GET') writes.push(request.method() + ' ' + request.url()); });
    await page.goto(`/channels/${ID}/guided`);
    await page.locator('.wiz-step', { hasText: 'Dependencies' }).click();
    await page.getByRole('checkbox').first().check();
    await page.getByRole('tab', { name: 'Deploy/Start Dependencies', exact: true }).click();
    await page.getByRole('button', { name: 'Add channel', exact: true }).first().click();
    await page.locator('.modal').getByText('Local prerequisite', { exact: true }).click();
    await page.locator('.modal').getByRole('button', { name: /^Add/ }).click();
    concurrent = true;
    graph = [{ dependentId: ID, dependencyId: 'external' }];
    await page.getByRole('button', { name: 'Classic editor', exact: true }).click();
    await page.getByRole('tab', { name: 'Inspector', exact: true }).click();
    const context = page.locator('#ci-dependencies');
    await expect(context).toContainText('Locally selected helpers');
    await expect(context).toContainText('Concurrent helpers');
    await expect(context).toContainText('Local prerequisite (local)');
    await expect(context).toContainText('External prerequisite (external)');
    await expect(context).toContainText('Includes pending library or channel dependency selections');
    await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
    await expect(context).toContainText('Local prerequisite (local)');
    await page.getByRole('button', { name: 'Open in Wizard', exact: true }).click();
    await page.locator('.wiz-step', { hasText: 'Dependencies' }).click();
    await expect(page.getByRole('checkbox').first()).toBeChecked();
    await page.getByRole('tab', { name: 'Deploy/Start Dependencies', exact: true }).click();
    await expect(page.getByText('Local prerequisite', { exact: true })).toBeVisible();
    expect(writes).toEqual([]);
});
