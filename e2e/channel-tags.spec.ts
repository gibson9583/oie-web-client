import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';

for (const surface of ['edit', 'guided']) {
    for (const origin of ['server-and-export', 'export-only']) {
        test(`${surface}: numeric tags from ${origin} retain names, IDs and membership across saves`, async ({ page }) => {
            const id = 'numeric-tags';
            let channel = makeChannel(id);
            const tags = [
                { id: 'tag-123', name: 123, channelIds: { string: [id, 'other-channel'] } },
                { id: 'tag-zero', name: 0, channelIds: { string: [id] } },
                { id: 'tag-leading', name: '00123', channelIds: { string: [id] } },
                { id: 'tag-text', name: 'production', channelIds: { string: [id] } },
            ];
            channel.exportData = { ...channel.exportData, channelTags: { channelTag: structuredClone(tags) } };
            const writes: any[] = [];
            await mockEngine(page, {
                'GET /channels/numeric-tags': () => ({ channel }),
                'GET /server/channelTags': { set: { channelTag: origin === 'export-only' ? [] : tags } },
                'PUT /channels/numeric-tags': (req: any) => {
                    channel = req.postDataJSON().channel;
                    writes.push(structuredClone(channel));
                    return true;
                },
            });
            const errors: string[] = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(`/channels/${id}/${surface}`);
            await page.locator('.view-body input').first().fill('Numeric tags edited');
            if (surface === 'guided') await page.locator('.wiz-step', { hasText: 'Channel Options' }).click();
            await expect(page.getByTitle('Remove tag')).toHaveCount(4);
            // Numeric server and stringified exported names refer to the same tag.
            await page.getByTitle('Remove tag').locator('..').filter({ hasText: /^\s*123/ }).getByTitle('Remove tag').click();
            await expect(page.getByTitle('Remove tag')).toHaveCount(3);
            const input = page.getByPlaceholder('Add tag…');
            await input.fill('123');
            await input.press('Enter');
            // WebKit commits a native input change on blur rather than Enter.
            await input.blur();
            await expect(page.getByTitle('Remove tag')).toHaveCount(4);
            await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
            await expect.poll(() => writes.length).toBe(1);
            const assertTags = (saved: any) => {
                const result = saved.exportData.channelTags.channelTag;
                expect(result).toHaveLength(4);
                expect(result.map((t: any) => t.name).sort()).toEqual(['0', '00123', '123', 'production']);
                const numeric = result.find((t: any) => t.name === '123');
                expect(numeric.id).toBe('tag-123');
                expect([...numeric.channelIds.string].sort()).toEqual([id, 'other-channel']);
                expect(result.find((t: any) => t.name === '0').id).toBe('tag-zero');
            };
            assertTags(writes[0]);
            // A subsequent edit/save must not duplicate or detach normalized tags.
            await page.goto(`/channels/${id}/${surface}`);
            await page.locator('.view-body input').first().fill('Numeric tags saved again');
            if (surface === 'guided') await page.locator('.wiz-step', { hasText: 'Channel Options' }).click();
            await expect(page.getByTitle('Remove tag')).toHaveCount(4);
            await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
            await expect.poll(() => writes.length).toBe(2);
            assertTags(writes[1]);
            expect(errors).toEqual([]);
        });
    }
}
