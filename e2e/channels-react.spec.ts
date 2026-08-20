import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { mockEngine } from './mock.js';

/*
 * Focused coverage for the React Channels view (the grouped channel tree). The
 * legacy-parity guardrails (lists Demo Started/Demo Stopped, New Channel present,
 * column header menu hides/restores Description while Name is never offered) live
 * in channels.spec.js and must keep passing; this spec exercises the tree-grid
 * structure, the counts bar, twisty collapse, selection-gated task buttons across
 * BOTH task panes, the group selection path, and click-empty-to-clear.
 *
 * Channel groups are added via the 'GET /channelgroups' override so the grouped
 * tree shows a real group with one member channel plus the synthetic Default
 * Group for the ungrouped channel. The bulkUpdate endpoint is a multipart POST to
 * /channelgroups/_bulkUpdate (no-op in the mock; we only assert UI behavior).
 */

// A real group ("Demo Group") owning c-started; c-stopped falls into [Default Group].
const GROUPS_FIXTURE = {
    'GET /channelgroups': {
        list: {
            channelGroup: [
                {
                    '@version': '4.5.0', id: 'g-1', name: 'Demo Group', revision: 1,
                    description: 'A demo channel group',
                    channels: { channel: [{ id: 'c-started' }] }
                }
            ]
        }
    },
    // bulkUpdate target (New Group / Assign To Group / Delete Group) — accept + no-op.
    'POST /channelgroups/_bulkUpdate': ''
};

async function gotoChannels(page: any) {
    await page.goto('/');
    await page.getByRole('button', { name: 'Channels', exact: true }).click();
    await expect(page).toHaveURL(/\/channels/);
}

