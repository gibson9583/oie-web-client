import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';
import { CASES, makeChannel } from './connector-fixtures.js';

/*
 * Regression net for the HTTP Listener "Static Resources" table (an imperative
 * DOM island mounted inside the React ConnectorForm). The bug: each keystroke
 * committed the row, which called onChange → the form repainted → the island was
 * rebuilt → the focused <input> was replaced → focus (and every subsequent
 * keystroke) was lost, so you could only ever type one character per field.
 *
 * The fix commits on blur (the input's `change` event) instead of per keystroke,
 * keeping the row model live via `input` in between. This test types several
 * characters into a Static Resources cell and asserts the input keeps focus and
 * accumulates the whole value — it fails (value === one char) on the old code.
 */
test('HTTP Listener Static Resources cell keeps focus while typing', async ({ page }) => {
    const httpCase = CASES.find((c) => c.name === 'HTTP Listener');
    const id = 'rt-http-static-focus';
    const channel = makeChannel(id, { source: { transportName: httpCase.name, properties: httpCase.properties() } });
    await mockEngine(page, { [`GET /channels/${id}`]: { channel } });

    await page.goto(`/#/channels/${id}/edit`);
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    await expect(page.locator('.cform-section').first()).toBeVisible();

    // The Static Resources table is the panel's last custom field; add a row.
    const table = page.locator('table.dt').filter({ hasText: 'Context Path' });
    await table.locator('xpath=following-sibling::button[normalize-space()="New"]').first().click();

    const contextPath = table.locator('tbody tr').first().locator('input[type="text"]').first();
    await contextPath.click();
    await contextPath.press('ControlOrMeta+a');   // replace the seeded "path1" default
    await contextPath.pressSequentially('myresource');

    // Old code lost focus (and every keystroke after the first) on the first commit;
    // the input would still read "path1" or a single char. The fix keeps both.
    await expect(contextPath).toBeFocused();
    await expect(contextPath).toHaveValue('myresource');
});
