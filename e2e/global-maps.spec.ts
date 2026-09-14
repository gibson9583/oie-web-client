import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

/*
 * Global Maps dashboard tab (plugins/global-maps): each value arrives as the
 * engine's XStream serialization of the stored object. The tab must show what
 * the Swing viewer shows — StringUtil.valueOf of the deserialized value — not
 * the serialization's structure. A script's Maps.map() stores a MapBuilder,
 * whose XML is a class-named root wrapping a `delegate` map; a plain HashMap
 * is a <map>; a string is a <string>.
 */

const BUILDER_XML = '<com.mirth.connect.userutil.MapBuilder><delegate>'
    + '<entry><string>SenderId</string><string>xvhmscs70w</string></entry>'
    + '<entry><string>Column11</string><int>5</int></entry>'
    + '</delegate></com.mirth.connect.userutil.MapBuilder>';
const HASHMAP_XML = '<map><entry><string>x</string><string>1</string></entry></map>';
const STRING_XML = '<string>THIS</string>';

// POST /extensions/globalmapviewer/maps/_getAllMaps →
// Map<serverId, Map<channelId|null, Map<key, xml>>> in XStream JSON. The global
// map rides under the null channel key.
const MAPS_FIXTURE = { map: { entry: [{
    string: 'srv-1',
    map: { entry: [{
        null: null,
        map: { entry: [
            { string: ['builder', BUILDER_XML] },
            { string: ['hash', HASHMAP_XML] },
            { string: ['plain', STRING_XML] }
        ] }
    }] }
}] } };

test('Global Maps renders map values the way Swing does, not the XStream structure', async ({ page }) => {
    await mockEngine(page, { 'POST /extensions/globalmapviewer/maps/_getAllMaps': MAPS_FIXTURE });
    await page.goto('/dashboard');
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Global Maps', exact: true }).click();

    const table = page.locator('table.global-maps');
    const row = (key: string) => table.locator('tr', { has: page.locator('td', { hasText: key }) });
    await expect(row('builder').locator('td').nth(3)).toHaveText('{SenderId=xvhmscs70w, Column11=5}');
    await expect(row('hash').locator('td').nth(3)).toHaveText('{x=1}');
    await expect(row('plain').locator('td').nth(3)).toHaveText('THIS');
    // Nothing of the wire shape leaks into the cells.
    await expect(table).not.toContainText('delegate');
    await expect(table).not.toContainText('entry');

    // The full-value dialog shows the same text.
    await row('builder').dblclick();
    const dialog = page.locator('.modal', { hasText: 'Global Map Value' });
    await expect(dialog.locator('pre')).toHaveText('{SenderId=xvhmscs70w, Column11=5}');
});