test.describe('Channels React view', () => {
    test.beforeEach(async ({ page }) => {
        await mockEngine(page, GROUPS_FIXTURE);
    });

    test('renders the grouped channel tree with a real group and the Default Group', async ({ page }) => {
        await gotoChannels(page);

        // Both groups render as bracketed group rows (the tree, not a flat list).
        await expect(page.getByRole('gridcell', { name: '[Demo Group]', exact: true })).toBeVisible();
        await expect(page.getByRole('gridcell', { name: '[Default Group]', exact: true })).toBeVisible();

        // The member channels are listed under their groups.
        await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();
        await expect(page.getByText('Demo Stopped', { exact: true })).toBeVisible();

        // The bottom counts bar reports groups / channels / enabled.
        await expect(page.locator('.filterbar .counts')).toHaveText('2 Groups, 2 Channels, 2 Enabled');
    });

    test('twisty collapses a group, hiding its channel rows', async ({ page }) => {
        await gotoChannels(page);
        await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();

        // The group rows each carry an expand/collapse twisty (expanded = ▾).
        const demoGroupRow = page.getByRole('row', { name: /\[Demo Group\]/ });
        await demoGroupRow.locator('.twisty').click();

        // Collapsing [Demo Group] removes its member channel from the tree, but the
        // ungrouped channel under [Default Group] stays.
        await expect(page.getByText('Demo Started', { exact: true })).toHaveCount(0);
        await expect(page.getByText('Demo Stopped', { exact: true })).toBeVisible();
    });

    test('selecting a channel reveals the selection-gated Channel Tasks', async ({ page }) => {
        await gotoChannels(page);

        // Nothing selected: the always-on tasks are present, the gated ones are not.
        await expect(page.getByRole('button', { name: 'New Channel', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Edit Channel', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Delete Channel', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'View Messages', exact: true })).toHaveCount(0);

        // Click the channel row → single-selection tasks appear.
        await page.getByText('Demo Stopped', { exact: true }).click();
        await expect(page.getByRole('button', { name: 'Edit Channel', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Delete Channel', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Clone Channel', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Export Channel', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'View Messages', exact: true })).toBeVisible();
        // Demo Stopped is enabled by default (metadata defaults true) → Disable shows.
        await expect(page.getByRole('button', { name: 'Disable Channel', exact: true })).toBeVisible();
        // Assign To Group (Group Tasks pane) appears once a channel is selected.
        await expect(page.getByRole('button', { name: 'Assign To Group', exact: true })).toBeVisible();
    });

    test('selecting a real group reveals Group Tasks and the group-deploy buttons', async ({ page }) => {
        await gotoChannels(page);

        // New Group is always present; the real-group tasks are gated.
        await expect(page.getByRole('button', { name: 'New Group', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Edit Group Details', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Delete Group', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Export Group', exact: true })).toHaveCount(0);

        // Click the [Demo Group] row (not its twisty) → real-group tasks appear.
        await page.getByRole('gridcell', { name: '[Demo Group]', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Edit Group Details', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Delete Group', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Export Group', exact: true })).toBeVisible();
        // A group selection makes Deploy Channel deployable (acts on the group's channels).
        await expect(page.getByRole('button', { name: 'Deploy Channel', exact: true })).toBeVisible();
    });

    test('imports the full channels embedded in a Swing channel-group export', async ({ page }) => {
        await gotoChannels(page);

        const channelRequest = page.waitForRequest((request: any) => {
            const url = new URL(request.url());
            return request.method() === 'POST' && url.pathname === '/api/channels';
        });
        const groupRequest = page.waitForRequest((request: any) => {
            const url = new URL(request.url());
            return request.method() === 'POST' && url.pathname === '/api/channelgroups/_bulkUpdate';
        });
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Import Group', exact: true }).click();
        await (await chooser).setFiles({
            name: 'imported-group.xml',
            mimeType: 'application/xml',
            buffer: Buffer.from(`
                <channelGroup version="4.5.0">
                  <id>g-imported</id>
                  <name>Imported Group</name>
                  <revision>1</revision>
                  <description>Swing export</description>
                  <channels>
                    <channel version="4.5.0">
                      <id>c-imported</id>
                      <name>Imported Channel</name>
                      <revision>1</revision>
                    </channel>
                  </channels>
                </channelGroup>`)
        });

        const importedChannel = await channelRequest;
        expect(importedChannel.postData()).toContain('<id>c-imported</id>');
        expect(importedChannel.postData()).toContain('<name>Imported Channel</name>');

        const importedGroup = await groupRequest;
        expect(importedGroup.postData()).toContain('g-imported');
        expect(importedGroup.postData()).toContain('c-imported');
        await expect(page.getByText('Imported 1 group(s) from imported-group.xml', { exact: true })).toBeVisible();
    });

    test('exports full associated channels for one group and all groups', async ({ page }) => {
        await page.addInitScript(() => { delete (window as any).showSaveFilePicker; });
        await mockEngine(page, {
            ...GROUPS_FIXTURE,
            'GET /channelgroups': (request: any) => request.headers()['accept']?.includes('application/xml')
                ? `<list><channelGroup version="4.5.0"><id>g-1</id><name>Demo Group</name><revision>1</revision><description>A demo channel group</description><channels><channel version="4.5.0"><id>c-started</id><revision>1</revision></channel></channels></channelGroup></list>`
                : GROUPS_FIXTURE['GET /channelgroups'],
            'GET /channels': (request: any) => request.headers()['accept']?.includes('application/xml')
                ? `<list><channel version="4.5.0"><id>c-started</id><nextMetaDataId>2</nextMetaDataId><name>Demo Started</name><revision>1</revision><sourceConnector><name>Source</name></sourceConnector><exportData><metadata><enabled>true</enabled></metadata></exportData></channel></list>`
                : { list: { channel: [
                    { '@version': '4.5.0', id: 'c-started', name: 'Demo Started', revision: 1 },
                    { '@version': '4.5.0', id: 'c-stopped', name: 'Demo Stopped', revision: 1 },
                ] } },
        });
        await gotoChannels(page);
        await page.getByRole('gridcell', { name: '[Demo Group]', exact: true }).click();

        const assertFullChannelExport = async (buttonName: string) => {
            const downloadPromise = page.waitForEvent('download');
            await page.getByRole('button', { name: buttonName, exact: true }).click();
            const download = await downloadPromise;
            const xml = await readFile(await download.path(), 'utf8');
            expect(xml).toContain('<id>g-1</id>');
            expect(xml).toMatch(/<channels><channel[^>]*>[\s\S]*<id>c-started<\/id>[\s\S]*<name>Demo Started<\/name>/);
            expect(xml).toContain('<sourceConnector><name>Source</name></sourceConnector>');
        };

        await assertFullChannelExport('Export Group');
        await assertFullChannelExport('Export All Groups');
    });

    test('Deploy Channel moves to the dashboard on success', async ({ page }) => {
        await mockEngine(page, { ...GROUPS_FIXTURE, 'POST /channels/_deploy': '' });
        await gotoChannels(page);
        await page.getByText('Demo Stopped', { exact: true }).click();
        await page.getByRole('button', { name: 'Deploy Channel', exact: true }).click();
        await expect(page).toHaveURL(/\/dashboard/);
    });

    test('a deploy failure shows the error detail modal and stays on Channels', async ({ page }) => {
        await mockEngine(page, {
            ...GROUPS_FIXTURE,
            'POST /channels/_deploy': { __status: 500, body: { error: 'compile failed' } },
        });
        await gotoChannels(page);
        await page.getByText('Demo Stopped', { exact: true }).click();
        await page.getByRole('button', { name: 'Deploy Channel', exact: true }).click();

        await expect(page.getByText('Channel Deployment Failed', { exact: true })).toBeVisible();
        await expect(page).toHaveURL(/\/channels/);
    });

    test('clicking empty space clears the selection and hides contextual tasks', async ({ page }) => {
        await gotoChannels(page);
        await page.getByText('Demo Stopped', { exact: true }).click();
        await expect(page.getByRole('button', { name: 'Edit Channel', exact: true })).toBeVisible();

        // Click the empty grid area below the (short) tree → selection clears.
        const wrap = page.locator('.dt-wrap');
        const box = await wrap.boundingBox();
        await wrap.click({ position: { x: 8, y: box!.height - 8 } });
        await expect(page.getByRole('button', { name: 'Edit Channel', exact: true })).toHaveCount(0);
    });
});
