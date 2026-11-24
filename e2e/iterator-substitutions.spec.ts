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

async function openEditor(page: Page, elements: Element[], kind = 'transformer', template = '', dataType?: string) {
    const id = 'iterator-test';
    let channel = makeChannel(id);
    const target = () => kind === 'response' ? channel.destinationConnectors.connector[0].responseTransformer : channel.sourceConnector[kind];
    target().elements = wire(elements);
    if (dataType) target().inboundDataType = dataType;
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

test('assigning and detaching a Mapper preserves its regex cleanup and updates the repetition', async ({ page }) => {
    const cleanup = ".replace(/-/g, '')";
    const save = await openEditor(page, [{ ...mapper(), mapping: mapping() + cleanup }, iterator('Groups')]);
    await assign(page, 'Observation', 'Groups');
    expect(children(await save(), 'Groups')[MAPPER][0].mapping).toBe(PREFIX + '[i]' + mapping().slice(PREFIX.length) + cleanup);
    await page.reload();
    await row(page, 'Observation').locator('td.num').click();
    await click(page, 'Remove From Iterator');
    expect((await save())[MAPPER][0].mapping).toBe(mapping() + cleanup);
});

for (const prefix of [PREFIX, 'msg']) {
    test(`a JSON regex Mapper reads each object in ${prefix} and the first object on detach`, async ({ page }) => {
        const path = (index: string) => `${prefix}[${index}]['OBX.5'].toString().replace(/-/g, '')`;
        const save = await openEditor(page, [{ ...mapper(), mapping: path('0') }, iterator('Groups', 'i', [], [prefix])],
            'transformer', '', 'JSON');
        await assign(page, 'Observation', 'Groups');
        expect(children(await save(), 'Groups')[MAPPER][0].mapping).toBe(path('i'));
        await page.reload();
        await row(page, 'Observation').locator('td.num').click();
        await click(page, 'Remove From Iterator');
        expect((await save())[MAPPER][0].mapping).toBe(path('0'));
    });
}

test('a new Iterator preserves an existing column selector from a preceding script', async ({ page }) => {
    const mapping = "msg['rows'][0]['values'][i]";
    const save = await openEditor(page, [
        { type: 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep', name: 'Choose column', script: 'var i = 1;' },
        { ...mapper(), mapping }
    ]);
    await row(page, 'Observation').locator('td.num').click();
    await click(page, 'Assign To Iterator');
    const dialog = page.getByRole('dialog', { name: 'Assign To Iterator' });
    await dialog.getByLabel('Iterate On', { exact: true }).selectOption("msg['rows']");
    await expect(dialog.getByLabel('Index Variable')).toHaveValue('j');
    await dialog.getByRole('button', { name: 'Use Iterator' }).click();
    const props = (await save())[ITERATOR][0].properties;
    expect(props.indexVariable).toBe('j');
    expect(props.children[MAPPER][0].mapping).toBe("msg['rows'][j]['values'][i]");
});

test('moving a child and its Iterator preserves the stored mapping and default', async ({ page }) => {
    const expression = PREFIX + "[i]['OBX.5'][1].toString()";
    const observation = { ...mapper(), mapping: expression, defaultValue: expression };
    const save = await openEditor(page, [iterator('Loop', 'i', [observation, { ...mapper(), name: 'Inner sibling' }]),
        { ...mapper(), name: 'Outer sibling' }]);
    for (const [element, path] of [['Observation', '0.1'], ['Loop', '1']]) {
        await row(page, element).locator('td.num').click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Move Step Down' }).click();
        await expect(row(page, element)).toHaveAttribute('data-path', path);
    }
    const mapped = children(await save(), 'Loop')[MAPPER][1];
    expect(mapped).toMatchObject({ mapping: expression, defaultValue: expression });
});

test('renaming a populated Iterator updates child paths and rejects a nested index in use', async ({ page }) => {
    const observation = { ...mapper(), mapping: PREFIX + '[i].value.toString()' };
    const loop = iterator('Loop', 'i', [observation, iterator('Nested', 'nested', [], [PREFIX + '[i].item'])]);
    loop.properties.prefixSubstitutions = '';
    const save = await openEditor(page, [loop]);
    const index = page.locator('.step-editor-fill .field:has(label:text-is("Index Variable")) input');
    await index.fill('');
    await index.pressSequentially('nested');
    await index.press('Enter');
    await expect(index).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('button', { name: 'Save Channel', exact: true })).toHaveCount(0);
    await index.fill('k');
    await index.press('Enter');
    await expect(index).toHaveAttribute('aria-invalid', 'false');
    const saved = (await save())[ITERATOR][0].properties;
    expect(saved.indexVariable).toBe('k');
    expect(saved.children[MAPPER][0].mapping).toBe(PREFIX + '[k].value.toString()');
    expect(saved.children[ITERATOR][0].properties.target).toBe(PREFIX + '[k].item');
});

test('a nested index rename checks a sibling accumulator and accepts the default script comment', async ({ page }) => {
    const inner = iterator('Inner', 'j', [], [PREFIX + "[i]['OBX.5']"]);
    const save = await openEditor(page, [iterator('Outer', 'i', [{ ...mapper(), mapping: mapping('i') }, inner])]);
    await row(page, 'Inner').locator('td.num').click();
    const index = page.locator('.step-editor-fill .field:has(label:text-is("Index Variable")) input');
    await index.fill('_observations');
    await index.press('Enter');
    await expect(index).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('button', { name: 'Save Channel', exact: true })).toHaveCount(0);

    await click(page, 'Add New Step');
    await page.locator('tr[data-path="0.1.0"] select').selectOption('com.mirth.connect.plugins.javascriptstep.JavaScriptStep');
    await row(page, 'Inner').locator('td.num').click();
    await index.fill('k');
    await index.press('Enter');
    await expect(index).toHaveAttribute('aria-invalid', 'false');
    expect(children(await save(), 'Outer')[ITERATOR][0].properties.indexVariable).toBe('k');
});

