import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';

const MAPPER = 'com.mirth.connect.plugins.mapper.MapperStep';
const BUILDER = 'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep';

const INBOUND = [
    'MSH|^~\\&|EPIC|GENHOSP|LAB|GENHOSP|20261024101500||ADT^A01|MSG00001|P|2.5.1',
    'EVN|A01|20261024101500',
    'PID|1||448812^^^MRN^MR||DOE^JANE^Q||19800412|F|||123 MAIN ST^^SPRINGFIELD^IL^62701||(217)555-0134',
    'PV1|1|I|4W^401^A',
    'OBX|1|NM|8867-4^Heart rate^LN||72|/min',
    'OBX|2|NM|8480-6^Systolic BP^LN||128|mm[Hg]'
].join('\r');
const OUTBOUND = 'MSH|^~\\&|OUT|FAC\rPID|1||||';

const DESCRIPTIONS = {
    PID: 'Patient Identification', 'PID.1': 'Set ID - PID', 'PID.2': 'Patient ID', 'PID.3': 'Patient Identifier List',
    'PID.5': 'Patient Name', 'PID.5.1': 'Family Name', 'PID.5.2': 'Given Name', 'PID.8': 'Administrative Sex', 'PID.8.1': 'Value'
};

// The engine's ER7Reader shape: an empty element per blank field, and every
// populated field wrapped in components (MSH.1/MSH.2 stay plain text).
function hl7Xml(er7: string) {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const segments = er7.split('\r').filter(Boolean).map(line => {
        const parts = line.split('|');
        const id = parts[0];
        const fields = id === 'MSH' ? ['|', parts[1], ...parts.slice(2)] : parts.slice(1);
        return `<${id}>${fields.map((field, i) => {
            const name = `${id}.${i + 1}`;
            if (id === 'MSH' && i < 2) return `<${name}>${esc(field)}</${name}>`;
            if (!field) return `<${name}/>`;
            return `<${name}>${field.split('^').map((c, j) => (c ? `<${name}.${j + 1}>${esc(c)}</${name}.${j + 1}>` : `<${name}.${j + 1}/>`)).join('')}</${name}>`;
        }).join('')}</${id}>`;
    });
    return `<HL7Message>${segments.join('')}</HL7Message>`;
}

async function openTrees(page: Page, { serialize = hl7Xml, dataType = 'HL7V2', template = INBOUND } = {}) {
    let channel = makeChannel('mtree');
    Object.assign(channel.sourceConnector.transformer, { inboundDataType: dataType, inboundTemplate: template, outboundTemplate: OUTBOUND });
    const writes: any[] = [];
    await mockEngine(page, {
        'GET /channels/mtree': () => ({ channel }),
        'PUT /channels/mtree': (request: any) => { channel = request.postDataJSON().channel; writes.push(channel); return true; }
    });
    await page.route('**/api/webplugins*', route => route.fulfill({ json: [] }));
    await page.route('**/api/datatypes/_serialize*', route => {
        const text = route.request().postData() || '';
        const root = text.startsWith('MSH|^~\\&|EPIC') ? 'ADT-A01 (2.5.1) (Admit/Visit Notification)' : '';
        const descriptions = text.startsWith('MSH|') ? DESCRIPTIONS : {};
        return route.fulfill({ json: { format: 'xml', data: serialize(text), meta: { root, descriptions } } });
    });
    await page.goto('/channels/mtree/transformer/0');
    await page.getByRole('tab', { name: 'Message Trees', exact: true }).click();
    return writes;
}

const tree = (page: Page, varName = 'msg') =>
    page.getByRole('region', { name: `${varName === 'msg' ? 'Inbound' : 'Outbound'} message tree (${varName})` });
const row = (page: Page, field: string, varName = 'msg') =>
    tree(page, varName).getByRole('row').filter({ has: page.getByText(field, { exact: true }) });
const stepField = (page: Page, label: string) => page.locator(`.step-editor-fill .field:has(label:text-is("${label}")) input`);

