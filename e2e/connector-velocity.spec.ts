import type { Page, Request } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { CASES, makeChannel } from './connector-fixtures.js';

// These string properties are resolved by the engine's ValueReplacer. Numeric
// inputs hide stored expressions; custom DOM fields must also preserve typing.
type VelocityCase = { name: string; key: string; extras: Record<string, unknown>; numeric: string; required?: boolean };
const fields: VelocityCase[] = [
    { name: 'TCP Sender', key: 'remotePort', extras: { serverMode: 'false' }, numeric: '06660' },
    { name: 'TCP Sender', key: 'localPort', extras: { overrideLocalBinding: 'true' }, numeric: '0' },
    { name: 'TCP Listener', key: 'listenerConnectorProperties.port', extras: {}, numeric: '6661' },
    { name: 'TCP Listener', key: 'remotePort', extras: { serverMode: 'false', remoteAddress: 'localhost' }, numeric: '6660' },
    { name: 'TCP Listener', key: 'responsePort', extras: { respondOnNewConnection: 1, responseAddress: 'localhost' }, numeric: '6662' },
    { name: 'SMTP Sender', key: 'smtpPort', extras: {}, numeric: '25' },
    { name: 'SMTP Sender', key: 'localPort', extras: { overrideLocalBinding: true }, numeric: '0' },
    { name: 'SMTP Sender', key: 'timeout', extras: {}, numeric: '5000' },
    { name: 'HTTP Sender', key: 'proxyPort', extras: { useProxyServer: true, proxyAddress: 'localhost' }, numeric: '8080' },
    { name: 'HTTP Sender', key: 'socketTimeout', extras: {}, numeric: '0' },
    { name: 'DICOM Sender', key: 'port', extras: {}, numeric: '104' },
    { name: 'DICOM Sender', key: 'localPort', extras: { localHost: 'localhost' }, numeric: '0', required: false },
    { name: 'Web Service Sender', key: 'socketTimeout', extras: {}, numeric: '0' },
    { name: 'Document Writer', key: 'pageWidth', extras: {}, numeric: '8.5' },
    { name: 'Document Writer', key: 'pageHeight', extras: {}, numeric: '11' },
];

function setFieldValue(properties: any, key: string, value: string) {
    const path = key.split('.');
    const parent = path.slice(0, -1).reduce((obj, part) => obj[part], properties);
    parent[path.at(-1)!] = value;
}

async function showPanel(page: Page, name: string) {
    await page.getByRole('tab', { name: name === 'TCP Listener' ? 'Source' : 'Destinations', exact: true }).click();
    await expect(page.locator('.cform-section').first()).toBeVisible();
}

async function openField(page: Page, spec: VelocityCase) {
    const connector = CASES.find(c => c.name === spec.name)!;
    const id = `velocity-field-${fields.indexOf(spec)}`;
    const properties = { ...connector.properties(), ...spec.extras };
    setFieldValue(properties, spec.key, '${SavedValue}');
    let stored = makeChannel(id, {
        [connector.mode === 'SOURCE' ? 'source' : 'destination']: { transportName: spec.name, properties },
    });
    const state = { writes: [] as any[], tests: [] as any[], failure: '' as '' | 'http' | 'refused' };
    await mockEngine(page, {
        [`GET /channels/${id}`]: () => ({ channel: stored }),
        [`PUT /channels/${id}`]: (request: Request) => {
            const submitted = request.postDataJSON().channel;
            state.writes.push(submitted);
            if (state.failure === 'http') return { __status: 503, body: { error: 'Connector save unavailable' } };
            if (state.failure === 'refused') return false;
            stored = submitted;
            return true;
        },
        'POST /connectors/tcp/_testConnection': (request: Request) => {
            state.tests.push(request.postDataJSON());
            return { connectionTestResponse: { type: 'SUCCESS', message: 'Connection tested' } };
        },
    });
    await page.goto(`/channels/${id}/edit`);
    await showPanel(page, spec.name);
    const savedProperties = () => connector.mode === 'SOURCE'
        ? stored.sourceConnector.properties : stored.destinationConnectors.connector[0].properties;
    return { state, properties, savedProperties, input: page.locator(`[data-fkey="${spec.key}"]`) };
}