test('renaming a loop index preserves variables shared by sibling JavaScript steps', async ({ page }) => {
    const js = 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep';
    const save = await openEditor(page, [
        { type: js, name: 'Remember count', script: 'var count = 41;' },
        iterator('Loop', 'i', [{ ...mapper(), mapping: mapping('i') }]),
        { type: js, name: 'Use count', script: "channelMap.put('count', count);" }
    ]);
    await row(page, 'Loop').locator('td.num').click();
    const index = page.locator('.step-editor-fill .field:has(label:text-is("Index Variable")) input');
    await index.fill('count');
    await index.press('Enter');
    await expect(index).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('button', { name: 'Save Channel', exact: true })).toHaveCount(0);

    await index.fill('position');
    await index.press('Enter');
    const props = (await save())[ITERATOR][0].properties;
    expect(props.indexVariable).toBe('position');
    expect(props.children[MAPPER][0].mapping).toBe(mapping('position'));
});

test('an index edit leaves the original stored mapping when one reference cannot be renamed', async ({ page }) => {
    const expression = PREFIX + '[i][fields[i]]';
    const save = await openEditor(page, [iterator('Loop', 'i', [{ ...mapper(), mapping: expression }])]);
    const index = page.locator('.step-editor-fill .field:has(label:text-is("Index Variable")) input');
    await index.fill('j');
    await index.press('Enter');
    await expect(index).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(/Update references the editor cannot rename/)).toBeVisible();
    const target = page.locator('.step-editor-fill .field:has(label:text-is("Iterate On (target)")) input');
    await target.fill(PREFIX + '.children()');
    const stored = (await save())[ITERATOR][0].properties;
    expect(stored.indexVariable).toBe('i');
    expect(stored.children[MAPPER][0].mapping).toBe(expression);
});

test('a dynamic XSLT stylesheet prevents a partial Iterator index rename', async ({ page }) => {
    const xslt = { type: 'com.mirth.connect.plugins.xsltstep.XsltStep', name: 'Dynamic stylesheet',
        sourceXml: "'<r/>'", resultVariable: 'out', template: 'styles[i]' };
    const observation = { ...mapper(), mapping: mapping('i') };
    const save = await openEditor(page, [iterator('Loop', 'i', [observation, xslt])]);
    const index = page.locator('.step-editor-fill .field:has(label:text-is("Index Variable")) input');
    await index.fill('j');
    await index.press('Tab');
    await expect(index).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('button', { name: 'Save Channel', exact: true })).toHaveCount(0);

    await row(page, observation.name).getByRole('checkbox').uncheck();
    const stored = (await save())[ITERATOR][0].properties;
    expect(stored.indexVariable).toBe('i');
    expect(stored.children[xslt.type][0].template).toBe(xslt.template);
    expect(stored.children[MAPPER][0]).toMatchObject({ enabled: false, mapping: observation.mapping });
});

