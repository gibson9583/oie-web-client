import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';
import { CASES, channelWithSourceElement } from './step-rule-fixtures.js';

/*
 * Per-type serialization safety net for transformer steps and filter rules — the
 * other serialization-heavy half of the channel the connector round-trip tests
 * don't cover. For each step/rule type: load a channel whose source connector
 * holds an element of that type, open the filter/transformer editor, select the
 * element so ITS editor mounts and reads the element, edit the Name to dirty the
 * channel, Save, and assert the serialized elements deep-equal the expected wire
 * shape (the element array-wrapped under its @class, with the edited name).
 *
 * A correct editor renders the loaded element without mutating its other fields,
 * so any dropped/renamed/normalized field fails here before it can break a deploy.
 */

const EDITED = 'RT Edited';

for (const c of CASES) {
    test(`${c.label} (${c.kind}) round-trips its element`, async ({ page }) => {
        const id = `rt-el-${c.label.toLowerCase().replace(/\s+/g, '-')}`;
        const element = c.element();
        const channel = channelWithSourceElement(id, c.kind, c.class, c.element());

        await mockEngine(page, { [`GET /channels/${id}`]: { channel } });

        let putBody = null;
        await page.route((url) => url.pathname === `/api/channels/${id}`, async (route) => {
            const req = route.request();
            if (req.method() === 'PUT') { putBody = req.postData(); return route.fulfill({ status: 200, contentType: 'text/plain', body: '' }); }
            return route.fallback();
        });

        await page.goto(`/channels/${id}/edit`);
        await expect(page.getByRole('button', { name: 'Summary', exact: true })).toBeVisible();

        // Source tab → Edit Transformer / Edit Filter → the filter/transformer view.
        await page.getByRole('button', { name: 'Source', exact: true }).click();
        const editLabel = c.kind === 'filter' ? /^Edit Filter/ : /^Edit Transformer/;
        await page.getByRole('button', { name: editLabel }).click();

        // Select the element by clicking the # cell (the Name/Type cells stop
        // propagation), which mounts the element's editor.
        const firstRow = page.locator('table.dt tbody tr').first();
        await expect(firstRow).toBeVisible();
        await firstRow.locator('td.num').click();
        await expect(page.locator('.step-editor-fill .panel').first()).toBeVisible();

        // Dirty via the inline Name, then Save the channel.
        await firstRow.locator('input.grid-name').fill(EDITED);
        await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
        await expect.poll(() => putBody, { timeout: 8000 }).not.toBeNull();

        const sent = JSON.parse(putBody).channel;
        const target = c.kind === 'filter' ? sent.sourceConnector.filter : sent.sourceConnector.transformer;
        const expected = { [c.class]: [{ ...element, name: EDITED }] };
        expect(target.elements).toEqual(expected);
    });
}
