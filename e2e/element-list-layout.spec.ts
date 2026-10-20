import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';
import { CASES } from './step-rule-fixtures.js';

for (const width of [1440, 760]) {
    for (const kind of ['transformer', 'filter', 'response']) {
        test(`${kind} list sizes dynamically and resets a manual resize at ${width}px`, async ({ page }) => {
            // This exercises 22 additions, six deletions, resizing and remounting.
            // Shared CI runners need more than the default whole-test budget;
            // individual action and assertion deadlines remain unchanged.
            test.setTimeout(60_000);
            await page.setViewportSize({ width, height: 1000 });
            const id = `layout-${kind}`;
            const channel = makeChannel(id);
            const c = CASES.find(c => c.label === (kind === 'filter' ? 'JavaScript Rule' : 'JavaScript Step'))!;
            const connector = kind === 'response' ? channel.destinationConnectors.connector[0] : channel.sourceConnector;
            connector[kind === 'response' ? 'responseTransformer' : kind].elements = { [c.class]: c.element() };
            await mockEngine(page, {
                [`GET /channels/${id}`]: { channel },
                'POST /javascript/_validate': { error: '' },
            });
            const route = `/channels/${id}/${kind}/${kind === 'response' ? 1 : 0}`;
            await page.goto(route);
            const pane = page.locator('.element-list-pane');
            const rows = pane.locator('tbody tr');
            const height = () => pane.evaluate(el => el.getBoundingClientRect().height);
            await expect(rows).toHaveCount(1);
            const initial = await height();
            expect(initial).toBeCloseTo(128, 0);
            await rows.first().locator('td.num').click();
            if (kind === 'transformer') await page.screenshot({ path: test.info().outputPath('compact-editor.png') });
            const noun = kind === 'filter' ? 'Rule' : 'Step';
            const add = async () => {
                await page.getByRole('button', { name: `Add New ${noun}`, exact: true }).first().click();
                await page.locator('.step-item').filter({ hasText: /^JavaScript$/ }).click();
            };
            for (let i = 0; i < 6; i++) await add();
            await expect(rows).toHaveCount(7);
            await expect.poll(height).toBeGreaterThan(initial);
            const grown = await height();
            // Delete below the cap as well as below the minimum-size threshold.
            for (let i = 0; i < 6; i++) await page.getByRole('button', { name: `Delete ${noun}`, exact: true }).click();
            await expect(rows).toHaveCount(1);
            await expect.poll(height).toBeLessThan(grown);
            expect(await height()).toBeCloseTo(initial, 0);

            // Keep adding until the list scrolls, protecting the lower editor.
            for (let i = 0; i < 15; i++) await add();
            const capped = await height();
            const column = await pane.evaluate(el => el.parentElement!.getBoundingClientRect().height);
            expect(capped).toBeLessThanOrEqual(column * 0.4 + 1);
            expect(await pane.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
            const bottom = page.locator('.step-editor-fill');
            expect((await bottom.boundingBox())!.height).toBeGreaterThan(100);

            const handle = pane.locator('+ .split-handle');
            const box = (await handle.boundingBox())!;
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60, { steps: 5 });
            await page.mouse.up();
            await expect.poll(height).toBeGreaterThan(capped + 50);
            const manual = await height();
            await add();
            expect(await height()).toBeCloseTo(manual, 0);

            // Navigation remounts the editor, keeping steps but discarding sizing.
            await page.getByRole('button', { name: 'Back to Channel', exact: true }).click();
            await expect(page).toHaveURL(new RegExp(`/channels/${id}/edit$`));
            await page.goBack();
            await expect(rows).toHaveCount(17);
            await expect.poll(height).toBeLessThan(manual - 40);
        });
    }

    test(`empty transformer keeps its actions visible at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        const channel = makeChannel('empty-layout');
        await mockEngine(page, { 'GET /channels/empty-layout': { channel } });
        await page.goto('/channels/empty-layout/transformer/0');
        const pane = page.locator('.element-list-pane');
        await expect(pane.getByText('No Steps Configured')).toBeVisible();
        await expect(pane.getByRole('button', { name: 'Add New Step' })).toBeInViewport();
        await expect(pane.getByRole('button', { name: 'Import Transformer' })).toBeInViewport();
        const box = (await pane.boundingBox())!;
        expect(box.height).toBeLessThan(220);
        await pane.getByRole('button', { name: 'Add New Step' }).click();
        await page.locator('.step-item').filter({ hasText: /^JavaScript$/ }).click();
        await expect(pane.locator('tbody tr')).toHaveCount(1);
        await expect.poll(() => pane.evaluate(el => el.getBoundingClientRect().height)).toBeCloseTo(128, 0);
    });
}
