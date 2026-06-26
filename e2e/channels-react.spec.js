import { test, expect } from '@playwright/test';
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

async function gotoChannels(page) {
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
        await expect(page.getByRole('cell', { name: '[Demo Group]', exact: true })).toBeVisible();
        await expect(page.getByRole('cell', { name: '[Default Group]', exact: true })).toBeVisible();

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
        await page.getByRole('cell', { name: '[Demo Group]', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Edit Group Details', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Delete Group', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Export Group', exact: true })).toBeVisible();
        // A group selection makes Deploy Channel deployable (acts on the group's channels).
        await expect(page.getByRole('button', { name: 'Deploy Channel', exact: true })).toBeVisible();
    });

    test('clicking empty space clears the selection and hides contextual tasks', async ({ page }) => {
        await gotoChannels(page);
        await page.getByText('Demo Stopped', { exact: true }).click();
        await expect(page.getByRole('button', { name: 'Edit Channel', exact: true })).toBeVisible();

        // Click the empty grid area below the (short) tree → selection clears.
        const wrap = page.locator('.dt-wrap');
        const box = await wrap.boundingBox();
        await wrap.click({ position: { x: 8, y: box.height - 8 } });
        await expect(page.getByRole('button', { name: 'Edit Channel', exact: true })).toHaveCount(0);
    });
});
