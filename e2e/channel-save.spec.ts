import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';

for (const surface of ['edit', 'guided', 'transformer/0']) {
    test(`F03: ${surface} preserves its original baseline and guarded payload`, async ({ page }) => {
        let channel: any = makeChannel('guard');
        channel.revision = 3;
        const stamp = Date.now() + 86400000;
        channel.exportData = { metadata: { enabled: true, lastModified: { time: stamp, timezone: 'UTC' }, userId: 1 } };
        let reads = 0, writes = 0;
        await mockEngine(page, {
            'GET /channels/guard': () => { reads++; return { channel }; },
            'PUT /channels/guard': (req: any) => {
                writes++;
                expect(new URL(req.url()).searchParams.get('override')).toBe('false');
                const submitted = req.postDataJSON().channel;
                expect(submitted.revision).toBe(5);
                expect(submitted.exportData.metadata.lastModified.time).toBeLessThan(stamp);
                expect(Math.abs(Date.now() - submitted.exportData.metadata.lastModified.time)).toBeLessThan(10_000);
                expect(submitted.exportData.metadata.userId).toBe(1);
                channel = submitted;
                return true;
            },
        });
        await page.goto(`/channels/guard/${surface}`);
        if (surface.startsWith('transformer')) {
            await page.getByRole('button', { name: 'Add New Step', exact: true }).first().click();
            await page.getByRole('dialog').getByText('JavaScript', { exact: true }).click();
        }
        else await page.locator('.view-body input').first().fill('My unsaved name');
        // Another admin changes the channel within the timestamp's same second.
        // Revision and payload preflight must detect it even if its time is unchanged.
        channel = { ...channel, revision: 4, name: 'Concurrent change', exportData: { metadata: { ...channel.exportData.metadata, userId: 2 } } };
        const save = page.getByRole('button', { name: surface.startsWith('transformer') ? 'Save Channel' : 'Save Changes', exact: true });
        await save.click();
        const conflict = page.getByRole('dialog', { name: 'Channel Modified', exact: true });
        await expect(conflict).toBeVisible();
        expect(writes).toBe(0);
        await conflict.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(save).toBeVisible();
        await save.click();
        await conflict.getByRole('button', { name: 'Overwrite', exact: true }).click();
        await expect.poll(() => writes).toBe(1);
        expect(reads).toBeGreaterThanOrEqual(3);
    });
}

test('F03: classic-to-wizard handoff keeps the pre-edit channel baseline', async ({ page }) => {
    let channel: any = makeChannel('handoff-guard');
    channel.revision = 2;
    let writes = 0;
    await mockEngine(page, {
        'GET /channels/handoff-guard': () => ({ channel }),
        'PUT /channels/handoff-guard': () => { writes++; return true; },
    });
    await page.goto('/channels/handoff-guard/edit');
    await page.locator('.view-body input').first().fill('Retain local edit');
    channel = { ...channel, revision: 3, name: 'Changed in Swing' };
    await page.getByRole('button', { name: 'Open in Wizard', exact: true }).click();
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    const conflict = page.getByRole('dialog', { name: 'Channel Modified', exact: true });
    await expect(conflict).toBeVisible();
    expect(writes).toBe(0);
    await conflict.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('.view-body input').first()).toHaveValue('Retain local edit');
});

for (const surface of ['edit', 'guided', 'transformer/0']) {
    test(`F03: ${surface} keeps Swing's same-user overwrite behavior`, async ({ page }) => {
        let channel: any = makeChannel('same-user');
        channel.exportData = { metadata: { enabled: true, lastModified: { time: Date.now(), timezone: 'UTC' }, userId: 1 } };
        let writes = 0;
        await mockEngine(page, {
            'GET /channels/same-user': () => ({ channel }),
            'PUT /channels/same-user': (req: any) => { writes++; channel = req.postDataJSON().channel; return true; },
        });
        await page.goto(`/channels/same-user/${surface}`);
        if (surface.startsWith('transformer')) {
            await page.getByRole('button', { name: 'Add New Step', exact: true }).first().click();
            await page.getByRole('dialog').getByText('JavaScript', { exact: true }).click();
        } else await page.locator('.view-body input').first().fill('My local changes');
        channel = { ...channel, revision: Number(channel.revision) + 1, description: 'Saved by the same user in Swing' };
        await page.getByRole('button', { name: surface.startsWith('transformer') ? 'Save Channel' : 'Save Changes', exact: true }).click();
        await expect.poll(() => writes).toBe(1);
        await expect(page.getByRole('dialog', { name: 'Channel Modified', exact: true })).toHaveCount(0);
    });
}
