import type { Page } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';

const MAPPER = 'com.mirth.connect.plugins.mapper.MapperStep';
const BUILDER = 'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep';
const RULE = 'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule';
const ITERATOR = 'com.mirth.connect.model.IteratorStep';
const FILTER_ITERATOR = 'com.mirth.connect.model.IteratorRule';
const PAIR = 'org.apache.commons.lang3.tuple.ImmutablePair';
const PREFIX = "msg['OBX']";
const mapping = (index = '0') => `${PREFIX}[${index}]['OBX.5'].toString()`;

type Element = { type: string; name: string; [key: string]: any };

// The same versioned, class-keyed collections the engine's XML export uses.
function wire(elements: Element[]) {
    const result: Record<string, any[]> = {};
    elements.forEach(({ type, ...element }, sequenceNumber) => {
        (result[type] ||= []).push({ '@version': '4.6.0', enabled: true, ...element, sequenceNumber });
    });
    return elements.length ? result : '';
}

function mapper(name = 'Observation', index = '0'): Element {
    return { type: MAPPER, name, variable: 'observations', mapping: mapping(index), defaultValue: '', replacements: '', scope: 'CHANNEL' };
}

function iterator(name: string, index = 'i', children: Element[] = [], prefixes = [PREFIX], type = ITERATOR): Element {
    return {
        type, name,
        ...(type === FILTER_ITERATOR ? { operator: 'NONE' } : {}),
        properties: { '@version': '4.6.0', target: PREFIX, indexVariable: index, prefixSubstitutions: { string: prefixes }, children: wire(children) }
    };
}

async function openEditor(page: Page, elements: Element[], kind = 'transformer', id = 'iterator-parity') {
    let channel = makeChannel(id);
    channel.sourceConnector[kind].elements = wire(elements);
    const writes: any[] = [];
    await mockEngine(page, {
        [`GET /channels/${id}`]: () => ({ channel }),
        [`PUT /channels/${id}`]: (request: any) => { channel = request.postDataJSON().channel; writes.push(channel); return true; }
    });
    await page.goto(`/channels/${id}/${kind}/0`);
    await expect(page.locator('table.dt tbody tr[data-path]').first()).toBeVisible();
    return async () => {
        const count = writes.length;
        await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
        await expect.poll(() => writes.length).toBe(count + 1);
        return writes.at(-1).sourceConnector[kind].elements;
    };
}

const row = (page: Page, name: string) => page.locator('table.dt tbody tr[data-path]').filter({ has: page.locator(`input.grid-name[value="${name}"]`) });
const field = (page: Page, label: string) => page.locator(`.step-editor-fill .field:has(label:text-is("${label}")) input`);
const children = (elements: any, name: string, type = ITERATOR) => elements[type].find((el: any) => el.name === name).properties.children;

test('assign and detach rewrite every Mapper expression and retain unrelated fields', async ({ page }) => {
    const element = mapper();
    element.defaultValue = mapping('1');
    element.replacements = { [PAIR]: [{ left: { '@class': 'string', $: mapping('2') }, right: { '@class': 'string', $: mapping('3') } }] };
    const save = await openEditor(page, [element, iterator('Observations')]);
    await row(page, 'Observation').locator('td.num').click();
    await page.getByRole('button', { name: 'Assign To Iterator', exact: true }).click();
    const assigned = children(await save(), 'Observations')[MAPPER][0];
    expect(assigned).toMatchObject({ variable: 'observations', mapping: mapping('i'), defaultValue: mapping('i'), scope: 'CHANNEL' });
    expect(assigned.replacements[PAIR][0]).toEqual({ left: { '@class': 'string', $: mapping('i') }, right: { '@class': 'string', $: mapping('i') } });
    await expect(field(page, 'Mapping')).toHaveValue(mapping('i'));
    await expect(page.getByRole('textbox', { name: 'Regular Expression 1', exact: true })).toHaveValue(mapping('i'));
    await expect(page.getByRole('textbox', { name: 'Replace With 1', exact: true })).toHaveValue(mapping('i'));

    await page.getByRole('button', { name: 'Remove From Iterator', exact: true }).click();
    await expect(field(page, 'Mapping')).toHaveValue(`${PREFIX}['OBX.5'].toString()`);
    const detached = (await save())[MAPPER][0];
    expect(JSON.stringify(detached)).not.toContain('[i]');
    expect(detached.defaultValue).toBe(`${PREFIX}['OBX.5'].toString()`);
});