test('message tree table shows segments, joined values, folded fields and filters', async ({ page }) => {
    await openTrees(page);
    await expect(tree(page)).toContainText('ADT-A01 (2.5.1) (Admit/Visit Notification)');
    await expect(row(page, 'PID')).toContainText('7 of 13 fields');
    await expect(row(page, 'OBX[1]')).toBeVisible();
    // Segments start collapsed, like the Swing tree.
    await expect(row(page, 'PID.1')).toHaveCount(0);

    await row(page, 'PID').locator('.twisty').click();
    await expect(row(page, 'PID.5')).toContainText('Patient Name');
    await expect(row(page, 'PID.5')).toContainText('DOE^JANE^Q');
    // A lone `.1` component folds into its field: one row, the component's value.
    await expect(row(page, 'PID.8')).toContainText('F');
    await expect(row(page, 'PID.8').locator('.twisty')).toHaveText('');
    await expect(row(page, 'PID.2')).toHaveClass(/mt-empty/);

    await page.getByRole('button', { name: 'Hide empty fields' }).click();
    await expect(row(page, 'PID.2')).toHaveCount(0);
    await expect(row(page, 'PID.1')).toBeVisible();
    await page.getByRole('button', { name: 'Hide empty fields' }).click();
    await expect(row(page, 'PID.2')).toBeVisible();

    // A filter expands to every match.
    await page.getByRole('textbox', { name: 'Filter fields' }).fill('family');
    await expect(row(page, 'PID.5.1')).toContainText('DOE');
    await expect(row(page, 'MSH')).toHaveCount(0);
    await expect(row(page, 'PID.1')).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Filter fields' }).fill('');
    await expect(row(page, 'PID.5.1')).toHaveCount(0);
    await expect(row(page, 'MSH')).toBeVisible();

    await tree(page).getByRole('button', { name: 'Expand all' }).click();
    await expect(row(page, 'PID.5.1')).toBeVisible();
    await expect(row(page, 'MSH.9.2')).toContainText('A01');
    await tree(page).getByRole('button', { name: 'Collapse all' }).click();
    await expect(row(page, 'PID.1')).toHaveCount(0);
});

test('message tree rows map, drag and copy their accessors', async ({ page, browserName, context }) => {
    const writes = await openTrees(page);
    await row(page, 'PID').locator('.twisty').click();
    await row(page, 'PID.5').locator('.twisty').click();

    // The ⋯ button opens the row menu from the keyboard too.
    await row(page, 'PID.5.1').click();
    await expect(tree(page)).toContainText("msg['PID']['PID.5']['PID.5.1'].toString()");
    await row(page, 'PID.5.1').getByRole('button', { name: 'Actions for PID.5.1' }).press('Enter');
    await page.getByRole('menuitem', { name: 'Map to Variable' }).click();
    await expect(stepField(page, 'Mapping')).toHaveValue("msg['PID']['PID.5']['PID.5.1'].toString()");

    // Drag a row into a step editor field: the accessor lands at the drop point.
    await row(page, 'PID.8').dragTo(stepField(page, 'Default Value'));
    await expect(stepField(page, 'Default Value')).toHaveValue("msg['PID']['PID.8']['PID.8.1'].toString()");

    if (browserName === 'chromium') {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await tree(page).getByRole('button', { name: 'Copy', exact: true }).click();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("msg['PID']['PID.5']['PID.5.1'].toString()");
    }

    // The outbound tree offers Map to Message only.
    await page.getByRole('radio', { name: 'Outbound' }).click();
    await expect(tree(page)).toBeHidden();
    await row(page, 'PID', 'tmp').locator('.twisty').click();
    await row(page, 'PID.3', 'tmp').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Map to Variable' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Map to Message' }).click();
    await expect(stepField(page, 'Message Segment')).toHaveValue("tmp['PID']['PID.3']");

    await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    const elements = writes[0].sourceConnector.transformer.elements;
    expect(elements[MAPPER][0]).toMatchObject({
        mapping: "msg['PID']['PID.5']['PID.5.1'].toString()",
        defaultValue: "msg['PID']['PID.8']['PID.8.1'].toString()"
    });
    expect(elements[BUILDER][0]).toMatchObject({ messageSegment: "tmp['PID']['PID.3']" });
});

test('message tree rows drop their accessor into a script editor', async ({ page }) => {
    await openTrees(page);
    await page.getByRole('button', { name: 'Add New Step' }).first().click();
    await page.getByRole('dialog', { name: 'Add Step' }).getByText('JavaScript', { exact: true }).click();
    await expect(page.locator('.step-editor-fill .ce-monaco')).toBeVisible();
    await page.getByRole('tab', { name: 'Message Trees', exact: true }).click();
    await row(page, 'PID').locator('.twisty').click();
    await row(page, 'PID.8').dragTo(page.locator('.step-editor-fill .ce-monaco .view-lines'));
    const script = () => page.evaluate(() => {
        const monaco = (window as any).monaco;
        return monaco.editor.getEditors().filter((e: any) => !e.getOption(monaco.editor.EditorOption.readOnly))
            .map((e: any) => e.getValue()).join('\n');
    });
    // Inserted once, at the drop point.
    await expect.poll(async () => (await script()).split("msg['PID']['PID.8']['PID.8.1'].toString()").length).toBe(2);
});

