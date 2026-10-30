import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';

/*
 * Guided Mapper / Message Builder editors and the transformer mapping table.
 * The channel's source transformer holds Mapper -> JavaScript -> Message
 * Builder, the order the user builds: the JavaScript step reads the Mapper's
 * variable and the Message Builder reads the JavaScript step's. Replacements
 * arrive in the engine's ObjectJSONSerializer shape.
 */

const V = '4.6.0';
const P = 'com.mirth.connect.plugins';
const PAIR = 'org.apache.commons.lang3.tuple.ImmutablePair';
const pair = (l: string, r: string) => ({ left: { '@class': 'string', $: l }, right: { '@class': 'string', $: r } });

const TREE_XML = '<HL7Message><MSH><MSH.4><MSH.4.1>GENHOSP</MSH.4.1></MSH.4></MSH>'
    + '<PID><PID.3><PID.3.1>MRN-448812</PID.3.1></PID.3><PID.5><PID.5.1>DOE</PID.5.1><PID.5.2>JANE</PID.5.2></PID.5></PID></HL7Message>';

function channel(id: string) {
    const ch = makeChannel(id);
    const tx = ch.sourceConnector.transformer;
    tx.inboundTemplate = 'MSH|^~\\&|APP|GENHOSP\rPID|1||MRN-448812||DOE^JANE';
    tx.outboundTemplate = 'MSH|^~\\&|APP|GENHOSP\rPID|1||X||Y';
    tx.elements = {
        [`${P}.mapper.MapperStep`]: {
            '@version': V, name: 'mrn', sequenceNumber: '0', enabled: true, variable: 'mrn',
            mapping: "msg['PID']['PID.3']['PID.3.1'].toString()", defaultValue: '',
            replacements: { [PAIR]: pair("'^MRN-'", "''") }, scope: 'CHANNEL'
        },
        [`${P}.javascriptstep.JavaScriptStep`]: {
            '@version': V, name: 'Build full id', sequenceNumber: '1', enabled: true,
            script: "channelMap.put('full', $c('mrn') + '-X');"
        },
        [`${P}.messagebuilder.MessageBuilderStep`]: {
            '@version': V, name: 'PID.3.1', sequenceNumber: '2', enabled: true,
            messageSegment: "tmp['PID']['PID.3']['PID.3.1']", mapping: "$c('full')", defaultValue: '', replacements: null
        }
    };
    return ch;
}

async function open(page: any, id: string, fixture = channel(id), tree: any = TREE_XML, rowCount = 3) {
    await mockEngine(page, {
        [`GET /channels/${id}`]: { channel: fixture },
        'POST /datatypes/_serialize': typeof tree === 'function' ? tree : { format: 'xml', data: tree, meta: { descriptions: { 'PID.3': 'Patient ID List', 'PID.3.1': 'ID Number' } } }
    });
    const puts: any[] = [];
    let remote = fixture;
    await page.route((url: URL) => url.pathname === `/api/channels/${id}`, async (route: any) => {
        const req = route.request();
        if (req.method() === 'GET') return route.fulfill({ json: { channel: remote } });
        if (req.method() === 'PUT') { const saved = JSON.parse(req.postData()).channel; puts.push(saved); remote = { ...saved, revision: Number(saved.revision || 0) + 1 }; return route.fulfill({ status: 200, contentType: 'text/plain', body: 'true' }); }
        return route.fallback();
    });
    await page.goto(`/channels/${id}/edit`);
    await page.getByRole('tab', { name: 'Source', exact: true }).click();
    await page.getByRole('button', { name: /^Edit Transformer/ }).click();
    await expect(page.locator('.element-list-pane table.dt > tbody > tr')).toHaveCount(rowCount);
    return puts;
}

const filterTree = (page: any, text: string) => page.getByRole('textbox', { name: 'Filter fields' }).fill(text);

const savedSteps = (ch: any) => {
    const els = ch.sourceConnector.transformer.elements;
    return Object.entries(els).flatMap(([cls, list]: any) => (Array.isArray(list) ? list : [list]).map((el: any) => ({ cls, ...el })))
        .sort((a: any, b: any) => Number(a.sequenceNumber) - Number(b.sequenceNumber));
};

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.clear(); } catch { /* ignore */ } });
});

