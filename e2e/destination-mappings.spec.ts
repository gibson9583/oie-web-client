import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel, CASES } from './connector-fixtures.js';
import type { Locator, Page } from '@playwright/test';

const JS = 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep';
const RULE = 'com.mirth.connect.plugins.javascriptrule.JavaScriptRule';
const MAPPER = 'com.mirth.connect.plugins.mapper.MapperStep';
const scriptStage = (script: string, type = JS) => ({ [type]: { '@version': '4.6.0', enabled: true, name: 'Mappings script', sequenceNumber: 0, operator: 'NONE', script } });

function fixture(mode: string) {
    const spec = CASES.find((entry: any) => entry.name === (mode === 'js' ? 'JavaScript Writer' : 'File Writer'))!;
    const channel = makeChannel('destination-mappings', { destination: { transportName: spec.name, properties: spec.properties() } });
    channel.sourceConnector.filter.elements = scriptStage("$c('sourceRule', 1); $co('sourceLocal', 1);", RULE);
    channel.sourceConnector.transformer.elements = { [MAPPER]: { '@version': '4.6.0', name: 'Now', sequenceNumber: 0, enabled: true, variable: 'nowstr', mapping: "'now'", defaultValue: '', replacements: '', scope: 'CHANNEL' } };
    const earlier = channel.destinationConnectors.connector[0];
    earlier.metaDataId = 4;
    earlier.name = 'Get data from database';
    earlier.enabled = false;
    earlier.filter.elements = scriptStage("$g('earlierRule', 1); $co('earlierRuleLocal', 1);", RULE);
    earlier.transformer.elements = scriptStage("$c('patID', 1); $co('earlierLocal', 1); // $c('commented', 1);");
    earlier.responseTransformer.elements = scriptStage("$r('previousResponse', 1); $co('previousResponseLocal', 1);");
    const selected = structuredClone(earlier);
    selected.metaDataId = 9;
    selected.name = 'Send';
    selected.enabled = true;
    selected.filter.elements = scriptStage("$c('selectedRule', 1); $co('selectedRuleLocal', 1);", RULE);
    selected.transformer.elements = scriptStage("$co('selectedLocal', 1); $c('d4', 1);");
    selected.responseTransformer.elements = scriptStage("$c('selectedResponse', 1);");
    const later = structuredClone(selected);
    later.metaDataId = 12;
    later.name = 'Later';
    later.transformer.elements = scriptStage("$c('later', 1);");
    channel.destinationConnectors.connector = [earlier, selected, later];
    channel.nextMetaDataId = 13;
    return channel;
}

async function open(page: Page, surface: string, mode = 'js', fallback = true) {
    if (fallback) await page.route('**/vendor/monaco/**', route => route.abort());
    let channel = fixture(mode);
    const writes: any[] = [];
    await mockEngine(page, {
        'GET /channels/destination-mappings': () => ({ channel }),
        'PUT /channels/destination-mappings': (req: any) => {
            channel = req.postDataJSON().channel;
            writes.push(channel);
            return '';
        }
    });
    await page.goto(`/channels/destination-mappings/${surface === 'wizard' ? 'guided' : 'edit'}`);
    await destinations(page, surface);
    return writes;
}

async function destinations(page: Page, surface: string) {
    if (surface === 'wizard') await page.locator('.wiz-step', { hasText: 'Destinations' }).click();
    else await page.getByRole('tab', { name: 'Destinations', exact: true }).click();
}

async function selectDestination(page: Page, surface: string, index: number) {
    const row = surface === 'wizard' ? page.locator('.step-list > .step-item').nth(index) : page.locator('.dest-grid tbody tr').nth(index).locator('td.num');
    await row.click();
}

const rail = (page: Page, surface: string) => surface === 'wizard'
    ? page.locator('.panel').filter({ has: page.locator('.panel-header', { hasText: 'Destination Mappings' }) }).last()
    : page.locator('.dest-mappings');
const mapping = (container: Locator, label: string) => container.locator('[draggable="true"][title]').filter({ hasText: new RegExp(`^${label}$`) });

async function codeField(page: Page, mode: string, fallback: boolean) {
    const editor = page.locator(`[data-fkey="${mode === 'js' ? 'script' : 'template'}"] .ce`);
    await expect(editor.locator(fallback ? 'textarea.ce-area' : '.monaco-editor')).toBeVisible();
    return editor;
}

