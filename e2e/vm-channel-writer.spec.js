import { test, expect } from '@playwright/test';
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

async function openChannelWriter(page, channelId) {
    const writer = CASES.find((c) => c.name === 'Channel Writer');
    const id = `cw-${channelId.replace(/[^a-z0-9]+/gi, '-')}`;
    const channel = makeChannel(id, {
        destination: { transportName: 'Channel Writer', properties: { ...writer.properties(), channelId } },
    });
    await mockEngine(page, {
        [`GET /channels/${id}`]: { channel },
        'GET /channels/idsAndNames': IDS_AND_NAMES,
    });
    await page.goto(`/channels/${id}/edit`);
    await page.getByRole('button', { name: 'Destinations', exact: true }).click();
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