test('guided Mapper editor reads engine replacements and writes every mode back', async ({ page }) => {
    const puts = await open(page, 'mapper-guided');
    await page.locator('.element-list-pane table.dt > tbody > tr').first().locator('td.num').click();
    const editor = page.locator('.map-editor');
    await expect(editor).toBeVisible();

    // Loaded as a message field, with the tree's descriptions on the path.
    await expect(editor.getByLabel('Value type')).toHaveValue('field');
    expect(await editor.locator('.map-more-options').evaluate((el: HTMLDetailsElement) => el.open)).toBe(false);
    await page.screenshot({ path: test.info().outputPath('compact-default.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: test.info().outputPath('compact-narrow.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(editor.locator('.map-more-options summary').first()).toContainText('1 replacement');
    await editor.locator('.map-more-options > summary').click();
    await expect(editor.getByRole('button', { name: 'Browse inbound fields' })).toContainText('PID.3.1 (Patient ID List)');
    // Engine-shaped replacement shows in the table.
    await expect(editor.getByLabel('Regular expression 1')).toHaveValue("'^MRN-'");

    // Browse picks a field from the tree.
    await editor.getByRole('button', { name: 'Browse inbound fields' }).click();
    await editor.locator('.map-picker').getByLabel('Filter fields').fill('GENHOSP');
    await editor.locator('.map-picker').locator('tbody tr').last().click();
    await expect(editor.getByLabel('Message field')).toHaveValue("msg['MSH']['MSH.4']['MSH.4.1'].toString()");

    // Variable name drives the step name (Swing); the scope card writes scope.
    await editor.getByLabel('Variable', { exact: true }).fill('facility');
    await editor.getByLabel('Add to').selectOption('CONNECTOR');

    // Text mode quotes the value; Variable mode writes a map read.
    await editor.getByLabel('Value type').selectOption('text');
    await editor.getByLabel('Text value').fill("it's");
    await editor.getByLabel('Value type').selectOption('js');
    await expect(editor.getByLabel('JavaScript value')).toHaveValue("'it\\'s'");
    await editor.getByLabel('Value type').selectOption('variable');
    await editor.getByLabel('Variable name').fill('full');
    await expect(editor).toContainText('Set by step 2');
    await editor.getByLabel('Value type').selectOption('js');
    await expect(editor.getByLabel('JavaScript value')).toHaveValue("$c('full')");
    // Switching back restores the earlier text draft.
    await editor.getByLabel('Value type').selectOption('text');
    await expect(editor.getByLabel('Text value')).toHaveValue("it's");

    // Add a replacement; a blank regular expression row is not saved (Swing).
    await editor.getByRole('button', { name: 'New' }).click();
    await editor.getByRole('button', { name: 'New' }).click();
    await editor.getByLabel('Regular expression 2').fill("'s'");
    await editor.getByLabel('Replace with 2').fill("''");
    await editor.getByLabel('Regular expression 3').fill('');
    await page.screenshot({ path: test.info().outputPath('guided-mapper.png'), fullPage: true });

    await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
    await expect.poll(() => puts.length).toBe(1);
    const [mapper] = savedSteps(puts[0]);
    expect(mapper).toMatchObject({ name: 'facility', variable: 'facility', scope: 'CONNECTOR', mapping: "'it\\'s'" });
    expect(mapper.replacements).toEqual({ [PAIR]: [pair("'^MRN-'", "''"), pair("'s'", "''")] });
});

test('mapping table keeps Mapper -> JavaScript -> Message Builder order, inserts in place, and guards moves', async ({ page }) => {
    const puts = await open(page, 'mapper-table');
    await page.getByRole('radio', { name: 'Mapping table' }).click();
    const rows = page.locator('table.map-table tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Mapper');
    await expect(page.locator('table.map-table').getByRole('columnheader')).toHaveText(['', '', '#', 'Name', 'Type', 'From', 'To', 'Default']);
    await expect(rows.nth(0)).toContainText('msg › PID.3.1');
    await expect(rows.nth(0)).toContainText('Patient ID List');
    await expect(rows.nth(0)).toContainText('mrn');
    await expect(rows.nth(1)).toContainText('Build full id');
    await expect(rows.nth(1)).not.toContainText('channelMap');
    await expect(rows.nth(2)).toContainText('tmp › PID.3.1');
    await expect(page.locator('table.map-table .tag.amber')).toHaveCount(0);

    // Insert a Mapper after the JavaScript step; the Option A editor edits it.
    await rows.nth(1).locator('td.num').click();
    await page.getByRole('button', { name: 'Add step', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Mapper', exact: true }).click();
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(2)).toHaveClass(/selected/);
    const editor = page.locator('.map-editor');
    await editor.getByLabel('Variable', { exact: true }).fill('lastName');
    await editor.locator('.map-raw-path > summary').click();
    await editor.getByLabel('Message field').fill("msg['PID']['PID.5']['PID.5.1'].toString()");
    await expect(rows.nth(2)).toContainText('lastName');

    // Dragging the Message Builder above the JavaScript step that sets `full` asks first.
    await rows.nth(3).locator('.mt-handle').dragTo(rows.nth(1), { targetPosition: { x: 40, y: 2 } });
    const dialog = page.locator('.modal', { hasText: 'Move Step' });
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('mapping-table-move.png'), fullPage: true });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(rows.nth(3)).toContainText('tmp › PID.3.1');

    // A safe move goes through without asking: the new Mapper above the JavaScript step.
    await rows.nth(2).locator('.mt-handle').dragTo(rows.nth(1), { targetPosition: { x: 40, y: 2 } });
    await expect(rows.nth(1)).toContainText('lastName');
    await expect(page.locator('.modal', { hasText: 'Move Step' })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('mapping-table.png'), fullPage: true });

    await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
    await expect.poll(() => puts.length).toBe(1);
    const steps = savedSteps(puts[0]);
    expect(steps.map((s: any) => [s.sequenceNumber, s.cls.split('.').pop(), s.variable || s.name])).toEqual([
        ['0', 'MapperStep', 'mrn'], ['1', 'MapperStep', 'lastName'], ['2', 'JavaScriptStep', 'Build full id'], ['3', 'MessageBuilderStep', 'PID.3.1']
    ]);
});

const ITERATOR = 'com.mirth.connect.model.IteratorStep';
const BUILDER = `${P}.messagebuilder.MessageBuilderStep`;
const OBX_XML = '<HL7Message><OBX><OBX.5><OBX.5.1>98</OBX.5.1></OBX.5></OBX>'
    + '<OBX><OBX.5><OBX.5.1>97</OBX.5.1></OBX.5></OBX>'
    + '<OBX><OBX.5><OBX.5.1>96</OBX.5.1></OBX.5></OBX></HL7Message>';
function iteratorChannel(id: string) {
    const ch = channel(id);
    const tx = ch.sourceConnector.transformer;
    tx.inboundTemplate = tx.outboundTemplate = 'OBX|1|NM|||98\rOBX|2|NM|||97\rOBX|3|NM|||96';
    tx.elements[BUILDER] = { ...tx.elements[BUILDER], name: 'Observation',
        messageSegment: "tmp['OBX'][0]['OBX.5']['OBX.5.1']", mapping: "msg['OBX'][0]['OBX.5']['OBX.5.1'].toString()" };
    tx.elements[ITERATOR] = { '@version': V, name: 'For each OBX', enabled: true, sequenceNumber: '3',
        properties: { target: "msg['OBX']", indexVariable: 'i', prefixSubstitutions: { string: ["msg['OBX']", "tmp['OBX']"] }, children: '' } };
    return ch;
}

test('list view rows reorder by their handle', async ({ page }) => {
    const puts = await open(page, 'list-reorder');
    const rows = page.locator('.element-list-pane table.dt > tbody > tr');
    await rows.nth(0).locator('.mt-handle').dragTo(rows.nth(1), { targetPosition: { x: 40, y: 30 } });
    await page.getByRole('button', { name: 'Move Anyway', exact: true }).click();
    await expect(rows.nth(0).locator('input.grid-name')).toHaveValue('Build full id');
    await expect(rows.nth(1).locator('input.grid-name')).toHaveValue('mrn');
    await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
    await expect.poll(() => puts.length).toBe(1);
    expect(savedSteps(puts[0]).map((s: any) => s.name)).toEqual(['Build full id', 'mrn', 'PID.3.1']);
});

test('the step form names maps in words and has no sample preview', async ({ page }) => {
    await open(page, 'map-labels');
    await page.locator('.element-list-pane table.dt > tbody > tr').first().locator('td.num').click();
    const editor = page.locator('.map-editor');
    await editor.getByLabel('Value type').selectOption('variable');
    await expect(editor.getByLabel('Map', { exact: true }).locator('option')).toHaveText(['Channel', 'Connector', 'Global Channel', 'Global', 'Response', 'Source', 'Configuration', 'Any map']);
    await expect(editor).not.toContainText('Sample result');
    await expect(editor).not.toContainText('Sample details');
    await expect(editor).not.toContainText('Saved expressions');
    await expect(editor.getByLabel('Default Value')).toBeVisible();
});

test('the field picker is the Message Trees table', async ({ page }) => {
    await open(page, 'map-picker-table');
    await page.locator('.element-list-pane table.dt > tbody > tr').first().locator('td.num').click();
    const picker = page.locator('.map-picker');
    await page.locator('.map-editor').getByRole('button', { name: 'Browse inbound fields' }).click();
    await expect(picker.getByRole('columnheader')).toHaveText([/Field/, /Name/, /Sample value/]);
    // The current field opens to its row; other segments stay collapsed.
    await expect(picker.getByRole('row').filter({ hasText: 'PID.3' })).toHaveClass(/selected/);
    await expect(picker.getByText('GENHOSP', { exact: true })).toHaveCount(0);
    await picker.getByRole('row').filter({ hasText: 'MSH' }).locator('.twisty').click();
    await expect(picker).toBeVisible();
    await picker.getByRole('row').filter({ hasText: 'GENHOSP' }).click();
    await expect(page.locator('.map-editor').getByLabel('Message field')).toHaveValue("msg['MSH']['MSH.4']['MSH.4.1'].toString()");
});

test('dropping a tree row on a Browse field replaces its folded path', async ({ page }) => {
    await open(page, 'map-drop');
    await page.locator('.element-list-pane table.dt > tbody > tr').nth(2).locator('td.num').click();
    const editor = page.locator('.map-editor');
    await page.getByRole('tab', { name: 'Message Trees', exact: true }).click();
    const tree = page.getByRole('region', { name: 'Inbound message tree (msg)' });
    await tree.getByRole('button', { name: 'Expand all' }).click();
    await tree.getByRole('row').filter({ hasText: 'MSH.4' }).first().dragTo(editor.getByRole('button', { name: 'Browse target fields' }));
    await expect(editor.getByLabel('Message Segment')).toHaveValue("msg['MSH']['MSH.4']['MSH.4.1']");
});

test('iterator settings edits leave a child fixed index alone', async ({ page }) => {
    const mapping = "msg['OBX'][0]['OBX.5']['OBX.5.1'].toString()";
    const fixture = iteratorChannel('iterator-fixed');
    fixture.sourceConnector.transformer.elements = { [ITERATOR]: { ...fixture.sourceConnector.transformer.elements[ITERATOR], sequenceNumber: '0',
        properties: { target: "msg['OBX']", indexVariable: 'i', prefixSubstitutions: { string: "msg['OBX']" }, children: {
            [`${P}.mapper.MapperStep`]: { '@version': V, name: 'first', sequenceNumber: '0', enabled: true, variable: 'first', mapping, defaultValue: '', replacements: '', scope: 'CHANNEL' }
        } } } };
    const puts = await open(page, 'iterator-fixed', fixture, OBX_XML, 2);
    await page.locator('.element-list-pane table.dt > tbody > tr').first().locator('td.num').click();
    const field = (label: string) => page.locator('.step-editor-fill .field').filter({ hasText: label }).locator('input');
    await field('Iterate On').press('End');
    await field('Iterate On').pressSequentially('x');
    await field('Iterate On').press('Backspace');
    await field('Index Variable').fill('k');
    await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
    await expect.poll(() => puts.length).toBe(1);
    const loop = savedSteps(puts[0]).find((s: any) => s.cls === ITERATOR);
    expect(loop.properties.children[`${P}.mapper.MapperStep`][0].mapping).toBe(mapping);
});

test('iterator membership drives builder paths and samples without saving preview indices', async ({ page }) => {
    const puts = await open(page, 'iterator-context', iteratorChannel('iterator-context'), OBX_XML, 4);
    const rows = page.locator('.element-list-pane table.dt > tbody > tr');
    await rows.nth(2).locator('td.num').click();
    await page.getByRole('button', { name: 'Assign To Iterator', exact: true }).click();
    const editor = page.locator('.map-editor');
    await expect(editor.getByLabel('Iterator context')).toContainText('For each OBX');
    await expect(editor.getByLabel('Value type')).toHaveValue('field');
    await expect(editor.getByLabel('Message field')).toHaveValue("msg['OBX'][i]['OBX.5']['OBX.5.1'].toString()");
    await expect(editor.getByLabel('Message Segment')).toHaveValue("tmp['OBX'][i]['OBX.5']['OBX.5.1']");
    await editor.getByLabel('Sample for For each OBX').selectOption('1');
    await editor.getByRole('button', { name: 'Browse inbound fields' }).click();
    await editor.locator('.map-picker').getByLabel('Filter fields').fill('97');
    await editor.locator('.map-picker').locator('tbody tr').last().click();
    await expect(editor.getByLabel('Message field')).toHaveValue("msg['OBX'][i]['OBX.5']['OBX.5.1'].toString()");
    await page.screenshot({ path: test.info().outputPath('iterator-context.png'), fullPage: true });
    await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
    await expect.poll(() => puts.length).toBe(1);
    const loop = savedSteps(puts[0]).find((s: any) => s.cls === ITERATOR);
    expect(loop.properties.indexVariable).toBe('i');
    const childWire = loop.properties.children[BUILDER];
    const child = Array.isArray(childWire) ? childWire[0] : childWire;
    expect(child.mapping).toContain("['OBX'][i]");
    expect(child.messageSegment).toContain("['OBX'][i]");
    expect(child).not.toHaveProperty('iteratorIndices');

    // Changing the actual parent index updates child paths; the sample selector
    // is unrelated to that saved index-variable setting.
    await rows.nth(2).locator('td.num').click();
    await page.locator('.step-editor-fill .field').filter({ hasText: 'Index Variable' }).locator('input').fill('k');
    await rows.nth(3).locator('td.num').click();
    await expect(editor.getByLabel('Message field')).toHaveValue("msg['OBX'][k]['OBX.5']['OBX.5.1'].toString()");
    await page.getByRole('button', { name: 'Remove From Iterator', exact: true }).click();
    await expect(editor.getByLabel('Iterator context')).toHaveCount(0);
    await expect(editor.getByLabel('Message field')).toHaveValue("msg['OBX']['OBX.5']['OBX.5.1'].toString()");
    await expect(editor.getByLabel('Message Segment')).toHaveValue("tmp['OBX']['OBX.5']['OBX.5.1']");
});

test('iterator prefixes do not index unrelated outbound fields, and scope changes persist', async ({ page }) => {
    const fixture = iteratorChannel('iterator-prefixes');
    fixture.sourceConnector.transformer.elements[ITERATOR].properties.prefixSubstitutions = { string: "msg['OBX']" };
    await open(page, 'iterator-prefixes', fixture, OBX_XML, 4);
    const rows = page.locator('.element-list-pane table.dt > tbody > tr');
    await rows.nth(2).locator('td.num').click();
    await page.getByRole('button', { name: 'Assign To Iterator', exact: true }).click();
    const editor = page.locator('.map-editor');
    await expect(editor.getByLabel('Message field')).toHaveValue("msg['OBX'][i]['OBX.5']['OBX.5.1'].toString()");
    await expect(editor.getByLabel('Message Segment')).toHaveValue("tmp['OBX'][0]['OBX.5']['OBX.5.1']");
    await editor.getByRole('button', { name: 'Browse target fields' }).click();
    await editor.locator('.map-picker').getByRole('radio', { name: 'Outbound' }).click();
    await editor.locator('.map-picker').getByLabel('Filter fields').fill('OBX.5');
    await editor.locator('.map-picker').locator('tbody tr').filter({ hasText: '97' }).click();
    await expect(editor.getByLabel('Message Segment')).toHaveValue("tmp['OBX'][1]['OBX.5']['OBX.5.1']");
    await page.getByRole('radio', { name: 'Mapping table' }).click();
});

test('opening compact controls and changing only the iterator sample does not dirty the channel', async ({ page }) => {
    const fixture = iteratorChannel('iterator-readonly-state');
    const elements = fixture.sourceConnector.transformer.elements;
    elements[ITERATOR].properties.children = { [BUILDER]: { ...elements[BUILDER], sequenceNumber: '0',
        mapping: "msg['OBX'][i]['OBX.5']['OBX.5.1'].toString()", messageSegment: "tmp['OBX'][i]['OBX.5']['OBX.5.1']" } };
    delete elements[BUILDER];
    await open(page, 'iterator-readonly-state', fixture, OBX_XML, 4);
    await page.locator('.element-list-pane table.dt > tbody > tr').last().locator('td.num').click();
    const editor = page.locator('.map-editor');
    await editor.locator('.map-more-options > summary').click();
    await editor.getByLabel('Sample for For each OBX').selectOption('2');
    expect(await page.evaluate(async () => (await import(String('/core/store.js'))).getState('editingChannelDirty'))).toBeFalsy();
    await page.screenshot({ path: test.info().outputPath('compact-options.png'), fullPage: true });
});

test('nested iterators reset inner samples when the outer repetition changes', async ({ page }) => {
    const fixture = channel('iterator-nested');
    fixture.sourceConnector.transformer.inboundTemplate = 'nested sample';
    fixture.sourceConnector.transformer.outboundTemplate = 'nested sample';
    const child = { ...fixture.sourceConnector.transformer.elements[BUILDER], sequenceNumber: '0',
        mapping: "msg['ORDER'][i]['OBX'][j]['OBX.5']['OBX.5.1'].toString()",
        messageSegment: "tmp['ORDER'][i]['OBX'][j]['OBX.5']['OBX.5.1']" };
    fixture.sourceConnector.transformer.elements = { [ITERATOR]: { '@version': V, name: 'Orders', enabled: true, sequenceNumber: '0', properties: {
        target: "msg['ORDER']", indexVariable: 'i', prefixSubstitutions: { string: ["msg['ORDER']", "tmp['ORDER']"] },
        children: { [ITERATOR]: { '@version': V, name: 'Observations', enabled: true, sequenceNumber: '0', properties: {
            target: "msg['ORDER'][i]['OBX']", indexVariable: 'j', prefixSubstitutions: { string: ["msg['ORDER'][i]['OBX']", "tmp['ORDER'][i]['OBX']"] },
            children: { [BUILDER]: child }
        } } }
    } } };
    const xml = '<HL7Message><ORDER><OBX><OBX.5><OBX.5.1>98</OBX.5.1></OBX.5></OBX><OBX><OBX.5><OBX.5.1>97</OBX.5.1></OBX.5></OBX></ORDER>'
        + '<ORDER><OBX><OBX.5><OBX.5.1>96</OBX.5.1></OBX.5></OBX></ORDER></HL7Message>';
    await open(page, 'iterator-nested', fixture, xml, 3);
    await page.locator('.element-list-pane table.dt > tbody > tr').last().locator('td.num').click();
    const editor = page.locator('.map-editor');
    await expect(editor.getByLabel('Sample for Orders')).toHaveValue('0');
    await editor.getByLabel('Sample for Observations').selectOption('1');
    await editor.getByLabel('Sample for Orders').selectOption('1');
    await expect(editor.getByLabel('Sample for Observations')).toHaveValue('0');
    await expect(editor.getByLabel('Sample for Observations').locator('option')).toHaveCount(1);
    await editor.getByRole('button', { name: 'Browse inbound fields' }).click();
    await editor.locator('.map-picker').getByLabel('Filter fields').fill('96');
    await editor.locator('.map-picker').locator('tbody tr').last().click();
    await expect(editor.getByLabel('Message field')).toHaveValue("msg['ORDER'][i]['OBX'][j]['OBX.5']['OBX.5.1'].toString()");
    await page.screenshot({ path: test.info().outputPath('nested-iterator.png'), fullPage: true });
});

test('an unavailable template can be retried without evaluating runtime JavaScript', async ({ page }) => {
    let unavailable = true;
    await open(page, 'iterator-preview-retry', channel('iterator-preview-retry'), () => unavailable
        ? { __status: 503 } : { format: 'xml', data: TREE_XML });
    const editor = page.locator('.map-editor');
    unavailable = false;
    await editor.getByRole('button', { name: 'Browse inbound fields' }).click();
    await editor.getByRole('button', { name: 'Retry fields' }).click();
    await editor.locator('.map-picker').getByLabel('Filter fields').fill('GENHOSP');
    await expect(editor.locator('.map-picker').locator('tbody tr').last()).toContainText('GENHOSP');
    await page.keyboard.press('Escape');
    await editor.getByLabel('Value type').selectOption('js');
    await editor.getByLabel('JavaScript value').fill("(() => { window.__unexpectedPreviewExecution = true; return 'wrong'; })()");
    expect(await page.evaluate(() => (window as any).__unexpectedPreviewExecution)).toBeUndefined();
});

test('editing a template refreshes the selected mapping sample and picker', async ({ page }) => {
    await open(page, 'mapping-template-refresh', channel('mapping-template-refresh'), (request: any) => ({
        format: 'xml', data: request.postData().includes('UPDATED') ? TREE_XML.replace('MRN-448812', 'MRN-UPDATED') : TREE_XML
    }));
    const editor = page.locator('.map-editor');
    await page.getByRole('tab', { name: 'Message Templates', exact: true }).click();
    await expect(page.getByRole('tabpanel', { name: 'Message Templates' }).locator('.ce-monaco')).toHaveCount(2);
    await page.evaluate(() => {
        const monaco = (window as any).monaco;
        const inbound = monaco.editor.getEditors().find((e: any) => e.getOption(monaco.editor.EditorOption.ariaLabel) === 'Inbound Template');
        inbound.setValue('MSH|^~\\&|APP|GENHOSP\rPID|1||MRN-UPDATED||DOE^JANE');
    });
    await editor.getByRole('button', { name: 'Browse inbound fields' }).click();
    await editor.locator('.map-picker').getByLabel('Filter fields').fill('UPDATED');
    await expect(editor.locator('.map-picker').locator('tbody tr').last()).toContainText('MRN-UPDATED');
    await page.evaluate(() => {
        const monaco = (window as any).monaco;
        monaco.editor.getEditors().find((e: any) => e.getOption(monaco.editor.EditorOption.ariaLabel) === 'Inbound Template').setValue('');
    });
});

for (const choice of ['Append', 'Replace']) {
    test(`${choice} transformer import preserves fixed, numeric and symbolic builder targets`, async ({ page }) => {
        const puts = await open(page, `iterator-import-${choice}`);
        const imported = iteratorChannel('imported').sourceConnector.transformer;
        const targets = ["tmp['OBX']['OBX.5']", "tmp['OBX'][0]['OBX.5']", "tmp['OBX'][i]['OBX.5']"];
        const children = targets.map((messageSegment, sequenceNumber) => ({
            ...imported.elements[BUILDER], name: `Imported ${sequenceNumber}`, sequenceNumber, messageSegment,
            mapping: "msg['OBX'][i]['OBX.5']['OBX.5.1'].toString()"
        }));
        imported.elements = { [ITERATOR]: {
            ...imported.elements[ITERATOR], sequenceNumber: 0,
            properties: { ...imported.elements[ITERATOR].properties, children: { [BUILDER]: children } }
        } };
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Import Transformer', exact: true }).click();
        await (await chooser).setFiles({ name: 'iterator.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ transformer: imported })) });
        await page.getByRole('button', { name: choice, exact: true }).click();
        await expect(page.locator('.element-list-pane table.dt > tbody > tr')).toHaveCount(choice === 'Append' ? 7 : 4);
        await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
        await expect.poll(() => puts.length).toBe(1);
        const loop = savedSteps(puts[0]).find((s: any) => s.cls === ITERATOR);
        expect(loop.properties.children[BUILDER].map((s: any) => s.messageSegment)).toEqual(targets);
        expect(loop.properties.children[BUILDER].map((s: any) => s.mapping)).toEqual(children.map((s: any) => s.mapping));
    });
}

test('builder target picker supports msg and tmp without rewriting a target when browsing', async ({ page }) => {
    const fixture = channel('builder-target-messages');
    fixture.sourceConnector.transformer.elements[BUILDER].messageSegment = "msg['PID']['PID.3']['PID.3.1']";
    const puts = await open(page, fixture.id, fixture);
    await page.locator('.element-list-pane table.dt > tbody > tr').last().locator('td.num').click();
    const editor = page.locator('.map-editor');
    await editor.getByRole('button', { name: 'Browse target fields' }).click();
    const picker = editor.locator('.map-picker');
    await expect(picker.getByRole('radio', { name: 'Inbound' })).toBeChecked();
    await picker.getByRole('radio', { name: 'Outbound' }).click();
    await page.keyboard.press('Escape');
    await expect(editor.getByLabel('Message Segment')).toHaveValue("msg['PID']['PID.3']['PID.3.1']");
    expect(await page.evaluate(async () => (await import(String('/core/store.js'))).getState('editingChannelDirty'))).toBeFalsy();
    await editor.getByRole('button', { name: 'Browse target fields' }).click();
    await picker.getByRole('radio', { name: 'Outbound' }).click();
    await picker.getByLabel('Filter fields').fill('GENHOSP');
    await picker.locator('tbody tr').last().click();
    await expect(editor.getByLabel('Message Segment')).toHaveValue("tmp['MSH']['MSH.4']['MSH.4.1']");
    await editor.getByRole('button', { name: 'Browse target fields' }).click();
    await picker.getByRole('radio', { name: 'Inbound' }).click();
    await picker.getByLabel('Filter fields').fill('GENHOSP');
    await expect(picker.locator('tbody tr').last()).toContainText('GENHOSP');
    await page.screenshot({ path: test.info().outputPath('builder-target-picker.png'), fullPage: true });
    await picker.locator('tbody tr').last().click();
    await expect(editor.getByLabel('Message Segment')).toHaveValue("msg['MSH']['MSH.4']['MSH.4.1']");
    await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
    await expect.poll(() => puts.length).toBe(1);
    expect(savedSteps(puts[0]).find((s: any) => s.cls === BUILDER).messageSegment).toBe("msg['MSH']['MSH.4']['MSH.4.1']");
});

test('replacing templates refreshes an already open Message Trees panel', async ({ page }) => {
    const fixture = channel('template-tree-refresh');
    await open(page, fixture.id, fixture, (request: any) => ({
        format: 'xml', data: request.postData().includes('UPDATED') ? TREE_XML.replace('MRN-448812', 'MRN-UPDATED') : TREE_XML
    }));
    await page.getByRole('tab', { name: 'Message Trees', exact: true }).click();
    const panel = page.getByRole('tabpanel', { name: 'Message Trees', exact: true });
    await filterTree(page, 'MRN-');
    await expect(panel.getByText('MRN-448812', { exact: true }).first()).toBeAttached();
    const imported = structuredClone(fixture.sourceConnector.transformer);
    imported.inboundTemplate = 'MSH|^~\\&|APP|GENHOSP\rPID|1||MRN-UPDATED||DOE^JANE';
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Transformer', exact: true }).click();
    await (await chooser).setFiles({ name: 'updated.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ transformer: imported })) });
    await page.getByRole('button', { name: 'Replace', exact: true }).click();
    await expect(panel.getByText('MRN-UPDATED', { exact: true })).toBeAttached();
});

test('adding, editing and clearing templates refreshes both Builder target trees', async ({ page }) => {
    const fixture = channel('builder-empty-template-refresh');
    fixture.sourceConnector.transformer.inboundTemplate = fixture.sourceConnector.transformer.outboundTemplate = '';
    await open(page, fixture.id, fixture, (request: any) => ({
        format: 'xml', data: TREE_XML.replace('MRN-448812', request.postData())
    }));
    await page.locator('.element-list-pane table.dt > tbody > tr').last().locator('td.num').click();
    const editor = page.locator('.map-editor');
    await editor.getByRole('button', { name: 'Browse target fields' }).click();
    await expect(editor.locator('.map-picker')).toContainText('Template unavailable');
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'Message Templates', exact: true }).click();
    await expect(page.getByRole('tabpanel', { name: 'Message Templates' }).locator('.ce-monaco')).toHaveCount(2);
    const setTemplate = async (side: string, value: string) => page.evaluate(({ side, value }) => {
        const monaco = (window as any).monaco;
        monaco.editor.getEditors().find((e: any) => e.getOption(monaco.editor.EditorOption.ariaLabel) === `${side} Template`).setValue(value);
    }, { side, value });
    await setTemplate('Inbound', 'IN-NEW');
    await setTemplate('Outbound', 'OUT-NEW');
    for (const [side, value] of [['inbound', 'IN-NEW'], ['outbound', 'OUT-NEW']]) {
        await editor.getByRole('button', { name: 'Browse target fields' }).click();
        const picker = editor.locator('.map-picker');
        await picker.getByRole('radio', { name: side === 'inbound' ? 'Inbound' : 'Outbound' }).click();
        await picker.getByLabel('Filter fields').fill(value);
        await expect(picker.locator('tbody tr').last()).toContainText(value);
        await page.keyboard.press('Escape');
    }
    await setTemplate('Outbound', 'OUT-EDITED');
    await editor.getByRole('button', { name: 'Browse target fields' }).click();
    await editor.locator('.map-picker').getByRole('radio', { name: 'Outbound' }).click();
    await editor.locator('.map-picker').getByLabel('Filter fields').fill('OUT-EDITED');
    await expect(editor.locator('.map-picker').locator('tbody tr').last()).toContainText('OUT-EDITED');
    await page.keyboard.press('Escape');
    await setTemplate('Outbound', '');
    await editor.getByRole('button', { name: 'Browse target fields' }).click();
    await editor.locator('.map-picker').getByRole('radio', { name: 'Outbound' }).click();
    await expect(editor.locator('.map-picker')).toContainText('Template unavailable');
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'Message Trees', exact: true }).click();
    await filterTree(page, 'IN-NEW');
    await expect(page.getByRole('region', { name: 'Inbound message tree (msg)' }).getByText('IN-NEW', { exact: true })).toBeAttached();
    await page.getByRole('radio', { name: 'Outbound' }).click();
    await expect(page.getByRole('region', { name: 'Outbound message tree (tmp)' })).toContainText('no template');
});

test('late serialization cannot replace the tree from a newer template', async ({ page }) => {
    const fixture = channel('template-serialization-race');
    let releaseOld!: () => void;
    const oldGate = new Promise<void>(resolve => { releaseOld = resolve; });
    let oldStarted = false;
    try {
        await open(page, fixture.id, fixture, async (request: any) => {
            if (request.postData().includes('MRN-448812')) { oldStarted = true; await oldGate; }
            return { format: 'xml', data: request.postData().includes('UPDATED') ? TREE_XML.replace('MRN-448812', 'MRN-UPDATED') : TREE_XML };
        });
        await expect.poll(() => oldStarted).toBe(true);
        await page.getByRole('tab', { name: 'Message Trees', exact: true }).click();
        const imported = structuredClone(fixture.sourceConnector.transformer);
        imported.inboundTemplate = 'UPDATED';
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Import Transformer', exact: true }).click();
        await (await chooser).setFiles({ name: 'updated.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ transformer: imported })) });
        await page.getByRole('button', { name: 'Replace', exact: true }).click();
        const inbound = page.getByRole('region', { name: 'Inbound message tree (msg)' });
        await filterTree(page, 'MRN-');
        await expect(inbound.getByText('MRN-UPDATED', { exact: true })).toBeAttached();
        const oldResponse = page.waitForResponse(response => response.url().includes('/datatypes/_serialize') && !!response.request().postData()?.includes('MRN-448812'));
        releaseOld();
        await (await oldResponse).finished();
        await page.evaluate(() => new Promise(requestAnimationFrame));
        await expect(inbound.getByText('MRN-448812', { exact: true })).toHaveCount(0);
        await expect(inbound.getByText('MRN-UPDATED', { exact: true })).toBeAttached();
    } finally { releaseOld(); }
});

test('field retries recover pickers without a page reload', async ({ page }) => {
    let unavailable = true;
    await open(page, 'field-retry-refresh', channel('field-retry-refresh'), () => unavailable ? { __status: 503 } : { format: 'xml', data: TREE_XML });
    const editor = page.locator('.map-editor');
    await page.getByRole('radio', { name: 'Mapping table' }).click();
    await page.getByRole('tab', { name: 'Message Trees', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retry msg fields' })).toBeVisible();
    unavailable = false;
    await page.getByRole('button', { name: 'Retry msg fields' }).click();
    await filterTree(page, 'MRN-448812');
    await expect(page.getByRole('region', { name: 'Inbound message tree (msg)' }).getByText('MRN-448812', { exact: true })).toBeAttached();
    await editor.getByRole('button', { name: 'Browse inbound fields' }).click();
    await expect(editor.getByRole('button', { name: 'Retry fields' })).toBeVisible();
    await editor.getByRole('button', { name: 'Retry fields' }).click();
    await editor.locator('.map-picker').getByLabel('Filter fields').fill('MRN-448812');
    await expect(editor.locator('.map-picker').locator('tbody tr').last()).toContainText('MRN-448812');
    expect(await page.evaluate(async () => (await import(String('/core/store.js'))).getState('editingChannelDirty'))).toBeFalsy();
});

test('serialization settings refresh the selected sample and the message tree', async ({ page }) => {
    await open(page, 'template-serialization-settings', channel('template-serialization-settings'), (request: any) => ({
        format: 'xml', data: new URL(request.url()).searchParams.get('props')?.includes('useStrictParser=true')
            ? TREE_XML.replace('MRN-448812', 'MRN-STRICT') : TREE_XML
    }));
    const editor = page.locator('.map-editor');
    await page.getByRole('tab', { name: 'Message Templates', exact: true }).click();
    await page.getByRole('tabpanel', { name: 'Message Templates' }).getByRole('button', { name: 'Properties…', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: /Inbound Data Type Properties/ });
    await dialog.getByRole('checkbox', { name: 'Use Strict Parser', exact: true }).first().check();
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    await page.getByRole('tab', { name: 'Message Trees', exact: true }).click();
    await filterTree(page, 'MRN-STRICT');
    await expect(page.getByRole('region', { name: 'Inbound message tree (msg)' }).getByText('MRN-STRICT', { exact: true })).toBeAttached();
});

test('inbound tree can create a Message Builder targeting msg', async ({ page }) => {
    const puts = await open(page, 'builder-from-inbound-tree');
    await page.getByRole('tab', { name: 'Message Trees', exact: true }).click();
    const inbound = page.getByRole('region', { name: 'Inbound message tree (msg)' });
    await filterTree(page, 'GENHOSP');
    await inbound.getByText('GENHOSP', { exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Map to Message', exact: true }).click();
    await expect(page.locator('.map-editor').getByLabel('Message Segment')).toHaveValue("msg['MSH']['MSH.4']['MSH.4.1']");
    await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
    await expect.poll(() => puts.length).toBe(1);
    expect(savedSteps(puts[0]).filter((s: any) => s.cls === BUILDER).map((s: any) => s.messageSegment)).toContain("msg['MSH']['MSH.4']['MSH.4.1']");
});

test('dragging either message tree into a Builder target produces an assignable path', async ({ page }) => {
    await open(page, 'builder-target-drag');
    await page.locator('.element-list-pane table.dt > tbody > tr').last().locator('td.num').click();
    const editor = page.locator('.map-editor');
    await editor.locator('.map-raw-path > summary').first().click();
    const target = editor.getByLabel('Message Segment');
    await page.getByRole('tab', { name: 'Message Trees', exact: true }).click();
    for (const [name, root] of [['Inbound message tree (msg)', 'msg'], ['Outbound message tree (tmp)', 'tmp']]) {
        const region = page.getByRole('region', { name });
        if (root === 'tmp') await page.getByRole('radio', { name: 'Outbound' }).click();
        await filterTree(page, 'GENHOSP');
        await target.fill('');
        await region.getByText('GENHOSP', { exact: true }).dragTo(target);
        await expect(target).toHaveValue(`${root}['MSH']['MSH.4']['MSH.4.1']`);
    }
});

test('JSON primitive sample text stays searchable without claiming a string preview', async ({ page }) => {
    const fixture = channel('json-typed-preview');
    const tx = fixture.sourceConnector.transformer;
    tx.inboundDataType = 'JSON';
    tx.inboundProperties = { '@class': `${P}.datatypes.json.JSONDataTypeProperties`, '@version': V };
    tx.inboundTemplate = JSON.stringify({ nullable: null, score: 123, active: true, text: 'ABC', empty: {} });
    tx.elements[`${P}.mapper.MapperStep`].mapping = "msg['nullable']";
    tx.elements[`${P}.mapper.MapperStep`].defaultValue = "'N/A'";
    tx.elements[`${P}.mapper.MapperStep`].replacements = { [PAIR]: pair("'A'", "'Z'") };
    await open(page, fixture.id, fixture, (request: any) => new URL(request.url()).searchParams.get('dataType') === 'JSON'
        ? { format: 'json', data: tx.inboundTemplate } : { format: 'xml', data: TREE_XML });
    const editor = page.locator('.map-editor');
    await editor.locator('.map-raw-path > summary').click();
    for (const expression of ["msg['score']", "msg['active']", "msg['empty']", "msg['missing']['leaf']", "msg['text'][0]"]) {
        await editor.getByLabel('Message field').fill(expression);
    }
    await editor.getByRole('button', { name: 'Browse inbound fields' }).click();
    await editor.locator('.map-picker').getByLabel('Filter fields').fill('123');
    await expect(editor.locator('.map-picker').locator('tbody tr').last()).toContainText('123');
    await page.keyboard.press('Escape');
    await editor.getByLabel('Message field').fill("msg['text']");
});

test('moving steps asks before exchanging one variable-order warning for another', async ({ page }) => {
    const fixture = channel('mapping-order-exchange');
    const mapper = fixture.sourceConnector.transformer.elements[`${P}.mapper.MapperStep`];
    fixture.sourceConnector.transformer.elements = { [`${P}.mapper.MapperStep`]: [
        { ...mapper, variable: 'c', name: 'c', sequenceNumber: 0, mapping: "$c('a')", replacements: '' },
        { ...mapper, variable: 'b', name: 'b', sequenceNumber: 1, mapping: "'B'", replacements: '' },
        { ...mapper, variable: 'a', name: 'a', sequenceNumber: 2, mapping: "$c('b')", replacements: '' }
    ] };
    await open(page, fixture.id, fixture);
    await page.getByRole('radio', { name: 'Mapping table' }).click();
    const rows = page.locator('.map-table tbody tr');
    await expect(page.locator('.map-table .tag.amber')).toHaveCount(1);
    await rows.last().locator('.mt-handle').dragTo(rows.first(), { targetPosition: { x: 40, y: 2 } });
    const dialog = page.locator('.modal', { hasText: 'Move Step' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(rows.first()).toContainText('c');
    expect(await page.evaluate(async () => (await import(String('/core/store.js'))).getState('editingChannelDirty'))).toBeFalsy();
});