test('Message Builder assignment substitutes both inbound and outbound prefixes', async ({ page }) => {
    const element: Element = {
        type: BUILDER, name: 'Build observation', messageSegment: "tmp['OBX'][0]['OBX.5']",
        mapping: mapping(), defaultValue: mapping('1'), replacements: ''
    };
    const save = await openEditor(page, [element, iterator('Observations', 'i', [], [PREFIX, "tmp['OBX']"])]);
    await row(page, element.name).locator('td.num').click();
    await page.getByRole('button', { name: 'Assign To Iterator', exact: true }).click();
    await expect(field(page, 'Message Segment')).toHaveValue("tmp['OBX'][i]['OBX.5']");
    const assigned = children(await save(), 'Observations')[BUILDER][0];
    expect(assigned).toMatchObject({ messageSegment: "tmp['OBX'][i]['OBX.5']", mapping: mapping('i'), defaultValue: mapping('i') });
});

test('filter Rule Builder assignment and detachment rewrite field and comparison values', async ({ page }) => {
    const element: Element = { type: RULE, name: 'Observation rule', operator: 'NONE', field: mapping(), condition: 'EQUALS', values: { string: [mapping('1'), "'literal'"] } };
    const save = await openEditor(page, [element, iterator('Observation rules', 'i', [], [PREFIX], FILTER_ITERATOR)], 'filter');
    await row(page, element.name).locator('td.num').click();
    await page.getByRole('button', { name: 'Assign To Iterator', exact: true }).click();
    await expect(field(page, 'Field')).toHaveValue(mapping('i'));
    const assigned = children(await save(), 'Observation rules', FILTER_ITERATOR)[RULE][0];
    expect(assigned).toMatchObject({ field: mapping('i'), values: { string: [mapping('i'), "'literal'"] }, operator: 'NONE' });
    await page.getByRole('button', { name: 'Remove From Iterator', exact: true }).click();
    const detached = (await save())[RULE][0];
    expect(detached).toMatchObject({ field: `${PREFIX}['OBX.5'].toString()`, values: { string: [`${PREFIX}['OBX.5'].toString()`, "'literal'"] } });
});

test('moving a child between Iterators removes the old index before applying the new one', async ({ page }) => {
    const save = await openEditor(page, [iterator('First', 'i', [mapper('Observation', 'i')]), iterator('Second', 'j')]);
    await row(page, 'Observation').locator('td.num').click();
    await page.getByRole('button', { name: 'Assign To Iterator', exact: true }).click();
    await expect(field(page, 'Mapping')).toHaveValue(mapping('j'));
    const elements = await save();
    expect(children(elements, 'First')).toBe('');
    expect(children(elements, 'Second')[MAPPER][0].mapping).toBe(mapping('j'));
});

test('detaching a nested child retains its outer Iterator index', async ({ page }) => {
    const innerPrefix = `${PREFIX}[i]['OBX.5']`;
    const element = mapper();
    element.mapping = `${innerPrefix}[j].toString()`;
    const inner = iterator('Values', 'j', [element], [innerPrefix]);
    inner.properties.target = innerPrefix;
    const save = await openEditor(page, [iterator('Observations', 'i', [inner])]);
    await row(page, 'Observation').locator('td.num').click();
    await page.getByRole('button', { name: 'Remove From Iterator', exact: true }).click();
    await expect(field(page, 'Mapping')).toHaveValue(`${innerPrefix}.toString()`);
    const detached = children(await save(), 'Observations')[MAPPER][0];
    expect(detached.mapping).toBe(`${innerPrefix}.toString()`);
    expect(detached.mapping).not.toContain('[j]');
});

test('moving a nested Iterator rewrites its target, prefixes and descendants', async ({ page }) => {
    const oldPrefix = `${PREFIX}[i]['OBX.5']`;
    const element = mapper();
    element.mapping = `${oldPrefix}[j].toString()`;
    const inner = iterator('Values', 'j', [element], [oldPrefix]);
    inner.properties.target = oldPrefix;
    const save = await openEditor(page, [iterator('First', 'i', [inner]), iterator('Second', 'k')]);
    await row(page, 'Values').locator('td.num').click();
    await page.getByRole('button', { name: 'Assign To Iterator', exact: true }).click();
    await expect(field(page, 'Iterate On (target)')).toHaveValue(`${PREFIX}[k]['OBX.5']`);
    const elements = await save();
    const moved = children(elements, 'Second')[ITERATOR][0];
    expect(children(elements, 'First')).toBe('');
    expect(moved.properties).toMatchObject({ target: `${PREFIX}[k]['OBX.5']`, indexVariable: 'j', prefixSubstitutions: { string: [`${PREFIX}[k]['OBX.5']`] } });
    expect(moved.properties.children[MAPPER][0].mapping).toBe(`${PREFIX}[k]['OBX.5'][j].toString()`);
});