test('reserved words and generated Mapper variables cannot replace an Iterator index', async ({ page }) => {
    const expression = PREFIX + '[i].value.toString()';
    const save = await openEditor(page, [iterator('Loop', 'i', [{ ...mapper(), mapping: expression }])]);
    const index = page.locator('.step-editor-fill .field:has(label:text-is("Index Variable")) input');
    for (const rejected of ['export', 'import', 'extends', 'super', 'phase', 'Packages', 'Object', 'JSON', 'mapping', '_observations']) {
        await index.fill(rejected);
        await index.press('Enter');
        await expect(index).toHaveAttribute('aria-invalid', 'true');
        await expect(page.getByRole('button', { name: 'Save Channel', exact: true })).toHaveCount(0);
    }
    const enabled = row(page, 'Observation').getByRole('checkbox');
    await enabled.uncheck();
    for (const rejected of ['mapping', '_observations']) {
        await index.fill(rejected);
        await index.press('Enter');
        await expect(index).toHaveAttribute('aria-invalid', 'true');
        await expect(page.getByText(/Review generated variables/)).toBeVisible();
    }
    await index.fill('positions');
    await index.press('Enter');
    await expect(index).toHaveAttribute('aria-invalid', 'false');
    const stored = (await save())[ITERATOR][0].properties;
    expect(stored.indexVariable).toBe('positions');
    expect(stored.children[MAPPER][0]).toMatchObject({ enabled: false, mapping: PREFIX + '[positions].value.toString()' });

    await page.reload();
    await enabled.check();
    await expect(index).toHaveValue('positions');
    await index.fill('i');
    await index.press('Enter');
    await expect(index).toHaveAttribute('aria-invalid', 'false');
    const restored = (await save())[ITERATOR][0].properties;
    expect(restored.indexVariable).toBe('i');
    expect(restored.children[MAPPER][0]).toMatchObject({ enabled: true, mapping: expression });
});

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

for (const scenario of ['sibling', 'nested', 'legacy namespaced sibling', 'mixed namespace sibling']) {
    test(`a tree-created Mapper uses the ${scenario} Iterator after reload`, async ({ page }) => {
        const create = scenario === 'nested';
        const mixed = scenario === 'mixed namespace sibling';
        const ns = scenario === 'legacy namespaced sibling' || mixed ? 'v:' : '';
        const prefix = ns ? "msg.*::['OBX']" : PREFIX;
        const value = ns ? ".*::['value']" : "['value']";
        const other = mixed ? '<w:OBX><w:value>other</w:value></w:OBX>' : '';
        const xml = `<message xmlns:v="urn:observations" xmlns:w="urn:other"><${ns}OBX><${ns}value>one</${ns}value></${ns}OBX>${other}<${ns}OBX><${ns}value>two</${ns}value></${ns}OBX></message>`;
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
        const bound = (index: string) => `${prefix}${index}${value}.toString()`;
        const expression = create ? `${prefix}[i]${value}[j].toString()` : bound('[j]');
        expect(mapped[MAPPER][0].mapping).toBe(expression);
        await page.reload();
        await row(page, mapped[MAPPER][0].name).locator('td.num').click();
        await expect(page.locator('.step-editor-fill .field:has(label:text-is("Mapping")) input')).toHaveValue(expression);
        if (ns) {
            await row(page, 'Destination').locator('td.num').click();
            const index = page.locator('.step-editor-fill .field:has(label:text-is("Index Variable")) input');
            await index.fill('k');
            await index.press('Enter');
            const renamed = children(await save(), 'Destination')[MAPPER][0];
            expect(renamed.mapping).toBe(bound('[k]'));
            await row(page, renamed.name).locator('td.num').click();
            await click(page, 'Remove From Iterator');
            expect((await save())[MAPPER][0].mapping).toBe(bound(''));
        }
    });
}

for (const { template, label, selector } of [
    {
        template: '<message xmlns:v="urn:values"><v:value>one</v:value><v:value>two</v:value></message>',
        label: 'v:value[1]', selector: ".*::['value']"
    },
    {
        template: '<message xmlns="urn:values" xmlns:w="urn:other"><value>one</value><w:value>other</w:value><value>two</value></message>',
        label: 'value[1]', selector: "['value']"
    }
]) {
    test(`a tree-created Mapper binds repeated ${label} to its Swing Iterator`, async ({ page }) => {
        const prefix = `msg${selector}`;
        const save = await openEditor(page, [iterator('Values', 'i', [], [prefix])], 'transformer', template);
        await row(page, 'Values').locator('td.num').click();
        await page.getByRole('tab', { name: 'Message Trees' }).click();
        const tree = page.getByRole('region', { name: 'Inbound message tree (msg)' });
        await tree.getByRole('row').filter({ has: page.getByText(label, { exact: true }) }).click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Map to Variable' }).click();
        await page.getByRole('dialog', { name: 'Select An Option' }).getByRole('button', { name: 'No', exact: true }).click();

        const expression = (index: string) => `${prefix}${index}.toString()`;
        const mapped = children(await save(), 'Values')[MAPPER][0];
        expect(mapped.mapping).toBe(expression('[i]'));
        await page.reload();
        await row(page, 'Values').locator('td.num').click();
        const index = page.locator('.step-editor-fill .field:has(label:text-is("Index Variable")) input');
        await index.fill('j');
        await index.press('Enter');
        expect(children(await save(), 'Values')[MAPPER][0].mapping).toBe(expression('[j]'));
        await row(page, mapped.name).locator('td.num').click();
        await click(page, 'Remove From Iterator');
        expect((await save())[MAPPER][0].mapping).toBe(expression(''));
    });
}

