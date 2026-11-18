import type { Page } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';

const BUILDER = 'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep';
const ITERATOR = 'com.mirth.connect.model.IteratorStep';
const INBOUND = "values[i]['field']";
const OUTBOUND = "tmp['result']";

async function openBuilder(page: Page, id: string, messageSegment = OUTBOUND) {
    let channel = makeChannel(id);
    channel.sourceConnector.transformer.elements = {
        [ITERATOR]: [{ '@version': '4.6.0', name: 'Observations', sequenceNumber: 0, enabled: true,
            properties: { '@version': '4.6.0', target: "msg['OBX']", indexVariable: 'i',
                prefixSubstitutions: { string: "msg['OBX']" }, children: {
                    [BUILDER]: [{ '@version': '4.6.0', name: 'Build result', sequenceNumber: 0, enabled: true,
                        messageSegment, mapping: `${INBOUND}['value']`, defaultValue: '', replacements: '' }]
                } }
        }]
    };
    const writes: any[] = [];
    await mockEngine(page, {
        [`GET /channels/${id}`]: () => ({ channel }),
        [`PUT /channels/${id}`]: (request: any) => { channel = request.postDataJSON().channel; writes.push(channel); return true; }
    });
    await page.goto(`/channels/${id}/transformer/0`);
    await page.locator('table.dt tbody tr[data-path]').filter({
        has: page.locator('input.grid-name[value="Build result"]')
    }).locator('td.num').click();
    await page.getByRole('button', { name: 'Assign To Iterator', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Assign To Iterator', exact: true });
    await dialog.getByRole('combobox', { name: 'Iterator', exact: true }).selectOption('new');
    return {
        dialog,
        target: dialog.getByRole('combobox', { name: 'Iterate On', exact: true }),
        outbound: dialog.getByRole('combobox', { name: 'Outbound Prefix', exact: true }),
        async acceptAndSave() {
            await dialog.getByRole('button', { name: 'Use Iterator', exact: true }).click();
            await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
            await expect.poll(() => writes.length).toBe(1);
            return writes[0].sourceConnector.transformer.elements[ITERATOR][0].properties.children[ITERATOR][0];
        }
    };
}

test('new Iterator uses the first visible outbound boundary when the default inbound boundary has no matching index', async ({ page }, info) => {
    const editor = await openBuilder(page, 'iterator-outbound-fallback');
    await expect(editor.target).toHaveValue(INBOUND);
    // Packaged Swing defaults to component 2 for values[i]['field'], but
    // outbound tmp['result'] only has components 0 and 1: it falls back to tmp.
    await expect(editor.outbound).toHaveValue('tmp');
    const created = await editor.acceptAndSave();
    expect(created.properties.prefixSubstitutions.string).toEqual([INBOUND, 'tmp']);
    expect(created.properties.children[BUILDER][0]).toMatchObject({
        mapping: `${INBOUND}[j]['value']`, messageSegment: "tmp[j]['result']"
    });
    await info.attach('saved-outbound-fallback', { body: JSON.stringify(created, null, 2), contentType: 'application/json' });
});

test('changing an inbound boundary synchronizes a matching outbound index and otherwise preserves the chosen outbound boundary', async ({ page }, info) => {
    const editor = await openBuilder(page, 'iterator-outbound-synchronization');
    await expect(editor.outbound).toHaveValue('tmp');
    await editor.target.selectOption('values[i]');
    await expect(editor.outbound).toHaveValue(OUTBOUND);
    await expect(editor.dialog.getByText("values[i]['field']['value'] → values[i][j]['field']['value']", { exact: true })).toBeVisible();
    await expect(editor.dialog.getByText("tmp['result'] → tmp['result'][j]", { exact: true })).toBeVisible();
    await editor.outbound.selectOption('tmp');
    await expect(editor.dialog.getByText("tmp['result'] → tmp[j]['result']", { exact: true })).toBeVisible();
    await editor.target.selectOption(INBOUND);
    await expect(editor.outbound).toHaveValue('tmp');
    await editor.outbound.selectOption(OUTBOUND);
    await editor.target.selectOption(`${INBOUND}['value']`);
    await expect(editor.outbound).toHaveValue(OUTBOUND);
    const created = await editor.acceptAndSave();
    expect(created.properties.prefixSubstitutions.string).toEqual([`${INBOUND}['value']`, OUTBOUND]);
    expect(created.properties.children[BUILDER][0]).toMatchObject({
        mapping: `${INBOUND}['value'][j]`, messageSegment: `${OUTBOUND}[j]`
    });
    await info.attach('saved-outbound-synchronization', { body: JSON.stringify(created, null, 2), contentType: 'application/json' });
});

test('the outbound chooser keeps a whole method call and the order of explicitly chosen prefixes', async ({ page }) => {
    const editor = await openBuilder(page, 'iterator-outbound-method', "tmp['result'][0].value.toString()");
    const outbound = "tmp['result'].value.toString()";
    await expect(editor.outbound.locator('option')).toHaveCount(1);
    await expect(editor.outbound).toHaveValue(outbound);
    expect((await editor.acceptAndSave()).properties.prefixSubstitutions.string).toEqual([INBOUND, outbound]);
});

test('two explicitly identical inbound and outbound prefixes both survive save', async ({ page }) => {
    const editor = await openBuilder(page, 'iterator-outbound-same', INBOUND);
    await expect(editor.outbound).toHaveValue(INBOUND);
    expect((await editor.acceptAndSave()).properties.prefixSubstitutions.string).toEqual([INBOUND, INBOUND]);
});