test('cancelling Iterator selection preserves the original child and expressions', async ({ page }) => {
    const save = await openEditor(page, [iterator('Original', 'i', [mapper('Observation', 'i')]), iterator('Second', 'j'), iterator('Third', 'k')]);
    await row(page, 'Observation').locator('td.num').click();
    await page.getByRole('button', { name: 'Assign To Iterator', exact: true }).click();
    await page.getByRole('dialog', { name: 'Assign To Iterator' }).getByRole('button', { name: 'Cancel' }).click();
    await expect(field(page, 'Mapping')).toHaveValue(mapping('i'));
    // Make an independent edit so the no-op assignment can be verified on wire.
    await row(page, 'Observation').locator('input.grid-name').fill('Renamed');
    const elements = await save();
    expect(children(elements, 'Original')[MAPPER][0]).toMatchObject({ name: 'Renamed', mapping: mapping('i') });
    expect(children(elements, 'Second')).toBe('');
    expect(children(elements, 'Third')).toBe('');
});

test('Iterator chooser keeps the captured source when selection changes before acceptance', async ({ page }) => {
    const save = await openEditor(page, [mapper('Original'), mapper('Other'), iterator('First'), iterator('Second', 'j')]);
    await row(page, 'Original').locator('td.num').click();
    await page.getByRole('button', { name: 'Assign To Iterator', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Assign To Iterator' });
    await dialog.getByRole('combobox', { name: 'Iterator', exact: true }).selectOption({ label: 'Second' });
    // Deliver a selection event while the chooser is pending to exercise the
    // callback's captured identity, independently of the overlay's pointer trap.
    await row(page, 'Other').locator('td.num').dispatchEvent('click');
    await dialog.getByRole('button', { name: 'Use Iterator', exact: true }).click();
    const elements = await save();
    expect(children(elements, 'Second')[MAPPER][0]).toMatchObject({ name: 'Original', mapping: mapping('j') });
    expect(elements[MAPPER]).toHaveLength(1);
    expect(elements[MAPPER][0]).toMatchObject({ name: 'Other', mapping: mapping() });
});

test('a removed chooser source cannot create an orphan Iterator on acceptance', async ({ page }) => {
    const save = await openEditor(page, [mapper('Original'), iterator('First'), iterator('Second', 'j')]);
    await row(page, 'Original').locator('td.num').click();
    await page.getByRole('button', { name: 'Assign To Iterator', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Assign To Iterator' });
    await expect(dialog).toBeVisible();
    await page.getByRole('button', { name: 'Delete Step', exact: true, includeHidden: true }).dispatchEvent('click');
    await dialog.getByRole('button', { name: 'Use Iterator', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('iterator context changed');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    const elements = await save();
    expect(elements[MAPPER]).toBeUndefined();
    expect(elements[ITERATOR].map((element: any) => element.name)).toEqual(['First', 'Second']);
    expect(elements[ITERATOR].every((element: any) => element.properties.children === '')).toBe(true);
});

test('message-tree mapping uses the selected Iterator parent and its repetition index', async ({ page }) => {
    const id = 'iterator-tree';
    const channel = makeChannel(id);
    channel.sourceConnector.transformer.elements = wire([iterator('Observations')]);
    channel.sourceConnector.transformer.inboundTemplate = 'OBX|1|TX|||one\rOBX|2|TX|||two';
    const writes: any[] = [];
    await mockEngine(page, {
        [`GET /channels/${id}`]: { channel },
        [`PUT /channels/${id}`]: (request: any) => { writes.push(request.postDataJSON().channel); return true; }
    });
    await page.route('**/api/datatypes/_serialize*', route => route.fulfill({ json: {
        format: 'xml', data: '<HL7Message><OBX><OBX.5><OBX.5.1>one</OBX.5.1></OBX.5></OBX><OBX><OBX.5><OBX.5.1>two</OBX.5.1></OBX.5></OBX></HL7Message>', meta: {}
    } }));
    await page.goto(`/channels/${id}/transformer/0`);
    await row(page, 'Observations').locator('td.num').click();
    await page.getByRole('tab', { name: 'Message Trees', exact: true }).click();
    const tree = page.getByRole('region', { name: 'Inbound message tree (msg)' });
    const repetition = tree.getByRole('row').filter({ has: page.getByText('OBX[1]', { exact: true }) });
    await repetition.locator('.twisty').click();
    await tree.getByRole('row').filter({ has: page.getByText('OBX.5', { exact: true }) }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Map to Variable' }).click();
    await expect(field(page, 'Mapping')).toHaveValue(`${PREFIX}[i]['OBX.5']['OBX.5.1'].toString()`);
    await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    const elements = writes[0].sourceConnector.transformer.elements;
    expect(elements[MAPPER]).toBeUndefined();
    expect(children(elements, 'Observations')[MAPPER][0].mapping).toBe(`${PREFIX}[i]['OBX.5']['OBX.5.1'].toString()`);
});

test('message-tree mapping can create an Iterator before adding the indexed Mapper', async ({ page }) => {
    const id = 'iterator-tree-create';
    const channel = makeChannel(id);
    channel.sourceConnector.transformer.inboundTemplate = 'OBX|1|TX|||one\rOBX|2|TX|||two';
    const writes: any[] = [];
    await mockEngine(page, {
        [`GET /channels/${id}`]: { channel },
        [`PUT /channels/${id}`]: (request: any) => { writes.push(request.postDataJSON().channel); return true; }
    });
    await page.route('**/api/datatypes/_serialize*', route => route.fulfill({ json: {
        format: 'xml', data: '<HL7Message><OBX><OBX.5><OBX.5.1>one</OBX.5.1></OBX.5></OBX><OBX><OBX.5><OBX.5.1>two</OBX.5.1></OBX.5></OBX></HL7Message>', meta: {}
    } }));
    await page.goto(`/channels/${id}/transformer/0`);
    await page.getByRole('tab', { name: 'Message Trees', exact: true }).click();
    const tree = page.getByRole('region', { name: 'Inbound message tree (msg)' });
    await tree.getByRole('row').filter({ has: page.getByText('OBX[1]', { exact: true }) }).locator('.twisty').click();
    await tree.getByRole('row').filter({ has: page.getByText('OBX.5', { exact: true }) }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Map to Variable' }).click();
    const dialog = page.getByRole('dialog', { name: 'Select Iterator' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'Iterate On', exact: true })).toHaveValue(PREFIX);
    await expect(dialog.getByRole('textbox', { name: 'Index Variable', exact: true })).toHaveValue('i');
    await dialog.getByRole('button', { name: 'Use Iterator', exact: true }).click();
    await expect(field(page, 'Mapping')).toHaveValue(`${PREFIX}[i]['OBX.5']['OBX.5.1'].toString()`);
    await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    const elements = writes[0].sourceConnector.transformer.elements;
    expect(elements[MAPPER]).toBeUndefined();
    expect(elements[ITERATOR]).toHaveLength(1);
    expect(elements[ITERATOR][0].properties).toMatchObject({ target: PREFIX, indexVariable: 'i', prefixSubstitutions: { string: expect.arrayContaining([PREFIX]) } });
    expect(elements[ITERATOR][0].properties.children[MAPPER][0].mapping).toBe(`${PREFIX}[i]['OBX.5']['OBX.5.1'].toString()`);
});

test('message-tree Iterator cancellation is a no-op and adding without one retains the selected repetition', async ({ page }) => {
    const id = 'iterator-tree-without';
    const channel = makeChannel(id);
    channel.sourceConnector.transformer.inboundTemplate = 'OBX|1|TX|||one\rOBX|2|TX|||two';
    const writes: any[] = [];
    await mockEngine(page, {
        [`GET /channels/${id}`]: { channel },
        [`PUT /channels/${id}`]: (request: any) => { writes.push(request.postDataJSON().channel); return true; }
    });
    await page.route('**/api/datatypes/_serialize*', route => route.fulfill({ json: {
        format: 'xml', data: '<HL7Message><OBX><OBX.5><OBX.5.1>one</OBX.5.1></OBX.5></OBX><OBX><OBX.5><OBX.5.1>two</OBX.5.1></OBX.5></OBX></HL7Message>', meta: {}
    } }));
    await page.goto(`/channels/${id}/transformer/0`);
    await page.getByRole('tab', { name: 'Message Trees', exact: true }).click();
    const tree = page.getByRole('region', { name: 'Inbound message tree (msg)' });
    await tree.getByRole('row').filter({ has: page.getByText('OBX[1]', { exact: true }) }).locator('.twisty').click();
    const mapFromTree = async () => {
        await tree.getByRole('row').filter({ has: page.getByText('OBX.5', { exact: true }) }).click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Map to Variable' }).click();
    };
    await mapFromTree();
    await page.getByRole('dialog', { name: 'Select Iterator' }).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('table.dt tbody tr[data-path]')).toHaveCount(0);
    await mapFromTree();
    await page.getByRole('dialog', { name: 'Select Iterator' }).getByRole('button', { name: 'Add Without Iterator', exact: true }).click();
    await expect(field(page, 'Mapping')).toHaveValue(`${PREFIX}[1]['OBX.5']['OBX.5.1'].toString()`);
    await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    const elements = writes[0].sourceConnector.transformer.elements;
    expect(elements[ITERATOR]).toBeUndefined();
    expect(elements[MAPPER]).toHaveLength(1);
    expect(elements[MAPPER][0].mapping).toBe(`${PREFIX}[1]['OBX.5']['OBX.5.1'].toString()`);
});
