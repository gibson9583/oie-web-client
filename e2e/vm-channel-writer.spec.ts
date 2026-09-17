import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { CASES, makeChannel } from './connector-fixtures.js';

/*
 * Channel Writer (VM dispatcher) "Channel Id" combo. The combo's standing options
 * must be only <None> + real channel names — matching Swing's ChannelWriter, whose
 * combo model is exactly that. <Map Variable> / <Channel Not Found> are NOT picker
 * options; Swing only ever *displays* them (setSelectedItem with a value not in the
 * model) to describe the field's current value. The native <select> port carries
 * one as a hidden option only while it is the selection, so it shows in the closed
 * control but never in the open dropdown.
 *
 * Regression: an earlier port appended <Map Variable>/<Channel Not Found> as real
 * options the user could pick (meaningless, and divergent from Swing).
 */

// XStream wraps a Map under a single "map" root key (api.unwrap strips it, leaving
// { entry: [...] } for mapEntries). Two channels; mapEntries yields [id, name],
// sorted by NAME → Alpha, then Beta.
const IDS_AND_NAMES = {
    map: {
        entry: [
            { string: ['ch-beta-1', 'Beta Channel'] },
            { string: ['ch-alpha-2', 'Alpha Channel'] },
        ],
    },
};
const VISIBLE_OPTIONS = ['<None>', 'Alpha Channel', 'Beta Channel'];

async function openChannelWriter(page: any, channelId: any, catalog: any = IDS_AND_NAMES) {
    const writer = CASES.find((c) => c.name === 'Channel Writer');
    const id = `cw-${channelId.replace(/[^a-z0-9]+/gi, '-')}`;
    const channel = makeChannel(id, {
        destination: { transportName: 'Channel Writer', properties: { ...writer!.properties(), channelId } },
    });
    await mockEngine(page, {
        [`GET /channels/${id}`]: { channel },
        'GET /channels/idsAndNames': catalog,
    });
    await page.goto(`/channels/${id}/edit`);
    await page.getByRole('tab', { name: 'Destinations', exact: true }).click();
    await page.getByRole('cell', { name: 'Channel Writer', exact: true }).first().click();
    await expect(page.locator('.cform-section').first()).toBeVisible();
    return page.locator('select[title*="Select the channel"]');
}

test('a known channel id selects its name; the dropdown lists only <None> + channels', async ({ page }) => {
    const combo = await openChannelWriter(page, 'ch-alpha-2');
    await expect(combo).toHaveValue('Alpha Channel');   // also waits for idsAndNames to load

    // Every option is a real, pickable choice — no synthetic labels anywhere.
    expect(await combo.locator('option').allTextContents()).toEqual(VISIBLE_OPTIONS);
});

test('a map-variable channel id shows <Map Variable> as a hidden, non-pickable selection', async ({ page }) => {
    const combo = await openChannelWriter(page, '${myChannel}');
    await expect(combo).toHaveValue('<Map Variable>');

    // The open dropdown still lists only <None> + channels — the synthetic label is
    // present solely as the (hidden) current selection, never a standing option.
    expect(await combo.locator('option:not([hidden])').allTextContents()).toEqual(VISIBLE_OPTIONS);
    expect(await combo.locator('option[hidden]').allTextContents()).toEqual(['<Map Variable>']);
});

test('an unknown channel id shows <Channel Not Found> the same way', async ({ page }) => {
    const combo = await openChannelWriter(page, 'no-such-channel');
    await expect(combo).toHaveValue('<Channel Not Found>');
    expect(await combo.locator('option:not([hidden])').allTextContents()).toEqual(VISIBLE_OPTIONS);
    expect(await combo.locator('option[hidden]').allTextContents()).toEqual(['<Channel Not Found>']);
});

test('F20: refreshing the catalog shows renamed and new channels without changing the stored ID', async ({ page }) => {
    const combo = await openChannelWriter(page, 'ch-alpha-2');
    await expect(combo).toHaveValue('Alpha Channel');
    await page.route('**/api/channels/idsAndNames', route => route.fulfill({ json: { map: { entry: [
        { string: ['ch-alpha-2', 'Renamed Channel'] }, { string: ['ch-new', 'New Channel'] }
    ] } } }));
    await page.getByRole('button', { name: 'Refresh channels', exact: true }).click();
    await expect(combo).toHaveValue('Renamed Channel');
    expect(await combo.locator('option:not([hidden])').allTextContents()).toEqual(['<None>', 'New Channel', 'Renamed Channel']);
    await expect(page.locator('input[placeholder="<None>"]')).toHaveValue('ch-alpha-2');
});

test('F20: failed catalog requests can be retried without reloading the application', async ({ page }) => {
    let failed = true;
    const combo = await openChannelWriter(page, 'ch-alpha-2', () => failed
        ? { __status: 503, body: { message: 'catalog unavailable' } } : IDS_AND_NAMES);
    await expect(page.getByRole('status')).toContainText('Could not load channels');
    await expect(combo).toBeDisabled();
    await expect(page.locator('input[placeholder="<None>"]')).toHaveValue('ch-alpha-2');
    failed = false;
    await page.getByRole('button', { name: 'Refresh channels', exact: true }).click();
    await expect(combo).toBeEnabled();
    await expect(combo).toHaveValue('Alpha Channel');
});
