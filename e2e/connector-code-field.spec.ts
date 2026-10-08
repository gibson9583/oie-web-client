import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel, CASES } from './connector-fixtures.js';
import type { Locator, Page } from '@playwright/test';

/*
 * Connector code fields (react-forms CodeField): the editor keeps every
 * keystroke when renders lag behind typing, and a programmatic property change
 * (Web Service Generate Envelope) still reaches the editor.
 */

const connector = (name: string, patch: any = {}) => {
    const c = CASES.find((k: any) => k.name === name)!;
    return { transportName: c.name, properties: { ...(c.properties as any)(), ...patch } };
};
const models = (page: any) => page.evaluate(() => (window as any).monaco.editor.getModels()
    .map((m: any) => m.getValue()).join('|'));

test('typing into a connector code field keeps every keystroke on a slow machine', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'CPU throttling is a Chromium DevTools feature');
    const id = 'code-field-typing';
    await mockEngine(page, { [`GET /channels/${id}`]: { channel: makeChannel(id, { source: connector('JavaScript Reader') }) } });
    await page.goto(`/channels/${id}/edit`);
    await page.getByRole('tab', { name: 'Source', exact: true }).click();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 8 });
    await page.locator('.ce .monaco-editor').first().click();
    await page.keyboard.press('ControlOrMeta+End');
    const text = 'typedQuicklyabcdefghijklmnop';
    await page.keyboard.type(text);
    await expect.poll(() => models(page)).toContain(text);
});

test('Generate Envelope replaces the SOAP envelope in the editor', async ({ page }) => {
    const id = 'code-field-envelope';
    const envelope = '<soapenv:Envelope><soapenv:Body>generated</soapenv:Body></soapenv:Envelope>';
    await mockEngine(page, {
        [`GET /channels/${id}`]: { channel: makeChannel(id, {
            destination: connector('Web Service Sender', { operation: 'getPatient', envelope: '', soapAction: '' })
        }) },
        'POST /connectors/ws/_isWsdlCached': { boolean: true },
        'POST /connectors/ws/_generateEnvelope': envelope,
        'POST /connectors/ws/_getSoapAction': 'urn:getPatient'
    });
    await page.goto(`/channels/${id}/edit`);
    await page.getByRole('tab', { name: 'Destinations', exact: true }).click();
    await expect(page.locator('.ce .monaco-editor').first()).toBeVisible();
    await page.getByRole('button', { name: 'Generate Envelope', exact: true }).click();
    await expect.poll(() => models(page)).toContain(envelope);
});

// Exercise both mappings rails against the actual receiving editor. Database
// Writer can replace its SQL editor with JavaScript after the rail has rendered.
async function openMappings(page: Page, surface: string, fallback: boolean, name: string, patch: any) {
    if (fallback) await page.route('**/vendor/monaco/**', route => route.abort());
    const id = 'destination-mapping';
    let channel = makeChannel(id, { destination: connector(name, patch) });
    const writes: any[] = [];
    await mockEngine(page, {
        [`GET /channels/${id}`]: () => ({ channel }),
        [`PUT /channels/${id}`]: (request: any) => {
            channel = request.postDataJSON().channel;
            writes.push(channel);
            return '';
        },
    });
    await page.goto(`/channels/${id}/${surface === 'wizard' ? 'guided' : 'edit'}`);
    if (surface === 'wizard') await page.locator('.wiz-step', { hasText: 'Destinations' }).click();
    else await page.getByRole('tab', { name: 'Destinations', exact: true }).click();
    await expect(page.locator('.cform-section').first()).toBeVisible();
    return async () => {
        await page.getByRole('button', { name: 'Save Changes', exact: true }).first().click();
        await expect.poll(() => writes.length).toBe(1);
        const dests = writes[0].destinationConnectors.connector;
        return (Array.isArray(dests) ? dests[0] : dests).properties;
    };
}

async function codeField(page: Page, key: string, fallback: boolean) {
    const editor = page.locator(`[data-fkey="${key}"] .ce`);
    await expect(editor.locator(fallback ? 'textarea.ce-area' : '.monaco-editor')).toBeVisible();
    return editor;
}

const codeValue = (editor: Locator) => editor.evaluate(el => {
    const instance = (window as any).monaco?.editor.getEditors().find((ed: any) => el.contains(ed.getDomNode()));
    return instance ? instance.getValue() as string : (el.querySelector('textarea.ce-area') as HTMLTextAreaElement).value;
});

