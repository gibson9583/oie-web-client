import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel, CASES } from './connector-fixtures.js';
import type { Locator, Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

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
    await focusCodeOffset(editor, (await codeValue(editor)).length);
}

async function focusCodeOffset(editor: Locator, offset: number) {
    await editor.evaluate((el, offset) => {
        const instance = (window as any).monaco?.editor.getEditors().find((ed: any) => el.contains(ed.getDomNode()));
        if (instance) {
            instance.setPosition(instance.getModel().getPositionAt(offset));
            instance.focus();
        } else {
            const area = el.querySelector('textarea.ce-area') as HTMLTextAreaElement;
            area.focus();
            area.setSelectionRange(offset, offset);
        }
    }, offset);
}

async function expectCompletionScope(page: Page, channelId: string, context: string) {
    await expect.poll(() => page.evaluate(async () => {
        const path = '/core/script-completions.js';
        return (await import(path)).activeScope();
    })).toEqual({ channelId, contexts: [context] });
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
        test(`${surface} ${backend}: JavaScript Writer saves Swing snippets in expressions, strings and E4X`, async ({ page }, testInfo) => {
            let expected = 'var transformed = ;\nvar channel = ;\nvar external = "";\nvar xml = <root></root>;\n\nreturn transformed;';
            const save = await openMappings(page, surface, fallback, 'JavaScript Writer', { script: expected });
            const editor = await codeField(page, 'script', fallback);
            await focusCodeOffset(editor, expected.indexOf(';'));
            await mapping(page, 'Transformed Data').click();
            expected = expected.replace('var transformed = ;', 'var transformed = connectorMessage.getTransformedData();');
            await expect.poll(() => codeValue(editor)).toBe(expected);
            await focusCodeOffset(editor, expected.indexOf(';\nvar external'));
            await dropMapping(page, mapping(page, 'Channel ID'), editor.locator(fallback ? 'textarea.ce-area' : '.monaco-editor'));
            expected = expected.replace('var channel = ;', "var channel = $('Channel ID');");
            await expect.poll(() => codeValue(editor)).toBe(expected);

            // A plain external text drop is literal, even if it happens to
            // contain the same text as a known destination mapping.
            await focusCodeOffset(editor, expected.indexOf('""') + 1);
            const external = await page.evaluateHandle(() => {
                const data = new DataTransfer();
                data.setData('text/plain', '${channelId}');
                return data;
            });
            await editor.locator(fallback ? 'textarea.ce-area' : '.monaco-editor').dispatchEvent('drop', { dataTransfer: external });
            await external.dispose();
            expected = expected.replace('""', '"${channelId}"');
            await expect.poll(() => codeValue(editor)).toBe(expected);

            // Swing retains CDATA in JavaScript: it is an XML fragment, so test
            // insertion in an E4X literal rather than as a standalone expression.
            await expect(mapping(page, 'Count')).toHaveCount(0);
            await focusCodeOffset(editor, expected.indexOf('</root>'));
            await dropMapping(page, mapping(page, 'CDATA Tag'), editor.locator(fallback ? 'textarea.ce-area' : '.monaco-editor'));
            expected = expected.replace('<root></root>', '<root><![CDATA[]]></root>');
            await expect.poll(() => codeValue(editor)).toBe(expected);

            await editor.locator('.ce-pop-btn').click({ force: true });
            const overlay = page.locator('.ce-popout-overlay');
            await expect(overlay.locator('.ce-popout-var', { hasText: 'Transformed Data' })).toHaveAttribute('title', 'connectorMessage.getTransformedData()');
            await expect(overlay.locator('.ce-popout-var').filter({ hasText: /^Count$/ })).toHaveCount(0);
            await expect(overlay.locator('.ce-popout-var', { hasText: 'CDATA Tag' })).toHaveAttribute('title', '<![CDATA[]]>');
            await focusCodeOffset(overlay.locator('.ce'), expected.indexOf('\n\nreturn') + 1);
            await overlay.locator('.ce-popout-var', { hasText: 'Unique ID' }).click();
            expected = expected.replace('\n\nreturn', '\nvar uuid = UUIDGenerator.getUUID();\nreturn');
            await expect.poll(() => codeValue(overlay.locator('.ce'))).toBe(expected);
            await overlay.getByRole('button', { name: 'Back', exact: true }).click();
            const saved = await save();
            expect(saved.script).toBe(expected);
            // Preserve the browser's actual PUT script for Rhino execution in
            // the engine-context audit; this is code, not commented-out tokens.
            const scriptPath = testInfo.outputPath('saved-script.js');
            await writeFile(scriptPath, saved.script);
            await testInfo.attach('saved-script', { path: scriptPath, contentType: 'application/javascript' });
        });

        test(`${surface} ${backend}: Database Writer saves JavaScript mappings while Use JavaScript is enabled`, async ({ page }) => {
            const save = await openMappings(page, surface, fallback, 'Database Writer', { query: 'SELECT 1' });
            await page.locator('[data-fkey="useScript"]').getByRole('radio', { name: 'Yes', exact: true }).check();
            const editor = await codeField(page, 'query', fallback);
            const boilerplate = await codeValue(editor);
            await focusCodeEnd(editor);
            if (!fallback) await expectCompletionScope(page, 'destination-mapping', 'DESTINATION_DISPATCHER');
            await mapping(page, 'Unique ID').click();
            const expected = boilerplate + 'var uuid = UUIDGenerator.getUUID();';
            await expect.poll(() => codeValue(editor)).toBe(expected);
            await expect(mapping(page, 'Count')).toHaveCount(0);

            // Swing's transfer mode belongs to the destination connector, so
            // its plain text fields receive the same JavaScript snippets.
            const username = page.locator('input[data-fkey="username"]');
            await username.fill('mapped-');
            await mapping(page, 'Channel ID').click();
            await dropMapping(page, mapping(page, 'Raw Data'), username);
            const expectedUsername = "mapped-$('Channel ID')connectorMessage.getRawData()";
            await expect(username).toHaveValue(expectedUsername);
            const saved = await save();
            expect(saved.useScript).toBe(true);
            expect(saved.query).toBe(expected);
            expect(saved.username).toBe(expectedUsername);
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

test('generic code views insert their supplied variables literally regardless of language', async ({ page }) => {
    await page.route('**/vendor/monaco/**', route => route.abort());
    await mockEngine(page);
    await page.goto('/channels');
    await expect(page.getByRole('button', { name: 'New Channel', exact: true }).first()).toBeVisible();
    for (const language of ['default', 'javascript', 'js', 'rhino', 'custom']) {
        const expected = await page.evaluate(async language => {
            const editorPath = '/core/codeeditor.js';
            const mappingsPath = '/core/mappings.js';
            const { createCodeEditor } = await import(editorPath);
            const { DESTINATION_MAPPINGS } = await import(mappingsPath);
            const variables = language === 'custom' ? [['Channel ID', '${channelId}'], ['Count', '${COUNT}']] : DESTINATION_MAPPINGS;
            const editor = createCodeEditor({
                language: language === 'default' ? undefined : language === 'custom' ? 'javascript' : language,
                maximizable: true,
                popoutVars: variables,
            });
            editor.el.id = 'mapping-probe';
            document.body.appendChild(editor.el);
            (window as any).mappingProbe = editor;
            return variables.find(([label]: [string, string]) => label === 'Channel ID')[1];
        }, language);
        await page.locator('#mapping-probe .ce-pop-btn').click({ force: true });
        const overlay = page.locator('.ce-popout-overlay');
        const channelId = overlay.locator('.ce-popout-var').filter({ hasText: /^Channel ID$/ });
        await expect(channelId).toHaveAttribute('title', expected);
        await expect(overlay.locator('.ce-popout-var').filter({ hasText: /^Count$/ })).toHaveCount(1);
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

for (const name of ['JavaScript Reader', 'Database Reader', 'HTTP Listener']) {
    for (const fallback of [false, true]) {
        test(`${name} ${fallback ? 'textarea' : 'Monaco'}: source code views do not offer destination-only mappings`, async ({ page }) => {
            if (fallback) await page.route('**/vendor/monaco/**', route => route.abort());
            const id = 'source-mapping-context';
            const source = connector(name, name === 'Database Reader' ? { useScript: true, updateMode: 3, select: 'return [];', update: 'return;' } : {});
            if (name === 'HTTP Listener') source.properties.pluginProperties = {
                'com.mirth.connect.plugins.httpauth.javascript.JavaScriptHttpAuthProperties': {
                    '@version': '4.6.0', authType: 'JAVASCRIPT', script: 'return AUTHORIZED;',
                },
            };
            await mockEngine(page, { [`GET /channels/${id}`]: { channel: makeChannel(id, { source }) } });
            await page.goto(`/channels/${id}/edit`);
            await page.getByRole('tab', { name: 'Source', exact: true }).click();
            const editors = page.locator('.ce');
            await expect(editors).toHaveCount(name === 'Database Reader' ? 2 : 1);
            for (let index = 0; index < await editors.count(); index++) {
                const editor = editors.nth(index);
                await expect(editor.locator(fallback ? 'textarea.ce-area' : '.monaco-editor')).toBeVisible();
                await editor.locator('.ce-pop-btn').click({ force: true });
                const overlay = page.locator('.ce-popout-overlay');
                await expect(overlay).toBeVisible();
                await expect(overlay.locator('.ce-popout-vars')).toHaveCount(0);
                if (!fallback) await expectCompletionScope(page, id, 'SOURCE_RECEIVER');
                await overlay.getByRole('button', { name: 'Back', exact: true }).click();
            }
        });
    }
}

test('HTTP authentication releases its completion scope when its script editor is removed', async ({ page }) => {
    const id = 'auth-scope-disposal';
    await mockEngine(page, { [`GET /channels/${id}`]: {
        channel: makeChannel(id, { source: connector('HTTP Listener') }),
    } });
    await page.goto(`/channels/${id}/edit`);
    await page.getByRole('tab', { name: 'Source', exact: true }).click();
    const authType = page.locator('.field').filter({ has: page.getByText('Authentication Type', { exact: true }) }).locator('select');
    const readScope = () => page.evaluate(async () => {
        const path = '/core/script-completions.js';
        return (await import(path)).activeScope();
    });
    const previousScope = await readScope();

    await authType.selectOption('JAVASCRIPT');
    const editor = page.locator('.ce');
    await expect(editor.locator('.monaco-editor')).toBeVisible();
    await focusCodeEnd(editor);
    await expectCompletionScope(page, id, 'SOURCE_RECEIVER');

    // This unmount does not change routes, so the route-level Monaco sweep
    // cannot hide an incorrect destroy/dispose hook in the plugin.
    await authType.selectOption('NONE');
    await expect(editor).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as any).monaco.editor.getModels().length)).toBe(0);
    await expect.poll(readScope).toEqual(previousScope);

    await page.getByRole('tab', { name: 'Scripts', exact: true }).click();
    await expect(editor.locator('.monaco-editor')).toBeVisible();
    await focusCodeEnd(editor);
    await expectCompletionScope(page, id, 'CHANNEL_DEPLOY');
    await expect.poll(() => page.evaluate(() => (window as any).monaco.editor.getModels().length)).toBe(1);
});
