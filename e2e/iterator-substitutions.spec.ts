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

function wire(elements: Element[]) {
    const result: Record<string, any[]> = {};
    elements.forEach(({ type, ...element }, sequenceNumber) => {
        (result[type] ||= []).push({ '@version': '4.6.0', enabled: true, ...element, sequenceNumber });
    });
    return elements.length ? result : '';
}

function mapper(): Element {
    return { type: MAPPER, name: 'Observation', variable: 'observations', mapping: mapping(), defaultValue: '', replacements: '', scope: 'CHANNEL' };
}

function iterator(name: string, index = 'i', children: Element[] = [], prefixes = [PREFIX], type = ITERATOR): Element {
    return { type, name, ...(type === FILTER_ITERATOR ? { operator: 'NONE' } : {}),
        properties: { '@version': '4.6.0', target: prefixes[0], indexVariable: index, prefixSubstitutions: { string: prefixes }, children: wire(children) } };
}

const row = (page: Page, name: string) => page.locator('tr[data-path]').filter({ has: page.locator(`input.grid-name[value="${name}"]`) });
const click = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).click();
const children = (elements: any, name: string, type = ITERATOR) => elements[type].find((el: Element) => el.name === name).properties.children;

async function openEditor(page: Page, elements: Element[], kind = 'transformer', template = '') {
    const id = 'iterator-test';
    let channel = makeChannel(id);
    const target = () => kind === 'response' ? channel.destinationConnectors.connector[0].responseTransformer : channel.sourceConnector[kind];
    target().elements = wire(elements);
    if (template) {
        target().inboundDataType = 'XML';
        target().inboundTemplate = template;
    }
    let writes = 0;
    await mockEngine(page, {
        'POST /datatypes/_serialize': { format: 'xml', data: template, meta: {} },
        [`GET /channels/${id}`]: () => ({ channel }),
        [`PUT /channels/${id}`]: (request: any) => { channel = request.postDataJSON().channel; writes++; return true; }
    });
    await page.goto(`/channels/${id}/${kind}/${kind === 'response' ? 1 : 0}`);
    return async () => {
        const previous = writes;
        await click(page, 'Save Channel');
        await expect.poll(() => writes).toBe(previous + 1);
        return target().elements;
    };
}

async function assign(page: Page, element: string, destination: string) {
    await row(page, element).locator('td.num').click();
    await click(page, 'Assign To Iterator');
    const dialog = page.getByRole('dialog', { name: 'Assign To Iterator' });
    await dialog.getByLabel('Iterator', { exact: true }).selectOption({ label: destination });
    await dialog.getByRole('button', { name: 'Use Iterator' }).click();
}

test('assign, reload and detach a Mapper with defaults and replacements', async ({ page }) => {
    const observation = mapper();
    observation.defaultValue = mapping('1');
    observation.replacements = { [PAIR]: [{ left: { '@class': 'string', $: mapping('2') }, right: { '@class': 'string', $: mapping('3') } }] };
    const save = await openEditor(page, [observation, iterator('Observations')]);
    await assign(page, observation.name, 'Observations');
    const assigned = children(await save(), 'Observations')[MAPPER][0];
    expect(assigned).toMatchObject({ variable: 'observations', mapping: mapping('i'), defaultValue: mapping('i'), scope: 'CHANNEL' });
    expect(assigned.replacements[PAIR][0]).toEqual({ left: { '@class': 'string', $: mapping('i') }, right: { '@class': 'string', $: mapping('i') } });
    await page.reload();
    await row(page, observation.name).locator('td.num').click();
    await expect(page.getByRole('textbox', { name: 'Regular Expression 1', exact: true })).toHaveValue(mapping('i'));
    await click(page, 'Remove From Iterator');
    const detached = (await save())[MAPPER][0];
    expect(detached.mapping).toBe(`${PREFIX}['OBX.5'].toString()`);
    expect(JSON.stringify(detached)).not.toContain('[i]');
});

test('reassigning a response Message Builder moves its source and writable target', async ({ page }) => {
    const outbound = "tmp['OBX']";
    const builder = { type: BUILDER, name: 'Build observation', mapping: `${PREFIX} [i].value.toString()`,
        messageSegment: `${outbound} [i].value`, defaultValue: '', replacements: '' };
    const prefixes = [PREFIX, outbound];
    const save = await openEditor(page, [iterator('First', 'i', [builder], prefixes), iterator('Second', 'j', [], prefixes)], 'response');
    await assign(page, builder.name, 'Second');
    const elements = await save();
    expect(children(elements, 'First')).toBe('');
    expect(children(elements, 'Second')[BUILDER][0]).toMatchObject({ mapping: `${PREFIX}[j].value.toString()`, messageSegment: `${outbound}[j].value` });
});