for (const spec of fields) {
    test(`${spec.name}: ${spec.key} loads, edits and saves Velocity expressions and numeric literals`, async ({ page }) => {
        const { state, properties, savedProperties, input } = await openField(page, spec);
        // Loaded expressions must be visible, including on the XML read path.
        await expect(input).toHaveValue('${SavedValue}');
        await expect(input).toBeEnabled();

        const prerequisite = spec.name === 'SMTP Sender' && spec.key === 'localPort' ? 'overrideLocalBinding'
            : spec.name === 'HTTP Sender' && spec.key === 'proxyPort' ? 'useProxyServer' : null;
        if (prerequisite) {
            const radios = page.locator(`[data-fkey="${prerequisite}"]`);
            await radios.getByRole('radio', { name: 'No', exact: true }).check();
            await expect(input).toBeDisabled();
            await expect(input).toHaveValue('${SavedValue}');
            await radios.getByRole('radio', { name: 'Yes', exact: true }).check();
            await expect(input).toBeEnabled();
            await expect(input).toHaveValue('${SavedValue}');
        }

        // Required-field validation still applies to blank and whitespace values.
        for (const blank of spec.required === false ? [] : ['', '   ']) {
            await input.fill(blank);
            await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
            const dialog = page.getByRole('dialog', { name: 'Cannot Save Channel', exact: true });
            await expect(dialog).toContainText('is required');
            await expect(input).toHaveClass(/cform-invalid/);
            expect(state.writes).toHaveLength(0);
            await dialog.getByRole('button', { name: 'OK', exact: true }).click();
        }

        const values = ['${ConfiguredValue}', '$ConfiguredValue', spec.numeric, ...(spec.required === false ? [''] : [])];
        for (const [index, value] of values.entries()) {
            await input.fill('');
            await input.pressSequentially(value);
            await expect(input).toHaveValue(value);
            await expect(input).toBeFocused();
            // Save directly after typing: the action must use the live value.
            await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
            await expect.poll(() => state.writes.length).toBe(index + 1);
            await expect(page.locator('.content-row')).not.toHaveAttribute('inert');
            const expected = structuredClone(properties);
            setFieldValue(expected, spec.key, value);
            expect(savedProperties()).toEqual(expected);
            await expect(input).not.toHaveClass(/cform-invalid/);
            await page.reload();
            await showPanel(page, spec.name);
            await expect(input).toHaveValue(value);
        }
    });
}

for (const failure of ['http', 'refused'] as const) {
    test(`TCP Sender: port expressions survive mode changes and ${failure} save failure before retry`, async ({ page }) => {
        const { state, input, savedProperties } = await openField(page, fields[0]);
        const localPort = page.locator('[data-fkey="localPort"]');
        await input.fill('${InteleOrchestratorPort}');
        await expect(localPort).toBeDisabled();
        await page.locator('[data-fkey="overrideLocalBinding"]').getByRole('radio', { name: 'Yes', exact: true }).check();
        await localPort.fill('${LocalPort}');

        await page.locator('[data-fkey="serverMode"]').getByRole('radio', { name: 'Server', exact: true }).check();
        await expect(input).toBeDisabled();
        await expect(input).toHaveValue('${InteleOrchestratorPort}');
        await expect(localPort).toBeEnabled();
        await expect(page.getByRole('button', { name: 'Test Connection', exact: true })).toBeDisabled();
        await page.locator('[data-fkey="serverMode"]').getByRole('radio', { name: 'Client', exact: true }).check();
        await expect(input).toBeEnabled();
        await expect(localPort).toHaveValue('${LocalPort}');
        await page.getByRole('tab', { name: 'Summary', exact: true }).click();
        await showPanel(page, 'TCP Sender');
        await expect(input).toHaveValue('${InteleOrchestratorPort}');

        // Test Connection also receives the expression unchanged after a remount.
        await input.fill('${LatestPort}');
        await page.getByRole('button', { name: 'Test Connection', exact: true }).click();
        await expect.poll(() => state.tests.length).toBe(1);
        expect(state.tests[0]['com.mirth.connect.connectors.tcp.TcpDispatcherProperties']).toMatchObject({
            remotePort: '${LatestPort}', localPort: '${LocalPort}',
        });

        state.failure = failure;
        await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect.poll(() => state.writes.length).toBe(1);
        if (failure === 'refused') {
            const conflict = page.getByRole('dialog', { name: 'Channel Modified', exact: true });
            await expect(conflict).toBeVisible();
            await conflict.getByRole('button', { name: 'Cancel', exact: true }).click();
        } else {
            const error = page.getByRole('dialog', { name: 'Error', exact: true });
            await expect(error).toBeVisible();
            await error.getByRole('button', { name: 'Close', exact: true }).last().click();
        }
        await expect(input).toHaveValue('${LatestPort}');
        await expect(localPort).toHaveValue('${LocalPort}');
        expect(savedProperties().remotePort).toBe('${SavedValue}');
        state.failure = '';
        await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect.poll(() => state.writes.length).toBe(2);
        // Save timestamps legitimately change on retry; connector contents must not.
        expect(state.writes[1].destinationConnectors).toEqual(state.writes[0].destinationConnectors);
        expect(savedProperties()).toMatchObject({ remotePort: '${LatestPort}', localPort: '${LocalPort}' });
        await expect(page.locator('.content-row')).not.toHaveAttribute('inert');
        await page.reload();
        await showPanel(page, 'TCP Sender');
        await expect(input).toHaveValue('${LatestPort}');
        await expect(localPort).toHaveValue('${LocalPort}');
    });
}

