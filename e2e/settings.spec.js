import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * Settings (React port). Server-configuration view with 7 tabs (Server,
 * Administrator, Tags, Configuration Map, Database Tasks, Resources + the
 * plugin-contributed Data Pruner). Each tab swaps the rail task pane WITHOUT a
 * route change; the per-tab Save/action sets and the selection-gated tag tasks
 * are the parity points exercised here.
 *
 * In the mock environment no runtime plugins load (no /webadmin/plugins.json),
 * so the plugin-contributed tabs (Data Pruner) and the Resources detail editor
 * are absent — same as the legacy view under the same conditions; the six
 * built-in tabs are what render and are asserted.
 *
 * Fixtures beyond the defaults (passed via mockEngine overrides below):
 *   GET /server/settings        — full ServerSettings so the Server form populates
 *   GET /server/channelTags     — one ChannelTag so the Tags grid has a row
 *   GET /channels/idsAndNames    — a channel so the tag channel list renders
 *   GET /server/configurationMap — one entry so the config-map grid has a row
 *   GET /databaseTasks           — one IDLE task so the Database Tasks grid has a row
 * (updateSettings/resources are left unmocked — the view tolerates empties.)
 */

const FIXTURES = {
    'GET /server/settings': {
        serverSettings: {
            environmentName: 'prod-env',
            serverName: 'Primary Engine',
            clearGlobalMap: true,
            smtpHost: 'smtp.example.org',
            smtpSecure: 'tls',
            administratorAutoLogoutIntervalEnabled: true,
            administratorAutoLogoutIntervalField: 10,
            defaultMetaDataColumns: { metaDataColumn: [{ name: 'SOURCE', type: 'STRING', mappingName: 'mirth_source' }] }
        }
    },
    'GET /server/channelTags': { set: { channelTag: [
        { id: 'tag-1', name: 'Inbound', channelIds: { string: ['c-started'] }, backgroundColor: { red: 200, green: 150, blue: 120, alpha: 255 } }
    ] } },
    'GET /channels/idsAndNames': { map: { entry: [{ string: ['c-started', 'Demo Started'] }] } },
    'GET /server/configurationMap': { map: { entry: [
        { string: 'db.url', 'com.mirth.connect.util.ConfigurationProperty': { value: 'jdbc:postgresql://db/oie', comment: 'Primary DB' } }
    ] } },
    'GET /databaseTasks': { map: { entry: [
        { string: 'task-1', databaseTask: { id: 'task-1', name: 'Compact tables', description: 'Reclaim disk space', status: 'IDLE' } }
    ] } }
};

test.beforeEach(async ({ page }) => {
    await mockEngine(page, FIXTURES);
});

test('Settings opens on the Server tab with its task pane and loaded fields', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page).toHaveURL(/\/settings/);

    // The Server tab is active by default and populates from /server/settings.
    await expect(page.getByRole('button', { name: 'Server', exact: true })).toHaveClass(/active/);
    const serverName = page.locator('.field', { has: page.getByText('Server name', { exact: true }) }).locator('input');
    await expect(serverName).toHaveValue('Primary Engine');

    // Server task pane: full action set, in order, including the bottom Save.
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Backup Config', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restore Config', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear All Statistics', exact: true })).toBeVisible();
});

test('switching tabs swaps the task pane without a route change', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('button', { name: 'Clear All Statistics', exact: true })).toBeVisible();

    // Administrator tab — localStorage-only prefs; Save + Restore Defaults, no Backup.
    await page.getByRole('button', { name: 'Administrator', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Restore Defaults', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Backup Config', exact: true })).toHaveCount(0);
    await expect(page).toHaveURL(/\/settings/);   // no navigation

    // Configuration Map tab — Save + Import Map / Export Map; its row loads.
    await page.getByRole('button', { name: 'Configuration Map', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Import Map', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export Map', exact: true })).toBeVisible();
    // The loaded entry's key populates the first cell of the config-map grid.
    await expect(page.locator('table.dt tbody tr').first().locator('input').first()).toHaveValue('db.url');

    // Database Tasks tab — Refresh only, no Save (read/run only).
    await page.getByRole('button', { name: 'Database Tasks', exact: true }).click();
    await expect(page.getByRole('cell', { name: 'Compact tables', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
});

test('Tags tab gates the Remove Tag task on selection', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Tags', exact: true }).click();

    // The loaded tag renders; the always-on Tag tasks are present.
    await expect(page.getByRole('cell', { name: 'Inbound', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Tag', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();

    // Remove Tag is hidden until a tag is selected, then appears.
    await expect(page.getByRole('button', { name: 'Remove Tag', exact: true })).toBeHidden();
    await page.getByRole('cell', { name: 'Inbound', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Remove Tag', exact: true })).toBeVisible();

    // Selecting a tag reveals its channel-assignment list (mutate-in-place editing).
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();
});

test('custom background color saves via the single-key preference endpoint (issue #10)', async ({ page }) => {
    const puts = [];
    page.on('request', (r) => {
        if (r.method() === 'PUT') puts.push({ path: new URL(r.url()).pathname, body: r.postData() });
    });

    // Deep-link straight to the Administrator (user prefs) tab.
    await page.goto('/settings?tab=administrator');
    await expect(page.getByRole('button', { name: 'Administrator', exact: true })).toHaveClass(/active/);

    // Switch the Background color override to Custom and pick a color.
    await page.locator('select', { hasText: 'Server Default' }).selectOption('custom');
    const picker = page.locator('input[type=color]');
    await expect(picker).toBeEnabled();
    await picker.fill('#ff8800');

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Preferences saved')).toBeVisible();

    // Swing writes this one key: PUT /users/{id}/preferences/backgroundColor with a
    // text/plain <awt-color> body. The whole-map PUT /users/{id}/preferences
    // deserializes to a Java Properties server-side and 500s on that value.
    const single = puts.find((p) => /\/users\/1\/preferences\/backgroundColor$/.test(p.path));
    expect(single).toBeTruthy();
    expect(single.body).toContain('<awt-color>');
    expect(puts.some((p) => /\/users\/1\/preferences$/.test(p.path))).toBe(false);
});