test('strict HL7 component names get no joined value', async ({ page }) => {
    // The strict (HAPI) parser names fields PID.n but components by data type.
    await openTrees(page, { serialize: () => '<ADT_A01><PID><PID.1>1</PID.1><PID.5><XPN.1><FN.1>DOE</FN.1></XPN.1><XPN.2>JANE</XPN.2></PID.5></PID></ADT_A01>' });
    await expect(row(page, 'PID')).toContainText('2 fields');
    await row(page, 'PID').locator('.twisty').click();
    await expect(row(page, 'PID.5')).toContainText('Patient Name');
    await expect(row(page, 'PID.5')).not.toContainText('DOE');
    await row(page, 'PID.5').locator('.twisty').click();
    await row(page, 'XPN.1').locator('.twisty').click();
    await expect(row(page, 'FN.1')).toContainText('DOE');
});

test('a folded field keeps its own name for Map to Variable', async ({ page }) => {
    await openTrees(page);
    await row(page, 'PID').locator('.twisty').click();
    await row(page, 'PID.8').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Map to Variable' }).click();
    // The row's name, not its folded component's ("PID.8.1 (Value)"): the variable is the channel-map key.
    await expect(stepField(page, 'Variable')).toHaveValue('PID.8 (Administrative Sex)');
    await expect(stepField(page, 'Mapping')).toHaveValue("msg['PID']['PID.8']['PID.8.1'].toString()");
});

test('XML text stays visible beside attributes and through Hide empty fields', async ({ page }) => {
    // The XML serializer returns this document unchanged.
    const xml = '<record><name kind="legal">DOE^JANE</name><value code="">nonempty text</value><plain>visible plain</plain></record>';
    await openTrees(page, { dataType: 'XML', template: xml, serialize: () => xml });
    await expect(row(page, 'name')).toContainText('DOE^JANE');
    await expect(row(page, 'name').locator('.mt-joined')).toHaveCount(0);
    await expect(row(page, 'value')).toContainText('nonempty text');
    await row(page, 'name').locator('.twisty').click();
    await expect(row(page, '@kind')).toContainText('legal');
    await row(page, 'value').locator('.twisty').click();
    await expect(row(page, '@code')).toBeVisible();

    await page.getByRole('button', { name: 'Hide empty fields' }).click();
    await expect(row(page, 'value')).toContainText('nonempty text');
    await expect(row(page, '@code')).toHaveCount(0);
    await expect(row(page, '@kind')).toBeVisible();

    await page.getByRole('textbox', { name: 'Filter fields' }).fill('doe^jane');
    await expect(row(page, 'name')).toBeVisible();
    await expect(row(page, 'plain')).toHaveCount(0);
});

test('DICOM tags keep their values beside their metadata attributes', async ({ page }) => {
    // The DICOM serializer's output for a generated file; the template holds this XML.
    const dicom = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<dicom>\n'
        + '    <tag00100010 len="8" tag="00100010" vr="PN">DOE^JANE</tag00100010>\n'
        + '    <tag00100020 len="6" tag="00100020" vr="LO">PR135</tag00100020>\n</dicom>\n';
    await openTrees(page, { dataType: 'DICOM', template: dicom });
    await expect(row(page, 'tag00100010')).toContainText('DOE^JANE');
    await expect(row(page, 'tag00100020')).toContainText('PR135');
    await row(page, 'tag00100010').locator('.twisty').click();
    await expect(row(page, '@vr')).toContainText('PN');
});

test('the Name column can be hidden from the header menu', async ({ page }) => {
    await openTrees(page);
    await tree(page).getByRole('columnheader', { name: 'Name', exact: true }).click({ button: 'right' });
    // Field and Sample value (it holds the row actions) are pinned.
    await expect(page.getByRole('menuitem', { name: /Field|Sample value/ })).toHaveCount(0);
    await page.getByRole('menuitem', { name: /Name/ }).click();
    await expect(tree(page).getByRole('columnheader', { name: 'Name', exact: true })).toHaveCount(0);
    await expect(row(page, 'PID')).toContainText('7 of 13 fields');
});

for (const theme of ['light', 'dark']) {
    test(`message tree passes an accessibility scan in the ${theme} theme`, async ({ page }) => {
        await openTrees(page);
        await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
        await tree(page).getByRole('button', { name: 'Expand all' }).click();
        await expect(row(page, 'PID.5.1')).toBeVisible();
        expect((await new AxeBuilder({ page }).include('.mtree').analyze()).violations).toEqual([]);
    });
}