test('channel wizard saves TCP source and destination port expressions', async ({ page }, testInfo) => {
    const writes: any[] = [];
    await mockEngine(page, {
        'POST /channels': (request: Request) => { writes.push(request.postDataJSON().channel); return true; },
    });
    await page.goto('/channels/new/guided');
    await page.locator('.view-body input').first().fill('TCP Variables');
    const next = page.getByRole('button', { name: 'Next', exact: true });
    // Basics, dependencies and channel options lead to the source connector.
    for (let i = 0; i < 3; i++) await next.click();
    await page.getByRole('button', { name: 'TCP Listener', exact: true }).click();
    await page.locator('[data-fkey="listenerConnectorProperties.port"]').fill('${ListenerPort}');
    await next.click();
    await page.getByRole('button', { name: 'TCP Sender', exact: true }).click();
    const port = page.locator('[data-fkey="remotePort"]');
    await port.fill('${InteleOrchestratorPort}');
    await port.scrollIntoViewIfNeeded();
    await testInfo.attach('tcp-port-variable', { body: await page.screenshot(), contentType: 'image/png' });
    await next.click(); // Scripts
    await next.click(); // Review
    await page.getByRole('main').getByRole('button', { name: 'Create Channel', exact: true }).click();
    await expect(page).toHaveURL(/\/channels$/);
    expect(writes).toHaveLength(1);
    expect(writes[0].sourceConnector.properties.listenerConnectorProperties.port).toBe('${ListenerPort}');
    expect(writes[0].destinationConnectors.connector[0].properties.remotePort).toBe('${InteleOrchestratorPort}');
});

