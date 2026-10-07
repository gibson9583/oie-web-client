import type { Page } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';

const targetOf = (channel: any, route: string) => route === 'transformer/0' ? channel.sourceConnector.transformer
    : channel.destinationConnectors.connector[0][route.startsWith('response') ? 'responseTransformer' : 'transformer'];
const decode = (value: any) => value?.['@encoding'] === 'base64' ? Buffer.from(value.$, 'base64').toString('utf8') : value;
const field = (page: Page, side = 'Inbound') => page.getByRole('textbox', { name: `${side} Template`, exact: true });
const panel = (page: Page) => page.getByRole('tabpanel', { name: 'Message Templates', exact: true });
const focus = (page: Page, side = 'Inbound') => panel(page).locator('.ce').nth(side === 'Inbound' ? 0 : 1).locator('.view-lines').click({ position: { x: 20, y: 10 } });

async function setup(page: Page, route = 'transformer/0', inbound = '  original\rsegment', outbound = '{"original":true}') {
    let channel = makeChannel('templates');
    Object.assign(targetOf(channel, route), { inboundTemplate: inbound, outboundTemplate: outbound, outboundDataType: 'JSON' });
    const writes: any[] = [];
    await mockEngine(page, {
        'GET /channels/templates': () => ({ channel }),
        'PUT /channels/templates': (request: any) => { channel = request.postDataJSON().channel; writes.push(channel); return true; }
    });
    await page.goto(`/channels/templates/${route}`);
    await page.getByRole('tab', { name: 'Message Templates', exact: true }).click();
    return writes;
}

async function snapshot(page: Page, side = 'Inbound') {
    return page.evaluate(side => {
        const monaco = (window as any).monaco;
        const editor = monaco.editor.getEditors().find((e: any) => e.getOption(monaco.editor.EditorOption.ariaLabel) === `${side} Template`);
        return { value: editor.getValue(), language: editor.getModel().getLanguageId(),
            insertSpaces: editor.getModel().getOptions().insertSpaces };
    }, side);
}

for (const fallback of [false, true]) {
    for (const sample of [
        { name: 'blank first field', keys: ['Space', 'Space', 'Tab', 's'], value: '  \ts' },
        { name: 'empty-field row', keys: ['Tab', 'Enter', 'n'], value: '\t\nn' },
        { name: 'closing brace', keys: ['{', 'Enter', 'Space', 'Space', 'Space', 'Space', '}'], value: '{\n    }' },
        { name: 'closing bracket', keys: ['[', 'Enter', 'Space', 'Space', ']'], value: '[\n  ]' },
        { name: 'text input closing brace', keys: ['{', 'Enter'], text: '    }', value: '{\n    }' },
    ]) {
        test(`${fallback ? 'fallback' : 'Monaco'} preserves literal ${sample.name} through save`, async ({ page }) => {
            if (fallback) await page.route('**/vendor/monaco/**', route => route.abort());
            const writes = await setup(page, 'transformer/0', '', '');
            if (!fallback) await expect(panel(page).locator('.ce-monaco')).toHaveCount(2);
            // The outbound side uses JSON, including its electric closing brackets.
            await field(page, 'Outbound').focus();
            for (const key of sample.keys) await page.keyboard.press(key);
            if (sample.text) await page.keyboard.insertText(sample.text);
            const value = fallback ? await field(page, 'Outbound').inputValue() : (await snapshot(page, 'Outbound')).value;
            expect(value.replaceAll('\r\n', '\n')).toBe(sample.value);
            await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
            await expect.poll(() => writes.length).toBe(1);
            expect(decode(targetOf(writes[0], 'transformer/0').outboundTemplate)).toBe(value);
        });
    }
}