async function focusCodeEnd(editor: Locator) {
    await editor.evaluate(el => {
        const instance = (window as any).monaco?.editor.getEditors().find((ed: any) => el.contains(ed.getDomNode()));
        if (instance) {
            const model = instance.getModel();
            const lineNumber = model.getLineCount();
            instance.setPosition({ lineNumber, column: model.getLineMaxColumn(lineNumber) });
            instance.focus();
        } else {
            const area = el.querySelector('textarea.ce-area') as HTMLTextAreaElement;
            area.focus();
            area.setSelectionRange(area.value.length, area.value.length);
        }
    });
}

const mapping = (page: Page, label: string) => page.locator('[draggable="true"][title]').filter({ hasText: new RegExp(`^${label}$`) });

async function dropMapping(page: Page, source: Locator, target: Locator) {
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await source.dispatchEvent('dragstart', { dataTransfer });
    await target.dispatchEvent('drop', { dataTransfer });
    await source.dispatchEvent('dragend', { dataTransfer });
    await dataTransfer.dispose();
}

for (const surface of ['classic', 'wizard']) {
    for (const fallback of [false, true]) {
        const backend = fallback ? 'textarea' : 'Monaco';
        test(`${surface} ${backend}: JavaScript Writer mappings click, drop and code view save Rhino expressions`, async ({ page }) => {
            const save = await openMappings(page, surface, fallback, 'JavaScript Writer', { script: '// mapping: ' });
            const editor = await codeField(page, 'script', fallback);
            await focusCodeEnd(editor);
            await mapping(page, 'Transformed Data').click();
            let expected = '// mapping: connectorMessage.getTransformedData()';
            await expect.poll(() => codeValue(editor)).toBe(expected);
            await dropMapping(page, mapping(page, 'Channel ID'), editor.locator(fallback ? 'textarea.ce-area' : '.monaco-editor'));
            expected += 'channelId';
            await expect.poll(() => codeValue(editor)).toBe(expected);

            // A plain external text drop is literal, even if it happens to
            // contain the same text as a known destination mapping.
            const external = await page.evaluateHandle(() => {
                const data = new DataTransfer();
                data.setData('text/plain', '${channelId}');
                return data;
            });
            await editor.locator(fallback ? 'textarea.ce-area' : '.monaco-editor').dispatchEvent('drop', { dataTransfer: external });
            await external.dispose();
            expected += '${channelId}';
            await expect.poll(() => codeValue(editor)).toBe(expected);

            // These have no script equivalent; neither click nor drop may write
            // invalid JavaScript or silently copy the template token instead.
            await mapping(page, 'Count').click();
            const warning = page.getByRole('dialog', { name: 'Warning', exact: true });
            await expect(warning).toContainText('This mapping is only available in template fields');
            await expect.poll(() => codeValue(editor)).toBe(expected);
            await warning.getByRole('button', { name: 'Close', exact: true }).last().click();
            await dropMapping(page, mapping(page, 'CDATA Tag'), editor.locator(fallback ? 'textarea.ce-area' : '.monaco-editor'));
            await expect(warning).toContainText('This mapping is only available in template fields');
            await expect.poll(() => codeValue(editor)).toBe(expected);
            await warning.getByRole('button', { name: 'Close', exact: true }).last().click();

            await editor.locator('.ce-pop-btn').click({ force: true });
            const overlay = page.locator('.ce-popout-overlay');
            await expect(overlay.locator('.ce-popout-var', { hasText: 'Transformed Data' })).toHaveAttribute('title', 'connectorMessage.getTransformedData()');
            await expect(overlay.locator('.ce-popout-var').filter({ hasText: /^(Count|CDATA Tag)$/ })).toHaveCount(0);
            await overlay.locator('.ce-popout-var', { hasText: 'Unique ID' }).click();
            expected += 'UUIDGenerator.getUUID()';
            await expect.poll(() => codeValue(overlay.locator('.ce'))).toBe(expected);
            await overlay.getByRole('button', { name: 'Back', exact: true }).click();
            expect((await save()).script).toBe(expected);
        });

        test(`${surface} ${backend}: Database Writer mappings follow SQL to JavaScript to SQL switches`, async ({ page }) => {
            const save = await openMappings(page, surface, fallback, 'Database Writer', { query: 'SELECT ' });
            let editor = await codeField(page, 'query', fallback);
            await focusCodeEnd(editor);
            await mapping(page, 'Channel ID').click();
            await expect.poll(() => codeValue(editor)).toBe('SELECT ${channelId}');

            await page.locator('[data-fkey="useScript"]').getByRole('radio', { name: 'Yes', exact: true }).check();
            editor = await codeField(page, 'query', fallback);
            const boilerplate = await codeValue(editor);
            await focusCodeEnd(editor);
            await dropMapping(page, mapping(page, 'Transformed Data'), editor.locator(fallback ? 'textarea.ce-area' : '.monaco-editor'));
            await expect.poll(() => codeValue(editor)).toBe(boilerplate + 'connectorMessage.getTransformedData()');

            await page.locator('[data-fkey="useScript"]').getByRole('radio', { name: 'No', exact: true }).check();
            editor = await codeField(page, 'query', fallback);
            await focusCodeEnd(editor);
            await mapping(page, 'Transformed Data').click();
            await expect.poll(() => codeValue(editor)).toBe('${message.transformedData}');
            const saved = await save();
            expect(saved.useScript).toBe(false);
            expect(saved.query).toBe('${message.transformedData}');
        });
    }

    test(`${surface}: template fields retain Velocity tokens and template-only mappings`, async ({ page }) => {
        const save = await openMappings(page, surface, true, 'File Writer', { template: '' });
        const editor = await codeField(page, 'template', true);
        await focusCodeEnd(editor);
        await mapping(page, 'Transformed Data').click();
        await dropMapping(page, mapping(page, 'Count'), editor.locator('textarea.ce-area'));
        await expect.poll(() => codeValue(editor)).toBe('${message.transformedData}${COUNT}');
        await editor.locator('.ce-pop-btn').click({ force: true });
        const overlay = page.locator('.ce-popout-overlay');
        await expect(overlay.locator('.ce-popout-var', { hasText: 'Transformed Data' })).toHaveAttribute('title', '${message.transformedData}');
        await overlay.locator('.ce-popout-var', { hasText: 'CDATA Tag' }).click();
        await overlay.getByRole('button', { name: 'Back', exact: true }).click();

        // Classic's controlled text inputs must still update their saved property.
        if (surface === 'classic') {
            const filename = page.locator('input[data-fkey="outputPattern"]');
            await filename.fill('mapped-');
            await mapping(page, 'Channel ID').click();
            await dropMapping(page, mapping(page, 'Unique ID'), filename);
            await expect(filename).toHaveValue('mapped-${channelId}${UUID}');
        }
        const saved = await save();
        expect(saved.template).toBe('${message.transformedData}${COUNT}<![CDATA[]]>');
        if (surface === 'classic') expect(saved.outputPattern).toBe('mapped-${channelId}${UUID}');
    });
}