test('Document Writer keeps typing focus, presets and units synchronized through save retry', async ({ page }, testInfo) => {
    const spec = fields.find(field => field.name === 'Document Writer' && field.key === 'pageWidth')!;
    const { state, input: width, savedProperties } = await openField(page, spec);
    const height = page.locator('[data-fkey="pageHeight"]');
    const row = width.locator('..');
    const unit = row.locator('select').nth(0);
    const preset = row.locator('select').nth(1);
    await expect(preset).toHaveValue('CUSTOM');

    await width.fill('');
    await width.pressSequentially('8.5');
    await expect(width).toBeFocused();
    await expect(preset).toHaveValue('Letter');
    await expect(preset.locator('option[value="CUSTOM"]')).toHaveCount(0);
    // parseFloat would misidentify this expression as the Letter preset.
    await width.pressSequentially('${extra}');
    await expect(width).toHaveValue('8.5${extra}');
    await expect(width).toBeFocused();
    await expect(preset).toHaveValue('CUSTOM');
    // Editing in the middle must preserve both the DOM node and caret.
    await width.evaluate((input: HTMLInputElement) => input.setSelectionRange(5, 10));
    await page.keyboard.type('width');
    await expect(width).toHaveValue('8.5${width}');
    await expect(width).toBeFocused();

    await preset.selectOption('A4');
    await expect(width).toHaveValue('210.00');
    await expect(height).toHaveValue('297.00');
    await expect(unit).toHaveValue('MM');
    await expect(preset).toHaveValue('A4');
    await unit.selectOption('INCHES');
    await expect(preset).toHaveValue('CUSTOM');
    await expect(width).toHaveValue('210.00');
    await expect(height).toHaveValue('297.00');
    await unit.selectOption('MM');
    await expect(preset).toHaveValue('A4');

    await width.fill('');
    await width.pressSequentially('${PageWidth}');
    await height.fill('');
    await height.pressSequentially('${PageHeight}');
    await expect(height).toBeFocused();
    await expect(preset).toHaveValue('CUSTOM');
    // A separate form refresh must rebuild from the current model, not defaults.
    await page.locator('[data-fkey="documentType"]').getByRole('radio', { name: 'RTF', exact: true }).check();
    await expect(width).toHaveValue('${PageWidth}');
    await expect(height).toHaveValue('${PageHeight}');
    await expect(preset).toHaveValue('CUSTOM');
    await width.scrollIntoViewIfNeeded();
    const screenshot = testInfo.outputPath('document-dimensions.png');
    await page.screenshot({ path: screenshot });
    await testInfo.attach('document-dimensions', { path: screenshot, contentType: 'image/png' });

    state.failure = 'http';
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    const error = page.getByRole('dialog', { name: 'Error', exact: true });
    await expect(error).toBeVisible();
    await error.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(width).toHaveValue('${PageWidth}');
    await expect(height).toHaveValue('${PageHeight}');
    state.failure = '';
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(2);
    expect(savedProperties()).toMatchObject({ pageWidth: '${PageWidth}', pageHeight: '${PageHeight}', pageUnit: 'MM' });
    await expect(page.locator('.content-row')).not.toHaveAttribute('inert');
    await page.reload();
    await showPanel(page, 'Document Writer');
    await expect(width).toHaveValue('${PageWidth}');
    await expect(height).toHaveValue('${PageHeight}');
    await expect(unit).toHaveValue('MM');
    await expect(preset).toHaveValue('CUSTOM');
});

// Keep each save/reload sample independent so all six round trips do not share
// a single test deadline on slower CI runners.
for (const [w, h, u, name] of [
    ['8.5D', '11D', 'INCHES', 'Letter'],
    ['8.5d', '11f', 'INCHES', 'Letter'],
    ['+85e-1F', '1.1e+1d', 'INCHES', 'Letter'],
    ['.85e1', '11.', 'INCHES', 'Letter'],
    [' 8.5D ', ' 11D ', 'INCHES', 'Letter'],
    ['0210.0F', '0297D', 'MM', 'A4'],
]) {
    test(`Document Writer recognizes Java decimal dimensions without changing saved text: ${JSON.stringify(w)}`, async ({ page }) => {
        const spec = fields.find(field => field.name === 'Document Writer' && field.key === 'pageWidth')!;
        const { state, input: width, savedProperties } = await openField(page, spec);
        const height = page.locator('[data-fkey="pageHeight"]');
        const unit = width.locator('..').locator('select').nth(0);
        const preset = width.locator('..').locator('select').nth(1);
        await width.fill(w);
        await height.fill(h);
        await unit.selectOption(u);
        await expect(preset).toHaveValue(name);
        await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect.poll(() => state.writes.length).toBe(1);
        await expect(page.locator('.content-row')).not.toHaveAttribute('inert');
        expect(savedProperties()).toMatchObject({ pageWidth: w, pageHeight: h, pageUnit: u });
        await page.reload();
        await showPanel(page, 'Document Writer');
        await expect(width).toHaveValue(w);
        await expect(height).toHaveValue(h);
        await expect(preset).toHaveValue(name);
    });
}