test('filter rules substitute their field and comparison values', async ({ page }) => {
    const rule = { type: RULE, name: 'Compare observations', field: mapping(), condition: 'EQUALS', values: { string: [mapping('1'), "'unchanged'"] }, operator: 'NONE' };
    const save = await openEditor(page, [rule, iterator('Filter observations', 'i', [], [PREFIX], FILTER_ITERATOR)], 'filter');
    await assign(page, rule.name, 'Filter observations');
    expect(children(await save(), 'Filter observations', FILTER_ITERATOR)[RULE][0]).toMatchObject({ field: mapping('i'), values: { string: [mapping('i'), "'unchanged'"] } });
    await click(page, 'Remove From Iterator');
    expect(JSON.stringify((await save())[RULE][0])).not.toContain('[i]');
});

test('detaching a nested child keeps the outer Iterator index and its sibling order', async ({ page }) => {
    const outer = PREFIX + '[i]';
    const inner = outer + "['OBX.5']";
    const child = { ...mapper(), mapping: inner + "[j]['OBX.5.1'].toString()" };
    const save = await openEditor(page, [iterator('Outer', 'i', [iterator('Inner', 'j', [child], [inner]), { ...mapper(), name: 'Next' }])]);
    await row(page, child.name).locator('td.num').click();
    await click(page, 'Remove From Iterator');
    const siblings = children(await save(), 'Outer');
    expect(siblings[ITERATOR][0].properties.children).toBe('');
    expect(siblings[MAPPER].map((el: Element) => el.name)).toEqual(['Next', child.name]);
    expect(siblings[MAPPER][1].mapping).toBe(inner + "['OBX.5.1'].toString()");
});

test('cancelling the chooser or losing its source leaves the destination untouched', async ({ page }) => {
    const save = await openEditor(page, [mapper(), iterator('Destination')]);
    await row(page, 'Observation').locator('td.num').click();
    await click(page, 'Assign To Iterator');
    const dialog = page.getByRole('dialog', { name: 'Assign To Iterator' });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(row(page, 'Observation')).toHaveAttribute('data-path', '0');
    await click(page, 'Assign To Iterator');
    await dialog.getByLabel('Iterator', { exact: true }).selectOption('new');
    await page.getByRole('button', { name: 'Delete Step', exact: true, includeHidden: true }).dispatchEvent('click');
    await dialog.getByRole('button', { name: 'Use Iterator' }).click();
    await expect(dialog.getByRole('alert')).toContainText('iterator context changed');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    const elements = await save();
    expect(elements[ITERATOR]).toHaveLength(1);
    expect(children(elements, 'Destination')).toBe('');
});

for (const scenario of ['sibling', 'nested', 'namespaced sibling']) {
    test(`a tree-created Mapper uses the ${scenario} Iterator after reload`, async ({ page }) => {
        const create = scenario === 'nested';
        const ns = scenario === 'namespaced sibling' ? 'v:' : '';
        const prefix = ns ? "msg.*::['OBX']" : PREFIX;
        const value = ns ? ".*::['value']" : "['value']";
        const xml = `<message xmlns:v="urn:observations"><${ns}OBX><${ns}value>one</${ns}value></${ns}OBX><${ns}OBX><${ns}value>two</${ns}value></${ns}OBX></message>`;
        const save = await openEditor(page, [iterator('Original', 'i', [], [prefix]), iterator('Destination', 'j', [], [prefix])], 'transformer', xml);
        await row(page, 'Original').locator('td.num').click();
        await page.getByRole('tab', { name: 'Message Trees' }).click();
        const tree = page.getByRole('region', { name: 'Inbound message tree (msg)' });
        await tree.getByRole('row').filter({ has: page.getByText(ns + 'OBX[1]', { exact: true }) }).locator('.twisty').click();
        await tree.getByRole('row').filter({ has: page.getByText(ns + 'value', { exact: true }) }).click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Map to Variable' }).click();
        await page.getByRole('dialog', { name: 'Select An Option' }).getByRole('button', { name: 'Yes' }).click();
        const dialog = page.getByRole('dialog', { name: 'Select Iterator' });
        const choice = dialog.getByLabel('Iterator', { exact: true });
        if (create) await choice.selectOption('new');
        else await choice.selectOption({ label: 'Destination' });
        await dialog.getByRole('button', { name: 'Use Iterator' }).click();
        const elements = await save();
        const nested = children(elements, 'Original');
        const mapped = create ? nested[ITERATOR][0].properties.children : children(elements, 'Destination');
        const expression = create ? `${prefix}[i]${value}[j].toString()` : `${prefix}[j]${value}.toString()`;
        expect(mapped[MAPPER][0].mapping).toBe(expression);
        await page.reload();
        await row(page, mapped[MAPPER][0].name).locator('td.num').click();
        await expect(page.locator('.step-editor-fill .field:has(label:text-is("Mapping")) input')).toHaveValue(expression);
    });
}