async function focusEnd(editor: Locator) {
    await editor.evaluate(el => {
        const instance = (window as any).monaco?.editor.getEditors().find((ed: any) => el.contains(ed.getDomNode()));
        if (instance) {
            instance.setPosition(instance.getModel().getPositionAt(instance.getValue().length));
            instance.focus();
        } else {
            const area = el.querySelector('textarea.ce-area') as HTMLTextAreaElement;
            area.focus();
            area.setSelectionRange(area.value.length, area.value.length);
        }
    });
}

const value = (editor: Locator) => editor.evaluate(el => {
    const instance = (window as any).monaco?.editor.getEditors().find((ed: any) => el.contains(ed.getDomNode()));
    return instance?.getValue() ?? (el.querySelector('textarea.ce-area') as HTMLTextAreaElement).value;
});

async function drag(page: Page, source: Locator, target: Locator) {
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await source.dispatchEvent('dragstart', { dataTransfer });
    await target.dispatchEvent('drop', { dataTransfer });
    await source.dispatchEvent('dragend', { dataTransfer });
    await dataTransfer.dispose();
}

for (const surface of ['classic', 'wizard']) {
    for (const fallback of [true, false]) for (const mode of ['js', 'file']) {
        test(`${surface} ${mode} ${fallback ? 'textarea' : 'Monaco'}: channel mappings follow selection and insert through rail and code view`, async ({ page }) => {
            const writes = await open(page, surface, mode, fallback);
            const refs = rail(page, surface);
            await expect(mapping(refs, 'earlierLocal')).toHaveCount(1);
            await expect(mapping(refs, 'Get data from database')).toHaveCount(0);
            await selectDestination(page, surface, 1);
            const expected = ['sourceRule', 'earlierRule', 'Get data from database', 'selectedRule', 'selectedRuleLocal', 'nowstr', 'patID', 'previousResponse', 'selectedLocal', 'd4'];
            await expect.poll(async () => (await refs.locator('[draggable="true"][title]').allTextContents()).map(text => text.trim()).slice(-expected.length)).toEqual(expected);
            for (const excluded of ['sourceLocal', 'earlierLocal', 'earlierRuleLocal', 'previousResponseLocal', 'commented', 'selectedResponse', 'later', 'Later']) {
                await expect(mapping(refs, excluded)).toHaveCount(0);
            }
            const earlierToken = mode === 'js' ? "$('d4')" : '${d4.message}';
            await expect(mapping(refs, 'Get data from database')).toHaveAttribute('title', earlierToken);
            await expect(mapping(refs, 'Message Hash')).toHaveAttribute('title', mode === 'js' ? 'HashUtil.generate(connectorMessage.getEncodedData())' : '${HASH}');

            const editor = await codeField(page, mode, fallback);
            const before = await value(editor);
            await focusEnd(editor);
            await mapping(refs, 'nowstr').click();
            const variable = mode === 'js' ? "$('nowstr')" : '${nowstr}';
            await expect.poll(() => value(editor)).toBe(before + variable);
            await drag(page, mapping(refs, 'Get data from database'), editor.locator(fallback ? 'textarea.ce-area' : '.monaco-editor'));
            await expect.poll(() => value(editor)).toContain(earlierToken);
            // Actual HL7 metadata is stored in mirth_* map entries. The
            // connector message has no source/type/version bean properties.
            for (const [label, key] of [['Message Source', 'mirth_source'], ['Message Type', 'mirth_type'], ['Message Version', 'mirth_version']]) {
                const token = mode === 'js' ? `$('${key}')` : `\${${key}}`;
                await expect(mapping(refs, label)).toHaveAttribute('title', token);
                await focusEnd(editor);
                await mapping(refs, label).click();
                await expect.poll(() => value(editor)).toContain(token);
            }
            await editor.getByRole('button', { name: 'Open code view', exact: true }).click();
            const overlay = page.locator('.ce-popout-overlay');
            await expect(overlay.locator('.ce-popout-var').filter({ hasText: /^Get data from database$/ })).toHaveAttribute('title', earlierToken);
            await expect(overlay.locator('.ce-popout-var').filter({ hasText: /^selectedResponse$/ })).toHaveCount(0);
            await overlay.locator('.ce-popout-var').filter({ hasText: /^selectedLocal$/ }).click();
            await overlay.getByRole('button', { name: 'Back', exact: true }).click();
            const savedValue = await value(editor);
            await page.getByRole('button', { name: 'Save Changes', exact: true }).first().click();
            await expect.poll(() => writes.length).toBe(1);
            expect(writes[0].destinationConnectors.connector[1].properties[mode === 'js' ? 'script' : 'template']).toBe(savedValue);
        });
    }

    test(`${surface}: unsaved source and destination filter and transformer changes refresh mappings`, async ({ page }) => {
        const writes = await open(page, surface);
        for (const kind of ['Filter', 'Transformer']) {
            if (surface === 'wizard') {
                await page.locator('.wiz-step', { hasText: 'Source' }).click();
                await page.getByRole('tab', { name: new RegExp(`^${kind}(?: \\(\\d+\\))?$`) }).click();
            } else {
                await page.getByRole('tab', { name: 'Source', exact: true }).click();
                await page.getByRole('button', { name: new RegExp(`^Edit ${kind}`) }).click();
            }
            await page.locator('table.dt tbody tr').first().locator('td.num').click();
            if (kind === 'Filter') {
                await page.locator('.step-editor-fill textarea.ce-area').fill("$c('updatedRule', 1); return true;");
            } else {
                await page.locator('.step-editor-fill .field').filter({ has: page.locator('label').filter({ hasText: /^Variable$/ }) }).locator('input').fill('updatedStep');
            }
            if (surface === 'classic') await page.getByRole('button', { name: 'Back to Channel', exact: true }).click();
            await destinations(page, surface);
            await selectDestination(page, surface, 1);
            const refs = rail(page, surface);
            await expect(mapping(refs, kind === 'Filter' ? 'updatedRule' : 'updatedStep')).toHaveCount(1);
            await expect(mapping(refs, kind === 'Filter' ? 'sourceRule' : 'nowstr')).toHaveCount(0);
            const editor = await codeField(page, 'js', true);
            await editor.getByRole('button', { name: 'Open code view', exact: true }).click();
            const overlay = page.locator('.ce-popout-overlay');
            await expect(overlay.locator('.ce-popout-var').filter({ hasText: new RegExp(`^${kind === 'Filter' ? 'updatedRule' : 'updatedStep'}$`) })).toHaveCount(1);
            await overlay.getByRole('button', { name: 'Back', exact: true }).click();
        }
        for (const kind of ['Filter', 'Transformer']) {
            if (surface === 'wizard') {
                await page.getByRole('tab', { name: new RegExp(`^${kind}(?: \\(\\d+\\))?$`) }).click();
            } else {
                await page.getByRole('button', { name: new RegExp(`^Edit ${kind}`) }).click();
            }
            await page.locator('table.dt tbody tr').first().locator('td.num').click();
            const key = kind === 'Filter' ? 'updatedDestinationRule' : 'updatedDestinationStep';
            await page.locator('.step-editor-fill textarea.ce-area').fill(`$co('${key}', 1);${kind === 'Filter' ? ' return true;' : ''}`);
            if (surface === 'wizard') await page.getByRole('tab', { name: 'Settings', exact: true }).click();
            else {
                await page.getByRole('button', { name: 'Back to Channel', exact: true }).click();
                await destinations(page, surface);
                await selectDestination(page, surface, 1);
            }
            const refs = rail(page, surface);
            await expect(mapping(refs, key)).toHaveAttribute('title', `$('${key}')`);
            await expect(mapping(refs, kind === 'Filter' ? 'selectedRule' : 'selectedLocal')).toHaveCount(0);
            const editor = await codeField(page, 'js', true);
            await editor.getByRole('button', { name: 'Open code view', exact: true }).click();
            const overlay = page.locator('.ce-popout-overlay');
            await expect(overlay.locator('.ce-popout-var').filter({ hasText: new RegExp(`^${key}$`) })).toHaveCount(1);
            await overlay.getByRole('button', { name: 'Back', exact: true }).click();
        }
        expect(writes).toHaveLength(0);
    });
}