test('Document Writer keeps JavaScript-only numbers and partial expressions Custom', async ({ page }) => {
    const spec = fields.find(field => field.name === 'Document Writer' && field.key === 'pageWidth')!;
    const { input: width } = await openField(page, spec);
    const height = page.locator('[data-fkey="pageHeight"]');
    const unit = width.locator('..').locator('select').nth(0);
    const preset = width.locator('..').locator('select').nth(1);
    // Reject JavaScript-only forms, non-Java whitespace and non-finite dimensions.
    await unit.selectOption('MM');
    for (const [w, h] of [
        ['0xD2', '0x129'],
        ['0b11010010', '0b100101001'],
        ['0o322', '0o451'],
        ['210\u00a0', '297'],
        ['210\u2028', '297'],
        ['NaN', '297'],
        ['Infinity', '297'],
        ['1e309', '297'],
    ]) {
        await width.fill(w);
        await height.fill(h);
        await expect(preset).toHaveValue('CUSTOM');
        await expect(width).toHaveValue(w);
        await expect(height).toHaveValue(h);
    }
    await unit.selectOption('INCHES');
    for (const w of ['8.5${extra}', '8.5D${extra}', '8.5DD']) {
        await width.fill(w);
        await height.fill('11');
        await expect(preset).toHaveValue('CUSTOM');
    }
});

test('channel wizard keeps Document Writer dimensions editable through navigation and creation', async ({ page }) => {
    const writes: any[] = [];
    await page.route('**/vendor/monaco/**', route => route.abort());
    await mockEngine(page, {
        'POST /channels': (request: Request) => { writes.push(request.postDataJSON().channel); return true; },
    });
    await page.goto('/channels/new/guided');
    await page.locator('.view-body input').first().fill('Document Variables');
    const next = page.getByRole('button', { name: 'Next', exact: true });
    for (let i = 0; i < 4; i++) await next.click();
    await page.getByRole('button', { name: 'Document Writer', exact: true }).click();
    await page.locator('[data-fkey="output"]').getByRole('radio', { name: 'Attachment', exact: true }).check();
    await page.locator('[data-fkey="template"] textarea.ce-area').fill('${message.encodedData}');
    const width = page.locator('[data-fkey="pageWidth"]');
    const height = page.locator('[data-fkey="pageHeight"]');
    for (const [input, value] of [[width, '${WizardWidth}'], [height, '${WizardHeight}']] as const) {
        await input.fill('');
        await input.pressSequentially(value);
        await expect(input).toHaveValue(value);
        await expect(input).toBeFocused();
    }
    await next.click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(width).toHaveValue('${WizardWidth}');
    await expect(height).toHaveValue('${WizardHeight}');
    await next.click();
    await next.click();
    await page.getByRole('main').getByRole('button', { name: 'Create Channel', exact: true }).click();
    await expect(page).toHaveURL(/\/channels$/);
    expect(writes).toHaveLength(1);
    expect(writes[0].destinationConnectors.connector[0].properties).toMatchObject({
        pageWidth: '${WizardWidth}', pageHeight: '${WizardHeight}', pageUnit: 'INCHES', output: 'ATTACHMENT',
    });
});

test('Document Writer imports rebind dimension edits without changing the original connector', async ({ page }) => {
    const spec = fields.find(field => field.name === 'Document Writer' && field.key === 'pageWidth')!;
    const { state, properties, input: width } = await openField(page, spec);
    const importedProperties = { ...properties, pageWidth: '${ImportedWidth}', pageHeight: '${ImportedHeight}', pageUnit: 'MM' };
    const imported = { connector: { transportName: 'Document Writer', mode: 'DESTINATION', properties: importedProperties } };
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Connector', exact: true }).click();
    await (await chooser).setFiles({ name: 'document.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
    await expect(width).toHaveValue('${ImportedWidth}');
    const height = page.locator('[data-fkey="pageHeight"]');
    await expect(height).toHaveValue('${ImportedHeight}');
    await width.fill('');
    await width.pressSequentially('${EditedWidth}');
    await expect(width).toBeFocused();
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
    const destinations = state.writes[0].destinationConnectors.connector;
    expect(destinations).toHaveLength(2);
    expect(destinations[0].properties).toEqual(properties);
    expect(destinations[1].properties).toEqual({ ...importedProperties, pageWidth: '${EditedWidth}' });
});