test('tree-created Mappers keep separate map keys for identically named leaves', async ({ page }) => {
    const save = await openEditor(page, [], 'transformer', '<m><sending><id>A</id></sending><receiving><id>B</id></receiving></m>');
    await page.getByRole('tab', { name: 'Message Trees' }).click();
    const tree = page.getByRole('region', { name: 'Inbound message tree (msg)' });
    for (const branch of ['sending', 'receiving']) {
        const branchRow = tree.getByRole('row').filter({ has: page.getByText(branch, { exact: true }) });
        await branchRow.locator('.twisty').click();
        await tree.getByRole('row').filter({ has: page.getByText('id', { exact: true }) }).click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Map to Variable' }).click();
        await page.getByRole('dialog', { name: 'Select An Option' }).getByRole('button', { name: 'No' }).click();
        await branchRow.locator('.twisty').click();
    }
    const mapped = (await save())[MAPPER];
    expect(mapped.map((el: Element) => [el.name, el.variable])).toEqual([['sending_id', 'sending_id'], ['receiving_id', 'receiving_id']]);
});

for (const kind of ['filter', 'transformer']) {
    test(`a populated ${kind} Iterator retains its children until deletion is confirmed`, async ({ page }) => {
        const filter = kind === 'filter';
        const type = filter ? FILTER_ITERATOR : ITERATOR;
        const leaf = filter ? { type: RULE, name: 'Child', operator: 'NONE', field: mapping('i'), condition: 'EXISTS' }
            : { ...mapper(), name: 'Child', mapping: mapping('i') };
        const save = await openEditor(page, [iterator('Parent', 'i', [leaf], [PREFIX], type), { ...leaf, name: 'Sibling' }], kind);
        const parent = row(page, 'Parent');
        const noun = filter ? 'Rule' : 'Step';
        const selectType = parent.locator('td').last().getByRole('combobox');
        await selectType.selectOption(leaf.type);
        const warning = page.getByRole('dialog', { name: `Change ${noun} Type` });
        await warning.getByRole('button', { name: 'OK' }).click();
        await expect(selectType).toHaveValue(type);
        await parent.locator('td.num').click();
        await click(page, `Delete ${noun}`);
        const confirm = page.getByRole('dialog', { name: `Delete ${noun}` });
        await confirm.getByRole('button', { name: 'Cancel' }).click();
        await expect(row(page, 'Child')).toHaveAttribute('data-path', '0.0');
        await expect(page.getByRole('button', { name: 'Save Channel', exact: true })).toBeHidden();
        await click(page, `Delete ${noun}`);
        await confirm.getByRole('button', { name: 'OK' }).click();
        const elements = await save();
        expect(elements[type]).toBeUndefined();
        expect(elements[leaf.type].map((el: Element) => el.name)).toEqual(['Sibling']);
    });
    test(`changing a configured empty ${kind} Iterator can be cancelled before any settings are lost`, async ({ page }) => {
        const filter = kind === 'filter';
        const type = filter ? FILTER_ITERATOR : ITERATOR;
        const next = filter ? RULE : MAPPER;
        const source = { ...iterator('Configured', 'j', [], [PREFIX], type), enabled: false };
        const save = await openEditor(page, [source], kind);
        const select = page.locator('tr[data-path="0"] td').last().getByRole('combobox');
        const dialog = page.getByRole('dialog', { name: `Change ${filter ? 'Rule' : 'Step'} Type` });
        await select.selectOption(next);
        await expect(dialog).toContainText('lose all of the current data');
        await dialog.getByRole('button', { name: 'No', exact: true }).click();
        await expect(select).toHaveValue(type);
        await expect(page.getByRole('button', { name: 'Save Channel', exact: true })).toBeHidden();
        await select.selectOption(next);
        await dialog.getByRole('button', { name: 'Yes', exact: true }).click();
        const saved = await save();
        expect(saved[type]).toBeUndefined();
        expect(saved[next][0]).toMatchObject({ name: '', enabled: true });
        await select.selectOption(type);
        await expect(dialog).toHaveCount(0);
        await expect(select).toHaveValue(type);
        await expect(page.locator('tr[data-path="0"] .grid-name')).toHaveValue(filter
            ? 'Accept message if at least one of the iterations returns true for each ...' : 'For each ...');
    });

}