test('mapping a repeated leaf under a qualified parent uses the configured Iterator index', async ({ page }) => {
    const prefix = "msg.*::['group'].*::['value']";
    const template = '<m xmlns:v="urn:v"><v:group><v:value>one</v:value><v:value>two</v:value></v:group></m>';
    const save = await openEditor(page, [iterator('Values', 'i', [], [prefix])], 'transformer', template);
    await row(page, 'Values').locator('td.num').click();
    await page.getByRole('tab', { name: 'Message Trees' }).click();
    const tree = page.getByRole('region', { name: 'Inbound message tree (msg)' });
    await tree.getByRole('row').filter({ has: page.getByText('v:group', { exact: true }) }).locator('.twisty').click();
    await tree.getByRole('row').filter({ has: page.getByText('v:value[1]', { exact: true }) }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Map to Variable' }).click();
    await page.getByRole('dialog', { name: 'Select An Option' }).getByRole('button', { name: 'No', exact: true }).click();
    const mapped = children(await save(), 'Values')[MAPPER][0];
    expect(mapped.mapping).toBe(prefix + '[i].toString()');
    await page.reload();
    await row(page, mapped.name).locator('td.num').click();
    await expect(page.locator('.step-editor-fill .field:has(label:text-is("Mapping")) input')).toHaveValue(mapped.mapping);
});

test('mapping the whole message creates a valid Mapper with a unique key', async ({ page }) => {
    const xslt = { type: 'com.mirth.connect.plugins.xsltstep.XsltStep', name: 'Transform', resultVariable: 'msg' };
    const save = await openEditor(page, [{ ...mapper(), variable: 'msg_2' }, iterator('Loop', 'i', [xslt])],
        'transformer', '<Envelope><id>1</id></Envelope>');
    await page.getByRole('tab', { name: 'Message Trees' }).click();
    const tree = page.getByRole('region', { name: 'Inbound message tree (msg)' });
    await tree.locator('.mt-root-label').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Map to Variable' }).click();
    await page.getByRole('dialog', { name: 'Select An Option' }).getByRole('button', { name: 'No', exact: true }).click();
    expect((await save())[MAPPER][1]).toMatchObject({ name: 'msg_3', variable: 'msg_3', mapping: 'msg.toString()' });
});

test('assigning a subtree checks the destination index before moving any steps', async ({ page }) => {
    const save = await openEditor(page, [iterator('Source', 'j', [mapper()]), iterator('Conflict', 'mapping'), iterator('Safe')]);
    await assign(page, 'Source', 'Conflict');
    const warning = page.getByRole('dialog', { name: 'Warning' });
    await expect(warning).toContainText('Mapper step uses the Iterator index name "mapping"');
    await warning.getByRole('button', { name: 'Close' }).last().click();
    await expect(row(page, 'Source')).toHaveAttribute('data-path', '0');
    await expect(row(page, 'Observation')).toHaveAttribute('data-path', '0.0');
    await expect(page.getByRole('button', { name: 'Save Channel', exact: true })).toHaveCount(0);

    await assign(page, 'Observation', 'Safe');
    const stored = await save();
    expect(children(stored, 'Safe')[MAPPER][0].mapping).toBe(mapping('i'));
    expect(children(stored, 'Conflict')).toBe('');
});

test('adding a tree Mapper checks the current index and permits retry after a rename', async ({ page }) => {
    const save = await openEditor(page, [iterator('Loop', 'mapping')], 'transformer', '<m><OBX>one</OBX><OBX>two</OBX></m>');
    await page.getByRole('tab', { name: 'Message Trees' }).click();
    const tree = page.getByRole('region', { name: 'Inbound message tree (msg)' });
    async function mapRoot() {
        await tree.locator('.mt-root-label').click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Map to Variable' }).click();
        await page.getByRole('dialog', { name: 'Select An Option' }).getByRole('button', { name: 'No', exact: true }).click();
    }
    await mapRoot();
    const warning = page.getByRole('dialog', { name: 'Warning' });
    await expect(warning).toContainText('Mapper step uses the Iterator index name "mapping"');
    await warning.getByRole('button', { name: 'Close' }).last().click();
    await expect(page.locator('tr[data-path]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Save Channel', exact: true })).toHaveCount(0);

    const index = page.locator('.step-editor-fill .field:has(label:text-is("Index Variable")) input');
    await index.fill('i');
    await index.press('Enter');
    await mapRoot();
    expect(children(await save(), 'Loop')[MAPPER][0].variable).toBe('msg');
});