for (const route of ['transformer/0', 'transformer/1', 'response/1']) {
    test(`${route}: templates find text, retain literal input, and round-trip both sides`, async ({ page }) => {
        const writes = await setup(page, route);
        const mac = await page.evaluate(() => navigator.userAgent.includes('Macintosh'));
        const modifier = mac ? 'Meta' : 'Control';
        await expect(panel(page).locator('.ce-monaco')).toHaveCount(2);
        await expect(panel(page).locator('.line-numbers').filter({ hasText: /^1$/ }).first()).toBeVisible();
        expect(await snapshot(page)).toMatchObject({ language: 'hl7v2', insertSpaces: false });
        expect(await snapshot(page, 'Outbound')).toMatchObject({ language: 'json', insertSpaces: false });
        expect(await page.evaluate(async () => (await import(String('/core/store.js'))).getState('editingChannelDirty'))).toBeFalsy();

        await focus(page);
        await page.keyboard.press(`${modifier}+f`);
        await expect(panel(page).locator('.find-widget.visible')).toHaveCount(1);
        await page.keyboard.press('Escape');
        await focus(page);
        await page.keyboard.press(`${modifier}+a`);
        await page.keyboard.type('  A');
        await page.keyboard.press('Tab');
        await page.keyboard.type('B');
        await page.keyboard.press('Enter');
        await page.keyboard.type('C');
        expect((await snapshot(page)).value).toBe('  A\tB\nC');
        await page.keyboard.press(mac ? 'Control+Shift+m' : 'Control+m');
        await page.keyboard.press('Tab');
        await expect(field(page)).not.toBeFocused();
        // Restore the global Monaco Tab behavior before editing the other side.
        await focus(page, 'Outbound');
        await page.keyboard.press(mac ? 'Control+Shift+m' : 'Control+m');
        await page.keyboard.press(`${modifier}+a`);
        await page.keyboard.type('{"');
        expect((await snapshot(page, 'Outbound')).value).toBe('{"');
        await expect(panel(page).locator('.suggest-widget.visible')).toHaveCount(0);

        await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
        await expect.poll(() => writes.length).toBe(1);
        expect(decode(targetOf(writes[0], route).inboundTemplate)).toBe('  A\tB\nC');
        expect(decode(targetOf(writes[0], route).outboundTemplate)).toBe('{"');
        await focus(page, 'Outbound');
        await page.keyboard.press(`${modifier}+a`);
        await page.keyboard.press('Backspace');
        await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
        await expect.poll(() => writes.length).toBe(2);
        expect(targetOf(writes[1], route).outboundTemplate).toBeNull();
    });
}

test('literal typing preserves multiple cursors, selections and undo/redo', async ({ page }) => {
    await setup(page, 'transformer/0', '', '');
    await expect(panel(page).locator('.ce-monaco')).toHaveCount(2);
    const modifier = await page.evaluate(() => navigator.userAgent.includes('Macintosh') ? 'Meta' : 'Control');
    await page.evaluate(() => {
        const m = (window as any).monaco;
        const editor = m.editor.getEditors().find((e: any) => e.getOption(m.editor.EditorOption.ariaLabel) === 'Outbound Template');
        editor.setValue('  \n  ');
        editor.setSelections([new m.Selection(1, 3, 1, 3), new m.Selection(2, 3, 2, 3)]);
        editor.focus();
    });
    await page.keyboard.press('Tab');
    expect((await snapshot(page, 'Outbound')).value).toBe('  \t\n  \t');
    await page.keyboard.press(`${modifier}+z`);
    expect((await snapshot(page, 'Outbound')).value).toBe('  \n  ');
    await page.keyboard.press(`${modifier}+Shift+z`);
    expect((await snapshot(page, 'Outbound')).value).toBe('  \t\n  \t');
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press('Tab');
    expect((await snapshot(page, 'Outbound')).value).toBe('\t');
    await page.keyboard.press('Shift+Tab');
    expect((await snapshot(page, 'Outbound')).value).toBe('');

    await page.evaluate(() => {
        const m = (window as any).monaco;
        const editor = m.editor.getEditors().find((e: any) => e.getOption(m.editor.EditorOption.ariaLabel) === 'Outbound Template');
        editor.setValue('{\n    ');
        editor.setPosition({ lineNumber: 2, column: 5 });
    });
    await page.keyboard.press('}');
    expect((await snapshot(page, 'Outbound')).value).toBe('{\n    }');
    await page.keyboard.press(`${modifier}+z`);
    expect((await snapshot(page, 'Outbound')).value).toBe('{\n    ');
    await page.keyboard.press(`${modifier}+Shift+z`);
    expect((await snapshot(page, 'Outbound')).value).toBe('{\n    }');
    expect((await snapshot(page)).value).toBe('');
});