for (const kind of ['filter', 'transformer']) {
    test(`converting a configured ${kind} element to an Iterator requires confirmation`, async ({ page }) => {
        const filter = kind === 'filter';
        const original = filter
            ? { type: RULE, name: 'First value', field: mapping(), condition: 'EQUALS', values: { string: "'one'" } }
            : mapper();
        const type = filter ? FILTER_ITERATOR : ITERATOR;
        const save = await openEditor(page, [{ ...original, enabled: false }], kind);
        const select = page.locator('tr[data-path="0"] td').last().getByRole('combobox');
        const dialog = page.getByRole('dialog', { name: `Change ${filter ? 'Rule' : 'Step'} Type` });
        await select.selectOption(type);
        await expect(dialog).toContainText('lose all of the current data');
        await dialog.getByRole('button', { name: 'No', exact: true }).click();
        await expect(select).toHaveValue(original.type);
        await expect(page.getByRole('button', { name: 'Save Channel', exact: true })).toBeHidden();
        await select.selectOption(type);
        await dialog.getByRole('button', { name: 'Yes', exact: true }).click();
        expect((await save())[type][0]).toMatchObject({
            enabled: true, properties: { target: '', indexVariable: 'i' },
            name: filter ? 'Accept message if at least one of the iterations returns true for each ...' : 'For each ...'
        });
    });
}

test('deleting the last child selects the following visible step', async ({ page }) => {
    const last = { ...mapper(), name: 'Last child' };
    await openEditor(page, [iterator('Parent', 'i', [last]), { ...mapper(), name: 'Next step' }]);
    await row(page, last.name).locator('td.num').click();
    await click(page, 'Delete Step');
    await expect(row(page, 'Next step')).toHaveClass(/selected/);
    await expect(row(page, 'Parent')).toBeVisible();
});

test('a moved rule reports its current Swing sequence number in the grid and validation error', async ({ page }) => {
    const rule = { type: RULE, name: 'Incomplete', condition: 'EXISTS', field: '', operator: 'NONE' };
    await openEditor(page, [rule, iterator('Parent', 'i', [], [PREFIX], FILTER_ITERATOR)], 'filter');
    await assign(page, rule.name, 'Parent');
    await expect(row(page, rule.name).locator('td.num')).toHaveText('0-0');
    await click(page, 'Validate Rule');
    await expect(page.getByRole('dialog')).toContainText('filter rule 0-0 ("Incomplete")');
});

test('a backtick-quoted field offers the repeating segment and saves the chosen index', async ({ page }) => {
    const observation = { ...mapper(), mapping: PREFIX + '[1][`value`].toString()' };
    const save = await openEditor(page, [observation]);
    await click(page, 'Assign To Iterator');
    const dialog = page.getByRole('dialog', { name: 'Assign To Iterator' });
    await expect(dialog.getByLabel('Iterate On')).toHaveValue(PREFIX);
    await dialog.getByRole('button', { name: 'Use Iterator' }).click();
    const parent = (await save())[ITERATOR][0];
    expect(parent.properties.children[MAPPER][0].mapping).toBe(PREFIX + '[i][`value`].toString()');
    await page.reload();
    await row(page, observation.name).locator('td.num').click();
    await click(page, 'Remove From Iterator');
    expect((await save())[MAPPER][0].mapping).toBe(PREFIX + '[`value`].toString()');
});