test('fallback code views resolve default and alias JavaScript languages while custom variables stay literal', async ({ page }) => {
    await page.route('**/vendor/monaco/**', route => route.abort());
    await mockEngine(page);
    await page.goto('/channels');
    await expect(page.getByRole('button', { name: 'New Channel', exact: true }).first()).toBeVisible();
    for (const language of ['default', 'js', 'rhino', 'custom']) {
        await page.evaluate(async language => {
            const editorPath = '/core/codeeditor.js';
            const mappingsPath = '/core/mappings.js';
            const { createCodeEditor } = await import(editorPath);
            const { DESTINATION_MAPPINGS } = await import(mappingsPath);
            const editor = createCodeEditor({
                language: language === 'default' ? undefined : language === 'custom' ? 'javascript' : language,
                maximizable: true,
                popoutVars: language === 'custom' ? [['Channel ID', '${channelId}'], ['Count', '${COUNT}']] : DESTINATION_MAPPINGS,
            });
            editor.el.id = 'mapping-probe';
            document.body.appendChild(editor.el);
            (window as any).mappingProbe = editor;
        }, language);
        await page.locator('#mapping-probe .ce-pop-btn').click({ force: true });
        const overlay = page.locator('.ce-popout-overlay');
        const channelId = overlay.locator('.ce-popout-var').filter({ hasText: /^Channel ID$/ });
        const expected = language === 'custom' ? '${channelId}' : 'channelId';
        await expect(channelId).toHaveAttribute('title', expected);
        await expect(overlay.locator('.ce-popout-var').filter({ hasText: /^Count$/ })).toHaveCount(language === 'custom' ? 1 : 0);
        await channelId.click();
        await expect(overlay.locator('textarea.ce-area')).toHaveValue(expected);
        await overlay.getByRole('button', { name: 'Back', exact: true }).click();
        await page.evaluate(() => {
            (window as any).mappingProbe.dispose();
            (window as any).mappingProbe.el.remove();
            delete (window as any).mappingProbe;
        });
    }
});