test('literal handlers leave find inputs, read-only editors and normal script Tab behavior intact', async ({ page }) => {
    await setup(page, 'transformer/0', '', '  ');
    await expect(panel(page).locator('.ce-monaco')).toHaveCount(2);
    await field(page, 'Outbound').focus();
    const modifier = await page.evaluate(() => navigator.userAgent.includes('Macintosh') ? 'Meta' : 'Control');
    await page.keyboard.press(`${modifier}+f`);
    await page.keyboard.type('}');
    expect((await snapshot(page, 'Outbound')).value).toBe('  ');
    await expect(panel(page).getByRole('textbox', { name: 'Find', exact: true })).toHaveValue('}');
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
        const m = (window as any).monaco;
        const editor = m.editor.getEditors().find((e: any) => e.getOption(m.editor.EditorOption.ariaLabel) === 'Outbound Template');
        editor.updateOptions({ readOnly: true, tabFocusMode: true }); editor.focus();
        const next = document.createElement('input');
        next.setAttribute('aria-label', 'After editor');
        editor.getDomNode().closest('.field').appendChild(next);
    });
    await page.keyboard.press('}');
    await page.keyboard.press('Tab');
    expect((await snapshot(page, 'Outbound')).value).toBe('  ');
    await expect(page.getByRole('textbox', { name: 'After editor', exact: true })).toBeFocused();

    await page.evaluate(async () => {
        const { createCodeEditor } = await import(String('/core/codeeditor.js'));
        const editor = createCodeEditor({ value: '  ', language: 'javascript', ariaLabel: 'Ordinary Script' });
        editor.el.style.height = '160px';
        document.body.appendChild(editor.el);
    });
    const script = page.locator('.ce-monaco').getByRole('textbox', { name: 'Ordinary Script', exact: true });
    await expect(script).toHaveCount(1);
    await script.focus();
    await page.keyboard.press('End');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => {
        const m = (window as any).monaco;
        return m.editor.getEditors().find((e: any) => e.getOption(m.editor.EditorOption.ariaLabel) === 'Ordinary Script').getValue();
    })).toBe('\t');
});

test('a failed save retains the template draft and retry writes it once', async ({ page }) => {
    const writes = await setup(page);
    await expect(panel(page).locator('.ce-monaco')).toHaveCount(2);
    await focus(page);
    await page.keyboard.press(await page.evaluate(() => navigator.userAgent.includes('Macintosh') ? 'Meta+a' : 'Control+a'));
    await page.keyboard.type('unsaved template');
    let attempts = 0, release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/channels/templates*', async route => {
        if (route.request().method() !== 'PUT' || ++attempts > 1) return route.fallback();
        await gate;
        await route.fulfill({ status: 503, json: { error: 'synthetic save failure' } });
    });
    const save = page.getByRole('button', { name: 'Save Channel', exact: true, includeHidden: true });
    await save.click();
    await expect.poll(() => attempts).toBe(1);
    expect(await panel(page).locator('.ce').first().evaluate(el => !!el.closest('[inert]'))).toBe(true);
    await save.evaluate(button => (button as HTMLButtonElement).click());
    expect(attempts).toBe(1);
    release();
    const error = page.getByRole('dialog', { name: 'Error', exact: true });
    await expect(error).toBeVisible();
    await error.getByRole('button', { name: 'Close', exact: true }).last().click();
    expect((await snapshot(page)).value).toBe('unsaved template');
    expect(await page.evaluate(async () => (await import(String('/core/store.js'))).getState('editingChannelDirty'))).toBe(true);
    await save.click();
    await expect.poll(() => writes.length).toBe(1);
    expect(attempts).toBe(2);
    expect(decode(targetOf(writes[0], 'transformer/0').inboundTemplate)).toBe('unsaved template');
});

