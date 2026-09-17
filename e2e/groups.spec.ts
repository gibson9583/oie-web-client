import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

test('F01: failed group reads cannot submit an empty replacement', async ({ page }) => {
    let writes = 0;
    await mockEngine(page, {
        'GET /channelgroups': { __status: 503, body: { message: 'groups unavailable' } },
        'POST /channelgroups/_bulkUpdate': () => { writes++; return true; },
    });
    await page.goto('/channels');
    await page.getByRole('dialog', { name: 'Error', exact: true })
        .getByRole('button', { name: 'Close', exact: true }).last().click();
    await page.getByRole('button', { name: 'New Group', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New Group', exact: true });
    await dialog.locator('input').fill('New group');
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toContainText('groups unavailable');
    expect(writes).toBe(0);
});

test('F01: concurrent additions are preserved and rejected writes never report success', async ({ page }) => {
    let reads = 0;
    let body = '';
    await mockEngine(page, {
        'GET /channelgroups': () => ({ list: { channelGroup: ++reads > 1 ?
            [{ id: 'other', name: 'Added elsewhere', revision: 1 }] : [] } }),
        'POST /channelgroups/_bulkUpdate': (req: any) => {
            expect(new URL(req.url()).searchParams.get('override')).toBe('false');
            body = req.postData();
            return false;
        },
    });
    await page.goto('/channels');
    await page.getByRole('button', { name: 'New Group', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New Group', exact: true });
    await dialog.locator('input').fill('New group');
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    const conflict = page.getByRole('dialog', { name: 'Channel Groups Modified', exact: true });
    await expect(conflict).toBeVisible();
    await conflict.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(body).toContain('Added elsewhere');
    expect(body).toContain('New group');
    await expect(page.getByText('Created group New group', { exact: true })).toHaveCount(0);
});

test('F01: Swing overwrite choice preserves additions made while its prompt is open', async ({ page }) => {
    let groups: any[] = [], writes = 0;
    await mockEngine(page, {
        'GET /channelgroups': () => ({ list: { channelGroup: groups } }),
        'POST /channelgroups/_bulkUpdate': (req: any) => {
            writes++;
            expect(new URL(req.url()).searchParams.get('override')).toBe(writes === 1 ? 'false' : 'true');
            if (writes === 1) return false;
            expect(req.postData()).toContain('Added during prompt');
            return true;
        },
    });
    await page.goto('/channels');
    await page.getByRole('button', { name: 'New Group', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New Group', exact: true });
    await dialog.locator('input').fill('New group');
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    const conflict = page.getByRole('dialog', { name: 'Channel Groups Modified', exact: true });
    await expect(conflict).toBeVisible();
    groups = [{ id: 'concurrent', name: 'Added during prompt', revision: 1 }];
    await conflict.getByRole('button', { name: 'Overwrite', exact: true }).click();
    await expect(page.getByText('Created group New group', { exact: true })).toBeVisible();
    expect(writes).toBe(2);
});