test('filter Iterator options survive a save and drive the generated predicate', async ({ page }) => {
    await page.route('**/vendor/monaco/**', route => route.abort());
    const rule = { type: RULE, name: 'Observation rule', operator: 'NONE', field: mapping('i'), condition: 'EXISTS' };
    const save = await openEditor(page, [iterator('Observations', 'i', [rule], [PREFIX], FILTER_ITERATOR)], 'filter');
    // Existing wire models can omit both flags. 4.6.0 reads an absent boolean as false.
    const all = page.getByLabel('Accept Message If');
    const early = page.getByLabel('Break Early');
    await expect(all).toHaveValue('false');
    await expect(early).toHaveValue('false');
    await all.selectOption('true');
    await early.selectOption('true');
    expect((await save())[FILTER_ITERATOR][0]).toMatchObject({
        name: `Accept message if all of the iterations return true for each ${PREFIX}`,
        properties: { intersectIterations: true, breakEarly: true }
    });
    await page.reload();
    await expect(all).toHaveValue('true');
    await expect(early).toHaveValue('true');
    await page.getByRole('tab', { name: 'Generated Script' }).click();
    const script = page.getByRole('tabpanel', { name: 'Generated Script' }).locator('textarea.ce-area');
    await expect(script).toHaveValue(/var _iterator_flag_0 = true;[\s\S]*if \(!\([\s\S]*_iterator_flag_0 = false; break;/);

    await page.getByRole('tab', { name: 'Rule', exact: true }).click();
    await all.selectOption('false');
    await early.selectOption('false');
    expect((await save())[FILTER_ITERATOR][0]).toMatchObject({
        name: `Accept message if at least one of the iterations returns true for each ${PREFIX}`,
        properties: { intersectIterations: false, breakEarly: false }
    });
    await page.getByRole('tab', { name: 'Generated Script' }).click();
    await expect(script).toHaveValue(/var _iterator_flag_0 = false;[\s\S]*if \(\s*\(function[\s\S]*_iterator_flag_0 = true; }/);
});

test('a modified inbound tree drop saves a writable Message Builder target', async ({ page }) => {
    const builder = { type: BUILDER, name: 'Write observation', messageSegment: '', mapping: "'new'", defaultValue: '', replacements: '' };
    const save = await openEditor(page, [iterator('Observations', 'i', [builder])], 'transformer',
        '<m><OBX><value>one</value></OBX><OBX><value>two</value></OBX></m>');
    await row(page, builder.name).locator('td.num').click();
    await page.getByRole('tab', { name: 'Message Trees' }).click();
    const tree = page.getByRole('region', { name: 'Inbound message tree (msg)' });
    await tree.getByRole('row').filter({ has: page.getByText('OBX[0]', { exact: true }) }).locator('.twisty').click();
    const source = tree.getByRole('row').filter({ has: page.getByText('value', { exact: true }) });
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    await source.dispatchEvent('dragstart', { dataTransfer: transfer });
    const segment = page.locator('.step-editor-fill .field:has(label:text-is("Message Segment")) input');
    await segment.dispatchEvent('drop', { dataTransfer: transfer, altKey: true });
    expect(children(await save(), 'Observations')[BUILDER][0].messageSegment).toBe(PREFIX + "[i]['value']");
});

test('a Message Builder preview creates missing output objects and XML segments inside its Iterator', async ({ page }) => {
    await page.route('**/vendor/monaco/**', route => route.abort());
    const target = "tmp['observations'][i]['value']";
    await openEditor(page, [iterator('Observations', 'i', [
        { type: BUILDER, name: 'Set value', messageSegment: target, mapping: mapping('i') }
    ])]);
    await row(page, 'Observations').locator('td.num').click();
    await page.getByRole('tab', { name: 'Generated Script' }).click();
    const preview = page.getByRole('tabpanel', { name: 'Generated Script' }).locator('textarea.ce-area');
    await expect(preview).toHaveValue(/createSegment\('observations', tmp, i\)/);
    const script = await preview.inputValue();
    expect(script).toContain("tmp['observations'] = [];");
    expect(script).toContain("tmp['observations'][i] = {};");
    expect(script).toContain(target + ' = validate(');
});

test('assigning a filter rule creates a short-circuiting Iterator', async ({ page }) => {
    await page.route('**/vendor/monaco/**', route => route.abort());
    const rule = { type: RULE, name: 'Observation rule', operator: 'NONE', field: mapping(), condition: 'EXISTS' };
    const save = await openEditor(page, [rule], 'filter');
    await row(page, rule.name).locator('td.num').click();
    await click(page, 'Assign To Iterator');
    await page.getByRole('dialog', { name: 'Assign To Iterator' }).getByRole('button', { name: 'Use Iterator' }).click();
    const props = (await save())[FILTER_ITERATOR][0].properties;
    expect(props).toMatchObject({ target: PREFIX, intersectIterations: false, breakEarly: true });
    expect(props.children[RULE][0].field).toBe(mapping('i'));
    await page.reload();
    await page.locator('.element-list-pane tr[data-path="0"] td.num').click();
    await page.getByRole('tab', { name: 'Generated Script' }).click();
    const preview = page.getByRole('tabpanel', { name: 'Generated Script' }).locator('textarea.ce-area');
    await expect(preview).toHaveValue(/_iterator_flag_0 = true; break;[\s\S]*return _iterator_flag_0;/);
});

test('editing a second Iterator prefix preserves a multiline computed prefix through assignment', async ({ page }) => {
    const prefix = "msg.*::[(function() {\n  return 'OBX';\n})()]";
    const save = await openEditor(page, [iterator('Observations', 'i', [], [prefix]),
        { ...mapper(), mapping: prefix + '[0].value.toString()' }]);
    await row(page, 'Observations').locator('td.num').click();
    await page.getByRole('button', { name: 'New prefix' }).click();
    await page.getByRole('textbox', { name: 'Prefix 2' }).fill("  tmp['OBX'] ");
    expect((await save())[ITERATOR][0].properties.prefixSubstitutions.string).toEqual([prefix, "  tmp['OBX'] "]);
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Prefix 1' })).toHaveValue(prefix);
    await assign(page, 'Observation', 'Observations');
    expect(children(await save(), 'Observations')[MAPPER][0].mapping).toBe(prefix + '[i].value.toString()');
});

for (const kind of ['filter', 'transformer']) {
    test(`editing a second ${kind} comparison preserves the first expression across reload`, async ({ page }) => {
        const multiline = "(function(){\r\nreturn 'one';\r\n})()";
        const type = kind === 'filter' ? RULE : 'com.mirth.connect.plugins.destinationsetfilter.DestinationSetFilterStep';
        const save = await openEditor(page, [{ type, name: 'Compare', condition: 'EQUALS', field: mapping(),
            values: { string: [multiline, "'two'"] } }], kind);
        await page.getByRole('textbox', { name: 'Value 2' }).fill("'three'");
        expect((await save())[type][0].values.string).toEqual([multiline, "'three'"]);
        await page.reload();
        await expect(page.getByRole('textbox', { name: 'Value 1' })).toHaveValue(multiline.replaceAll('\r\n', '\n'));
    });
}

test('dropping a repeated tree field into an existing Mapper uses the receiving Iterator', async ({ page }) => {
    const save = await openEditor(page, [iterator('Observations', 'i', [mapper()])], 'transformer',
        '<m><OBX><value>one</value></OBX><OBX><value>two</value></OBX></m>');
    await row(page, 'Observation').locator('td.num').click();
    await page.getByRole('tab', { name: 'Message Trees' }).click();
    const tree = page.getByRole('region', { name: 'Inbound message tree (msg)' });
    await tree.getByRole('row').filter({ has: page.getByText('OBX[0]', { exact: true }) }).locator('.twisty').click();
    const field = page.locator('.step-editor-fill .field:has(label:text-is("Mapping")) input');
    await field.fill('');
    await tree.getByRole('row').filter({ has: page.getByText('value', { exact: true }) }).dragTo(field);
    const expression = PREFIX + "[i]['value'].toString()";
    await expect(field).toHaveValue(expression);
    expect(children(await save(), 'Observations')[MAPPER][0].mapping).toBe(expression);
});

test('an ambiguous prefix returned by 4.6.0 never matches unrelated Mapper fields', async ({ page }) => {
    const parent = iterator('Observations');
    // The shipped JSON writer represents the String prefix "null" as JSON null.
    parent.properties.prefixSubstitutions = { string: [PREFIX, null] };
    const step = { ...mapper(), defaultValue: "channelMap.get('fallback')" };
    const save = await openEditor(page, [parent, step]);
    await assign(page, step.name, parent.name);
    const assigned = children(await save(), parent.name)[MAPPER][0];
    expect(assigned).toMatchObject({ mapping: mapping('i'), defaultValue: step.defaultValue });
    await page.reload();
    await row(page, step.name).locator('td.num').click();
    await expect(page.locator('.step-editor-fill .field:has(label:text-is("Default Value")) input')).toHaveValue(step.defaultValue);
});