test('type changes, files and tab remounts preserve template content and release models', async ({ page }) => {
    const writes = await setup(page);
    await expect(panel(page).locator('.ce-monaco')).toHaveCount(2);
    for (const [type, language] of [['XML', 'xml'], ['HL7V2', 'hl7v2'], ['JSON', 'json'], ['HL7V3', 'xml'], ['DICOM', 'xml'], ['DELIMITED', 'plaintext'], ['EDI/X12', 'plaintext'], ['RAW', 'plaintext']]) {
        await panel(page).getByRole('combobox').first().selectOption(type);
        const warning = page.getByRole('dialog', { name: 'Warning', exact: true });
        await warning.getByRole('button', { name: 'Close', exact: true }).last().click();
        await expect.poll(async () => (await snapshot(page)).language).toBe(language);
        expect((await snapshot(page)).value).toBe('  original\nsegment');
    }
    const file = await Promise.all([
        page.waitForEvent('filechooser'),
        panel(page).getByRole('button', { name: 'Open File…', exact: true }).first().click()
    ]);
    await file[0].setFiles({ name: 'sample.txt', mimeType: 'text/plain', buffer: Buffer.from('患者\tÅ\rnext') });
    await expect.poll(async () => (await snapshot(page)).value).toBe('患者\tÅ\nnext');
    await page.getByRole('tab', { name: 'Reference', exact: true }).click();
    expect(await page.evaluate(() => (window as any).monaco.editor.getEditors().filter((e: any) => / Template$/.test(e.getOption((window as any).monaco.editor.EditorOption.ariaLabel))).length)).toBe(0);
    await page.getByRole('tab', { name: 'Message Templates', exact: true }).click();
    await expect(panel(page).locator('.ce-monaco')).toHaveCount(2);
    expect((await snapshot(page)).value).toBe('患者\tÅ\nnext');
    await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(decode(targetOf(writes[0], 'transformer/0').inboundTemplate)).toBe('患者\tÅ\rnext');
});

async function hoverField(page: Page, lineNumber = 2, column = 14) {
    await page.evaluate(async position => {
        const monaco = (window as any).monaco;
        const editor = monaco.editor.getEditors().find((e: any) => e.getOption(monaco.editor.EditorOption.ariaLabel) === 'Inbound Template');
        editor.focus(); editor.setPosition(position);
        await editor.getAction('editor.action.showHover').run();
    }, { lineNumber, column });
}

test('HL7 shares browser tokens and field hovers while preserving untouched wire text', async ({ page }) => {
    const text = 'MSH|^~\\&|APP|FAC\rPID|1||123||Doe^Jane~Smith^John\r   \r';
    const writes = await setup(page, 'transformer/0', text);
    await expect(panel(page).locator('.ce-monaco')).toHaveCount(2);
    let requests = 0;
    await page.route('**/api/webplugins*', route => route.fulfill({ json: [] }));
    await page.route('**/api/datatypes/_serialize*', route => {
        requests++;
        return route.fulfill({ json: { format: 'xml', data: '<HL7Message/>', meta: { descriptions: { 'PID.5': 'Patient Name', 'PID.5.2': 'Given Name' } } } });
    });
    const rendered = await page.evaluate(async text => {
        const { renderHighlighted } = await import(String('/core/content-highlight.js'));
        const pre = document.createElement('pre');
        renderHighlighted(pre, text, { dataType: 'HL7V2' });
        const monaco = (window as any).monaco;
        const editor = monaco.editor.getEditors().find((e: any) => e.getOption(monaco.editor.EditorOption.ariaLabel) === 'Inbound Template');
        return { text: pre.textContent, fields: Array.from(pre.querySelectorAll('[data-tooltip]'), el => el.getAttribute('data-tooltip')),
            tokens: monaco.editor.tokenize(editor.getValue(), 'hl7v2'), folding: editor.getOption(monaco.editor.EditorOption.folding) };
    }, text);
    expect(rendered.text).toBe(text.replaceAll('\r', '\n'));
    expect(rendered.fields).toContain('MSH-3');
    expect(rendered.tokens[1]).toEqual(expect.arrayContaining([expect.objectContaining({ offset: 0, type: 'hl7-seg' }), expect.objectContaining({ offset: 3, type: 'hl7-sep' })]));
    expect(rendered.folding).toBe(false);
    expect(requests).toBe(0);
    await hoverField(page);
    await expect(page.locator('.monaco-hover:visible')).toContainText('PID-5');
    await expect(page.locator('.monaco-hover:visible')).toContainText('Patient Name');
    await expect(panel(page).locator('.hoverHighlight').first()).toBeVisible();
    await expect(panel(page).locator('.hoverHighlight').first()).toHaveCSS('background-color',
        await page.evaluate(() => {
            const sample = document.createElement('span');
            sample.style.backgroundColor = 'var(--accent-glow)'; document.body.appendChild(sample);
            const color = getComputedStyle(sample).backgroundColor;
            sample.remove(); return color;
        }));
    await page.keyboard.press('Escape');
    await hoverField(page, 2, 17);
    await expect(page.locator('.monaco-hover:visible')).toContainText('PID-5.2');
    await expect(page.locator('.monaco-hover:visible')).toContainText('Given Name');
    expect(requests).toBe(1);
    expect(await page.evaluate(async () => (await import(String('/core/store.js'))).getState('editingChannelDirty'))).toBeFalsy();
    await page.keyboard.press('Escape');
    // A real edit on the other side makes a save available without touching HL7.
    await focus(page, 'Outbound');
    await page.keyboard.type(' ');
    await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(decode(targetOf(writes[0], 'transformer/0').inboundTemplate)).toBe(text);
});