test('response transformer Add and type conversion preserve a conflicting Iterator draft', async ({ page }) => {
    const js = 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep';
    await openEditor(page, [iterator('Loop', 'mapping', [{ type: js, name: 'Existing', script: '' }])], 'response');
    await click(page, 'Add New Step');
    const warning = page.getByRole('dialog', { name: 'Warning' });
    await expect(warning).toContainText('Mapper step uses the Iterator index name "mapping"');
    await warning.getByRole('button', { name: 'Close' }).last().click();
    const type = row(page, 'Existing').getByRole('combobox');
    await type.selectOption(MAPPER);
    await expect(warning).toContainText('Mapper step uses the Iterator index name "mapping"');
    await warning.getByRole('button', { name: 'Close' }).last().click();
    await expect(type).toHaveValue(js);
    await expect(page.locator('tr[data-path]')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Save Channel', exact: true })).toHaveCount(0);
});

test('validation identifies the affected Mapper in a previously saved conflicting loop', async ({ page }) => {
    await openEditor(page, [iterator('Loop', 'mapping', [{ ...mapper(), mapping: mapping('mapping') }])]);
    await row(page, 'Observation').locator('td.num').click();
    for (const task of ['Validate Step', 'Validate Transformer']) {
        await click(page, task);
        const error = page.getByRole('dialog', { name: /Error validating transformer steps/i });
        await expect(error).toContainText('step 0-0');
        await expect(error).toContainText('Mapper step uses the Iterator index name "mapping"');
        await error.getByRole('button', { name: 'Close' }).last().click();
    }
});

test('a tree Mapper preserves authored locals in the same transformer function', async ({ page }) => {
    const js = 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep';
    const save = await openEditor(page, [
        { type: js, name: 'Remember', script: "var _msg = 'prior';" },
        iterator('Loop'),
        { type: js, name: 'Publish', script: "channelMap.put('after', _msg); // _msg_2" }
    ], 'transformer', '<m><OBX>one</OBX><OBX>two</OBX></m>');
    await row(page, 'Loop').locator('td.num').click();
    await page.getByRole('tab', { name: 'Message Trees' }).click();
    const tree = page.getByRole('region', { name: 'Inbound message tree (msg)' });
    await tree.locator('.mt-root-label').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Map to Variable' }).click();
    await page.getByRole('dialog', { name: 'Select An Option' }).getByRole('button', { name: 'No', exact: true }).click();
    expect(children(await save(), 'Loop')[MAPPER][0]).toMatchObject({ name: 'msg_2', variable: 'msg_2' });
});

test('a tree Mapper reserves the normalized accumulators in its outer Iterator across map scopes', async ({ page }) => {
    const existing = { ...mapper(), variable: 'msg', scope: 'CONNECTOR' };
    const nested = iterator('Inner', 'j', [{ ...mapper(), variable: 'm-sg_2', scope: 'RESPONSE' }]);
    const independent = iterator('Other', 'k', [{ ...mapper(), variable: 'msg_3', scope: 'CONNECTOR' }]);
    const save = await openEditor(page, [iterator('Loop', 'i', [existing, nested]), independent], 'transformer', '<m><id>1</id></m>');
    await row(page, 'Loop').locator('td.num').click();
    await page.getByRole('tab', { name: 'Message Trees' }).click();
    const tree = page.getByRole('region', { name: 'Inbound message tree (msg)' });
    await tree.locator('.mt-root-label').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Map to Variable' }).click();
    await page.getByRole('dialog', { name: 'Select An Option' }).getByRole('button', { name: 'No', exact: true }).click();
    expect(children(await save(), 'Loop')[MAPPER].map((step: Element) => [step.variable, step.scope]))
        .toEqual([['msg', 'CONNECTOR'], ['msg_3', 'CHANNEL']]);
});

test('a tree Mapper preserves literal channel-map writes from JavaScript steps', async ({ page }) => {
    const script = [
        "var note = <note>original</note>; channelMap.put('msg', note.toString());",
        'var url = "https://example.test/"; $c("msg_2", url);',
        "// channelMap.put('msg_3', 'comment');",
        "$c('msg_3'); connectorMap.put('msg_3', 'local');"
    ].join('\n');
    const save = await openEditor(page, [{ type: 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep', name: 'Publish', script }],
        'transformer', '<m><id>1</id></m>');
    await page.getByRole('tab', { name: 'Message Trees' }).click();
    const tree = page.getByRole('region', { name: 'Inbound message tree (msg)' });
    await tree.locator('.mt-root-label').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Map to Variable' }).click();
    await page.getByRole('dialog', { name: 'Select An Option' }).getByRole('button', { name: 'No', exact: true }).click();
    expect((await save())[MAPPER][0]).toMatchObject({ name: 'msg_3', variable: 'msg_3' });
});

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

for (const kind of ['filter', 'transformer']) {
    test(`converting a Swing JavaScript ${kind} prompts only for the authored script`, async ({ page }) => {
        const filter = kind === 'filter';
        const type = filter ? 'com.mirth.connect.plugins.javascriptrule.JavaScriptRule' : 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep';
        const next = filter ? FILTER_ITERATOR : ITERATOR;
        const script = filter ? 'return false;' : "channelMap.put('seen', true);";
        const save = await openEditor(page, [
            { type, name: 'Blank', script: null }, { type, name: 'Authored', script }
        ], kind);
        const select = (path: number) => page.locator(`tr[data-path="${path}"] td`).last().getByRole('combobox');
        await select(0).selectOption(next);
        await expect(select(0)).toHaveValue(next);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await select(1).selectOption(next);
        await page.getByRole('dialog').getByRole('button', { name: 'No', exact: true }).click();
        await expect(select(1)).toHaveValue(type);
        const elements = await save();
        expect(elements[type][0]).toMatchObject({ name: 'Authored', script });
        expect(elements[next]).toHaveLength(1);
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

test('Back checks a JavaScript sibling inside an Iterator with a custom Builder target', async ({ page }) => {
    await openEditor(page, [iterator('Custom target', 'i', [
        { type: BUILDER, name: 'Set value', messageSegment: "tmp.rows[i][chooseKey({fallback: 'value'})]", mapping: "'ok'" },
        { type: 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep', name: 'Unfinished', script: 'var unfinished = ;' }
    ])]);
    await page.route('**/javascript/_validate', route => route.fulfill({ json: {
        error: route.request().postData()?.includes('var unfinished = ;') ? 'syntax error' : null
    } }));
    await click(page, 'Back to Channel');
    await expect(page.getByText('Error validating transformer steps', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/transformer\/0$/);
});

test('an opaque Message Builder target reports incomplete Iterator validation and still checks siblings', async ({ page }) => {
    await page.route('**/vendor/monaco/**', route => route.abort());
    const target = "tmp.rows[i][chooseKey({fallback: 'value'})]";
    await openEditor(page, [iterator('Custom target', 'i', [
        { type: BUILDER, name: 'Set value', messageSegment: target, mapping: "'value'" }
    ]), mapper()]);
    const submitted: string[] = [];
    await page.route('**/javascript/_validate', async route => {
        submitted.push(route.request().postData() || '');
        await route.fulfill({ json: { error: null } });
    });
    await row(page, 'Custom target').locator('td.num').click();
    await page.getByRole('tab', { name: 'Generated Script' }).click();
    await expect(page.getByRole('tabpanel', { name: 'Generated Script' }).locator('textarea.ce-area'))
        .toHaveValue(/Use Swing to preview or validate its Iterator/);
    await click(page, 'Validate Step');
    const warning = page.getByRole('dialog', { name: 'Warning' });
    await expect(warning).toContainText('Use Swing to preview or validate its Iterator');
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toContain(target);
    await warning.getByRole('button', { name: 'Close' }).last().click();
    await click(page, 'Validate Transformer');
    await expect.poll(() => submitted.length).toBe(3);
    expect(submitted[1]).toBe(submitted[0]);
    expect(submitted[2]).toContain("channelMap.put('observations'");
    await expect(warning).toContainText('Use Swing to preview or validate its Iterator');
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

test('a standalone namespaced Mapper binds to a Swing wildcard Iterator after save and reload', async ({ page }) => {
    // Six saves and two full reloads can exceed 30 seconds on hosted WebKit.
    test.setTimeout(60_000);
    const prefix = "msg.*::['OBX']";
    const bound = (index: string) => `${prefix}${index}.*::['value'].toString()`;
    const standalone = bound('[2]');
    const authored = "msg[new QName('urn:observations', 'OBX')][1].toString() + ' supplemental'";
    const xml = '<message xmlns:v="urn:observations" xmlns:w="urn:other">'
        + '<v:OBX><v:value>one</v:value></v:OBX><w:OBX><w:value>other</w:value></w:OBX>'
        + '<v:OBX><v:value>two</v:value></v:OBX></message>';
    const sibling = { ...mapper(), name: 'Unrelated' };
    const save = await openEditor(page, [sibling, iterator('Original', 'i', [], [prefix]), iterator('Destination', 'j', [], [prefix])], 'transformer', xml);
    await page.getByRole('tab', { name: 'Message Trees' }).click();
    const tree = page.getByRole('region', { name: 'Inbound message tree (msg)' });
    await tree.getByRole('row').filter({ has: page.getByText('v:OBX[1]', { exact: true }) }).locator('.twisty').click();
    await tree.getByRole('row').filter({ has: page.getByText('v:value', { exact: true }) }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Map to Variable' }).click();
    await page.getByRole('dialog', { name: 'Select An Option' }).getByRole('button', { name: 'No' }).click();
    const field = (name: string) => page.locator(`.step-editor-fill .field:has(label:text-is("${name}")) input`);
    await field('Default Value').fill(authored);
    const saved = (await save())[MAPPER].find((el: Element) => el.name !== sibling.name);
    expect(saved).toMatchObject({ mapping: standalone, defaultValue: authored });

    await page.reload();
    await row(page, saved.name).locator('td.num').click();
    await expect(field('Mapping')).toHaveValue(standalone);
    await click(page, 'Assign To Iterator');
    const dialog = page.getByRole('dialog', { name: 'Assign To Iterator' });
    await expect(dialog.getByLabel('Iterator', { exact: true }).locator('option:checked')).toHaveText('Original');
    await dialog.getByRole('button', { name: 'Use Iterator' }).click();
    expect(children(await save(), 'Original')[MAPPER][0]).toMatchObject({ mapping: bound('[i]'), defaultValue: authored });

    await page.reload();
    await assign(page, saved.name, 'Destination');
    const reassigned = await save();
    expect(children(reassigned, 'Original')).toBe('');
    expect(children(reassigned, 'Destination')[MAPPER][0]).toMatchObject({ mapping: bound('[j]'), defaultValue: authored });
    await click(page, 'Remove From Iterator');
    const rootMapping = (elements: any) => elements[MAPPER].find((el: Element) => el.name === saved.name);
    expect(rootMapping(await save())).toMatchObject({ mapping: bound(''), defaultValue: authored });

    await assign(page, saved.name, 'Original');
    expect(children(await save(), 'Original')[MAPPER][0].mapping).toBe(bound('[i]'));
    await row(page, saved.name).locator('td.num').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Move Step Down' }).click();
    await page.getByRole('dialog', { name: 'Move Step Down' }).getByRole('button', { name: 'OK' }).click();
    expect(rootMapping(await save())).toMatchObject({ mapping: bound(''), defaultValue: authored });
});

test('a namespaced tree drop preserves the draft and accepts a manually indexed Message Segment', async ({ page }) => {
    const prefix = 'msg.env.v::group';
    const builder = { type: BUILDER, name: 'Write value', messageSegment: 'msg.audit', mapping: "'updated'+i" };
    const xml = '<m xmlns:v="urn:v"><env><v:group><value>one</value></v:group><v:group><value>two</value></v:group></env></m>';
    const save = await openEditor(page, [
        { type: 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep', name: 'Namespace', script: "var v=new Namespace('urn:v');" },
        iterator('Groups', 'i', [builder], [prefix])
    ], 'transformer', xml);
    await row(page, builder.name).locator('td.num').click();
    await page.getByRole('tab', { name: 'Message Trees' }).click();
    const tree = page.getByRole('region', { name: 'Inbound message tree (msg)' });
    for (const name of ['env', 'v:group[0]']) {
        await tree.getByRole('row').filter({ has: page.getByText(name, { exact: true }) }).locator('.twisty').click();
    }
    const segment = page.locator('[data-message-segment]');
    await tree.getByRole('row').filter({ has: page.getByText('value', { exact: true }) }).dragTo(segment);
    const warning = page.getByRole('dialog', { name: 'Warning' });
    await expect(warning).toContainText('Enter its indexed Message Segment manually');
    await warning.getByRole('button', { name: 'Close' }).last().click();
    await expect(segment).toHaveValue(builder.messageSegment);
    await expect(page.getByRole('button', { name: 'Save Channel', exact: true })).toBeHidden();
    const indexed = prefix + '[i].value';
    await segment.fill(indexed);
    await segment.blur();
    expect(children(await save(), 'Groups')[BUILDER][0].messageSegment).toBe(indexed);
    await page.reload();
    await row(page, builder.name).locator('td.num').click();
    await expect(page.locator('[data-message-segment]')).toHaveValue(indexed);
});

test('Message Segment drops preserve the parent Iterator and reject a wildcard attribute write', async ({ page }) => {
    const prefix = "msg.*::['group']";
    const builder = { type: BUILDER, name: 'Write attribute', messageSegment: '', mapping: "'updated'" };
    const xml = '<m xmlns:v="urn:v"><v:group code="first"/><v:group code="second" v:other="qualified"/></m>';
    const save = await openEditor(page, [iterator('Groups', 'i', [builder], [prefix])], 'transformer', xml);
    await row(page, builder.name).locator('td.num').click();
    await page.getByRole('tab', { name: 'Message Trees' }).click();
    const tree = page.getByRole('region', { name: 'Inbound message tree (msg)' });
    await tree.getByRole('row').filter({ has: page.getByText('v:group[1]', { exact: true }) }).locator('.twisty').click();
    const segment = page.locator('[data-message-segment]');
    await tree.getByRole('row').filter({ has: page.getByText('@v:other', { exact: true }) }).dragTo(segment);
    const warning = page.getByRole('dialog', { name: 'Warning' });
    await expect(warning).toContainText('enter a namespace-qualified Message Segment');
    await warning.getByRole('button', { name: 'Close' }).last().click();
    await expect(segment).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Save Channel', exact: true })).toBeHidden();
    await tree.getByRole('row').filter({ has: page.getByText('@code', { exact: true }) }).dragTo(segment);
    expect(children(await save(), 'Groups')[BUILDER][0].messageSegment).toBe(prefix + "[i]['@code']");
});

for (const { prefix, xml, branch, field, warning, chooser } of [
    { prefix: "msg.*::['value']", xml: '<m xmlns:v="urn:v" xmlns:w="urn:w"><v:value>one</v:value><w:value>two</w:value></m>',
        branch: '', field: 'w:value', warning: 'To write this namespaced field, enter a namespace-qualified Message Segment in the Message Builder.', chooser: false },
    { prefix: "msg['@code']", xml: '<m code="one"><entry/></m>', branch: '', field: '@code',
        warning: 'Choose an Iterator over the parent element to write its attribute.', chooser: true },
    { prefix: "msg[new QName('urn:v', 'group')]", xml: '<m xmlns:v="urn:v"><v:group><value>one</value></v:group></m>',
        branch: 'v:group', field: 'value', warning: 'The Iterator uses a different selector for this repeating field.', chooser: true },
    { prefix: "msg[new QName('urn:v', 'group')]", xml: '<m xmlns:v="urn:v"><v:group><value>one</value></v:group><v:group><value>two</value></v:group></m>',
        branch: 'v:group[1]', field: 'value', warning: 'The Iterator uses a different selector for this repeating field. Enter its indexed Message Segment manually.', chooser: true }
]) {
    test(`the editor prevents an ineffective write to ${branch}/${field} under ${prefix}`, async ({ page }) => {
        await openEditor(page, [iterator('Values', 'i', [], [prefix])], 'transformer', xml);
        await row(page, 'Values').locator('td.num').click();
        await page.getByRole('tab', { name: 'Message Trees' }).click();
        const tree = page.getByRole('region', { name: 'Inbound message tree (msg)' });
        if (branch) await tree.getByRole('row').filter({ has: page.getByText(branch, { exact: true }) }).locator('.twisty').click();
        await tree.getByRole('row').filter({ has: page.getByText(field, { exact: true }) }).click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Map to Message' }).click();
        if (chooser) await page.getByRole('dialog', { name: 'Select An Option' }).getByRole('button', { name: 'No' }).click();
        const dialog = page.getByRole('dialog', { name: 'Warning' });
        await expect(dialog).toContainText(warning);
        await dialog.getByRole('button', { name: 'Close' }).last().click();
        await expect(page.locator('tr[data-path="0.0"]')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Save Channel', exact: true })).toBeHidden();
    });
}

test('assigning a Message Builder preserves a manually qualified writable target', async ({ page }) => {
    const prefix = "msg.*::['OBX']";
    const target = "msg[new QName('urn:observations', 'OBX')][1][new QName('urn:observations', 'value')]";
    const step = { type: BUILDER, name: 'Write observation', messageSegment: target, mapping: '', defaultValue: '', replacements: '' };
    const parent = iterator('Observations', 'i', [], [prefix]);
    const save = await openEditor(page, [step, parent]);
    await assign(page, step.name, parent.name);
    expect(children(await save(), parent.name)[BUILDER][0].messageSegment).toBe(target);
});
