import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { CASES, channelWithSourceElement } from './step-rule-fixtures.js';

/*
 * Per-type serialization safety net for transformer steps and filter rules — the
 * other serialization-heavy half of the channel the connector round-trip tests
 * don't cover. For each step/rule type: load a channel whose source connector
 * holds an element of that type, open the filter/transformer editor, select the
 * element so its editor mounts, edit a field, save, and check the entire element
 * in the serialized channel, including the class key and collection shape.
 *
 * A correct editor renders the loaded element without mutating its other fields,
 * so any dropped/renamed/normalized field fails here before it can break a deploy.
 */

const EDITED = 'RT Edited';

for (const c of CASES) {
    test(`${c.label} (${c.kind}) round-trips its element`, async ({ page }) => {
        const id = `rt-el-${c.label.toLowerCase().replace(/\s+/g, '-')}`;
        const channel = channelWithSourceElement(id, c.kind, c.class, c.element());

        await mockEngine(page, { [`GET /channels/${id}`]: { channel } });

        let putBody: any = null;
        await page.route((url) => url.pathname === `/api/channels/${id}`, async (route) => {
            const req = route.request();
            if (req.method() === 'PUT') { putBody = req.postData(); return route.fulfill({ status: 200, contentType: 'text/plain', body: '' }); }
            return route.fallback();
        });

        await page.goto(`/channels/${id}/edit`);
        await expect(page.getByRole('tab', { name: 'Summary', exact: true })).toBeVisible();

        // Capture the parsed API model: empty collection representation can
        // differ between JSON and XML reads. Compare the editor against its
        // actual input so this remains a no-mutation test.
        const loadedElement = await page.evaluate(async ({ id, kind, className }) => {
            const api = await import(String('/core/api.js'));
            const loaded = await api.channels.get(id);
            const target = kind === 'filter' ? loaded.sourceConnector.filter : loaded.sourceConnector.transformer;
            return [target.elements[className]].flat()[0];
        }, { id, kind: c.kind, className: c.class });

        // Source tab → Edit Transformer / Edit Filter → the filter/transformer view.
        await page.getByRole('tab', { name: 'Source', exact: true }).click();
        const editLabel = c.kind === 'filter' ? /^Edit Filter/ : /^Edit Transformer/;
        await page.getByRole('button', { name: editLabel }).click();

        // Select the element by clicking the # cell (the Name/Type cells stop
        // propagation), which mounts the element's editor.
        const firstRow = page.locator('table.dt tbody tr').first();
        await expect(firstRow).toBeVisible();
        await firstRow.locator('td.num').click();
        await expect(page.locator('.step-editor-fill .panel').first()).toBeVisible();

        const expected = { ...loadedElement, sequenceNumber: '0' };
        const name = firstRow.locator('input.grid-name');
        if (c.class === 'com.mirth.connect.model.IteratorStep' || c.class === 'com.mirth.connect.model.IteratorRule') {
            await expect(name).toHaveJSProperty('readOnly', true);
            await page.getByRole('textbox', { name: 'Index Variable', exact: true }).fill('j');
            expected.properties = { ...loadedElement.properties, indexVariable: 'j', children: '' };
        } else if (c.label === 'Mapper Step') {
            await expect(name).toHaveJSProperty('readOnly', true);
            await page.locator('.step-editor-fill .field:has(label:text-is("Variable")) input').fill('patientName');
            expected.name = expected.variable = 'patientName';
        } else if (c.label === 'Rule Builder Rule' || c.label === 'Destination Set Filter Step') {
            await expect(name).toHaveJSProperty('readOnly', true);
            await page.locator('.step-editor-fill .field:has(label:text-is("Field")) input').fill('msg.PID');
            expected.field = 'msg.PID';
            expected.name = c.kind === 'filter' ? 'Accept message if "msg.PID" exists' : 'Filter destination(s) if "msg.PID" exists';
        } else {
            await name.fill(EDITED);
            expected.name = EDITED;
        }
        await expect(name).toHaveValue(expected.name);
        await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
        await expect.poll(() => putBody, { timeout: 8000 }).not.toBeNull();

        const sent = JSON.parse(putBody).channel;
        const target = c.kind === 'filter' ? sent.sourceConnector.filter : sent.sourceConnector.transformer;
        expect(target.elements).toEqual({ [c.class]: [expected] });
    });
}

// Accessor tokens dropped onto a React-controlled step-editor field must be
// written through the native prototype value setter — a plain `.value =` write
// is reverted by React's change tracker and never reaches the model, so the
// token silently vanishes from both the field and the saved channel.
test('accessor drop into a step editor field survives React control', async ({ page }) => {
    const mapper = CASES.find((c) => c.label === 'Mapper Step');
    const id = 'rt-accessor-drop';
    const element = mapper!.element();
    const channel = channelWithSourceElement(id, 'transformer', mapper!.class, mapper!.element());

    await mockEngine(page, { [`GET /channels/${id}`]: { channel } });
    let putBody: any = null;
    await page.route((url) => url.pathname === `/api/channels/${id}`, async (route) => {
        const req = route.request();
        if (req.method() === 'PUT') { putBody = req.postData(); return route.fulfill({ status: 200, contentType: 'text/plain', body: '' }); }
        return route.fallback();
    });

    await page.goto(`/channels/${id}/edit`);
    await expect(page.getByRole('tab', { name: 'Summary', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Source', exact: true }).click();
    await page.getByRole('button', { name: /^Edit Transformer/ }).click();

    const firstRow = page.locator('table.dt tbody tr').first();
    await firstRow.locator('td.num').click();
    await expect(page.locator('.step-editor-fill .panel').first()).toBeVisible();

    // Drop an accessor token at the end of the Mapper's Variable field, the way
    // makeAccessorDrop receives it from a Reference/Message Trees drag.
    const token = "msg['MSH']['MSH.3']['MSH.3.1'].toString()";
    const variable = page.locator('.step-editor-fill .field:has(label:text-is("Variable")) input');
    await expect(variable).toHaveValue(element.variable);
    await variable.evaluate((el: any, tok: any) => {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
        const dt = new DataTransfer();
        dt.setData('text/plain', tok);
        dt.setData('application/x-oie-accessor', tok);
        el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, token);

    // The field keeps the inserted token (no React revert) …
    const expected = element.variable + token;
    await expect(variable).toHaveValue(expected);

    // … and the token reaches the saved element (the model write fired).
    await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
    await expect.poll(() => putBody, { timeout: 8000 }).not.toBeNull();
    const sent = JSON.parse(putBody).channel;
    expect(sent.sourceConnector.transformer.elements[mapper!.class][0].variable).toBe(expected);
});