test('HL7 field paths survive serializer failure, retry, and edits during a delayed lookup', async ({ page }) => {
    await setup(page, 'transformer/0', 'MSH|^~\\&|APP\nPID|1||123||Doe^Jane');
    await expect(panel(page).locator('.ce-monaco')).toHaveCount(2);
    await page.route('**/api/webplugins*', route => route.fulfill({ json: [] }));
    let requests = 0, release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/datatypes/_serialize*', async route => {
        const request = ++requests;
        if (request === 1) return route.fulfill({ status: 503, json: { error: 'unavailable' } });
        if (request === 2) await gate;
        return route.fulfill({ json: { format: 'xml', data: '<HL7Message/>', meta: { descriptions: { 'PID.5': request === 2 ? 'STALE NAME' : '[Current](command:unsafe)' } } } });
    });
    await hoverField(page);
    await expect(page.locator('.monaco-hover:visible')).toContainText('PID-5');
    await expect.poll(() => requests).toBe(1);
    await page.keyboard.press('Escape');
    await hoverField(page);
    await expect.poll(() => requests).toBe(2);
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
        const monaco = (window as any).monaco;
        const editor = monaco.editor.getEditors().find((e: any) => e.getOption(monaco.editor.EditorOption.ariaLabel) === 'Inbound Template');
        editor.executeEdits('test', [{ range: new monaco.Range(1, 1, 1, 1), text: '\n' }]);
    });
    release();
    await hoverField(page, 3);
    await expect(page.locator('.monaco-hover:visible')).toContainText('[Current](command:unsafe)');
    await expect(page.locator('.monaco-hover:visible')).not.toContainText('STALE NAME');
    await expect(page.locator('.monaco-hover:visible a')).toHaveCount(0);
    expect(requests).toBe(3);
    await page.getByRole('tab', { name: 'Reference', exact: true }).click();
    expect(await page.evaluate(() => (window as any).monaco.editor.getModels().filter((m: any) => m.getLanguageId() === 'hl7v2').length)).toBe(0);
});

test('fallback templates retain literal tabs/newlines and allow keyboard focus to leave', async ({ page }) => {
    await page.route('**/vendor/monaco/**', route => route.abort());
    const writes = await setup(page);
    await expect(panel(page).locator('.ce').first()).toBeVisible();
    await field(page).fill('  A');
    await field(page).press('End');
    await page.keyboard.press('Tab');
    await page.keyboard.type('B');
    await page.keyboard.press('Enter');
    await page.keyboard.type('C');
    await expect(field(page)).toHaveValue('  A\tB\nC');
    await page.keyboard.press('Control+m');
    await page.keyboard.press('Tab');
    await expect(field(page)).not.toBeFocused();
    await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(decode(targetOf(writes[0], 'transformer/0').inboundTemplate)).toBe('  A\tB\nC');
});

test('disposing a fallback before Monaco loads cannot create an orphan model', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/dashboard');
    const result = await page.evaluate(async () => {
        const { createCodeEditor } = await import(String('/core/codeeditor.js'));
        const { ensureMonaco } = await import(String('/core/monaco.js'));
        const editor = createCodeEditor({ value: 'disposed template', literalInput: true });
        document.body.appendChild(editor.el);
        editor.dispose(); editor.el.remove();
        await ensureMonaco();
        return !!editor.monaco;
    });
    expect(result).toBe(false);
});

test('large templates have usable line numbers and a resizable editor', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const text = Array.from({ length: 1500 }, (_, n) => `PID|${n}|sample`).join('\r');
    await setup(page, 'transformer/0', text);
    await expect(panel(page).locator('.ce-monaco')).toHaveCount(2);
    expect((await snapshot(page)).value).toBe(text.replaceAll('\r', '\n'));
    const editor = panel(page).locator('.ce').first();
    await expect(editor).toHaveCSS('resize', 'vertical');
    await page.screenshot({ path: testInfo.outputPath('templates-desktop.png') });
    await page.setViewportSize({ width: 900, height: 800 });
    await expect(editor).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('templates-tablet.png') });
});
