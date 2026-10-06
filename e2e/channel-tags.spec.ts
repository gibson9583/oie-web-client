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
            ].map(tag => ({ ...tag, name: origin === 'export-only' ? String(tag.name) : tag.name }));
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

const ENGINE_TAGS_XML = `<set>
  <channelTag><id>tag-zero</id><name>0</name><channelIds><string>other-channel</string></channelIds></channelTag>
  <channelTag><id>tag-negzero</id><name>-0</name><channelIds><string>xml-tags</string></channelIds>
    <backgroundColor><red>10</red><green>20</green><blue>30</blue><alpha>255</alpha></backgroundColor></channelTag>
  <channelTag><id>tag-null</id><name>null</name><channelIds><string>xml-tags</string></channelIds></channelTag>
  <channelTag><id>tag-exp</id><name>1e5</name><channelIds/></channelTag>
  <channelTag><id>tag-long</id><name>12345678901234567890</name><channelIds/></channelTag>
  <channelTag><id>tag-leading</id><name>00123</name><channelIds/></channelTag>
</set>`;

test('Settings lists engine tag names exactly as stored', async ({ page }) => {
    await mockEngine(page, { 'GET /server/channelTags': ENGINE_TAGS_XML });
    await page.goto('/settings?tab=tags');
    const names = page.locator('table tbody tr td:nth-child(2)');
    await expect(names).toHaveCount(6);
    expect((await names.allTextContents()).map(name => name.trim()).sort())
        .toEqual(['-0', '0', '00123', '12345678901234567890', '1e5', 'null']);
});

for (const surface of ['edit', 'guided']) {
    test(`${surface}: tags the engine's JSON coerces keep their names and never cross-attach`, async ({ page }) => {
        const id = 'xml-tags';
        let channel = makeChannel(id);
        // The channel's own JSON carries the engine's coerced names: "-0" -> 0, "null" -> null.
        channel.exportData = { ...channel.exportData, channelTags: { channelTag: [
            { id: 'tag-negzero', name: 0, channelIds: { string: [id] } },
            { id: 'tag-null', name: null, channelIds: { string: [id] } }
        ] } };
        const writes: any[] = [];
        await mockEngine(page, {
            'GET /channels/xml-tags': () => ({ channel }),
            'GET /server/channelTags': ENGINE_TAGS_XML,
            'PUT /channels/xml-tags': (req: any) => {
                channel = req.postDataJSON().channel;
                writes.push(structuredClone(channel));
                return true;
            },
        });
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`/channels/${id}/${surface}`);
        await page.locator('.view-body input').first().fill('XML tags edited');
        if (surface === 'guided') await page.locator('.wiz-step', { hasText: 'Channel Options' }).click();
        const chips = page.getByTitle('Remove tag').locator('..');
        await expect(chips).toHaveCount(2);
        await expect(chips.filter({ hasText: /^\s*-0/ })).toHaveCount(1);
        await expect(chips.filter({ hasText: /^\s*null/ })).toHaveCount(1);
        if (surface === 'guided') {
            await page.locator('.wiz-step', { hasText: 'Review' }).click();
            await expect(page.getByText('Tags', { exact: true }).locator('..')).toContainText('-0, null');
        }
        await page.getByRole('button', { name: 'Save Changes', exact: true }).first().click();
        await expect.poll(() => writes.length).toBe(1);
        const saved = writes[0].exportData.channelTags.channelTag;
        expect(saved.map((t: any) => [t.id, t.name]).sort()).toEqual([['tag-negzero', '-0'], ['tag-null', 'null']]);
        expect(errors).toEqual([]);
    });
}

const CHANNEL_TAGS_XML = `<channel><id>xml-tags</id><exportData><channelTags>
  <channelTag><id>tag-negzero</id><name>-0</name><channelIds><string>xml-tags</string></channelIds></channelTag>
  <channelTag><id>tag-null</id><name>null</name><channelIds><string>xml-tags</string></channelIds></channelTag>
</channelTags></exportData></channel>`;

function taggedChannel() {
    const channel = makeChannel('xml-tags');
    channel.exportData = { ...channel.exportData, channelTags: { channelTag: [
        { id: 'tag-negzero', name: 0, channelIds: { string: ['xml-tags'] } },
        { id: 'tag-null', name: null, channelIds: { string: ['xml-tags'] } }
    ] } };
    return channel;
}

for (const surface of ['edit', 'guided']) {
    test(`${surface}: Channel View preserves and adds tags without Tags View permission`, async ({ page }) => {
        let channel = taggedChannel();
        const writes: any[] = [];
        await mockEngine(page, {
            'GET /channels/xml-tags': (req: any) => req.headers().accept === 'application/xml' ? CHANNEL_TAGS_XML : { channel },
            'GET /server/channelTags': { __status: 403 },
            'PUT /channels/xml-tags': (req: any) => { channel = req.postDataJSON().channel; writes.push(channel); return true; }
        });
        await page.goto(`/channels/xml-tags/${surface}`);
        if (surface === 'guided') await page.locator('.wiz-step', { hasText: 'Channel Options' }).click();
        await expect(page.getByTitle('Remove tag')).toHaveCount(2);
        const input = page.getByPlaceholder('Add tag…');
        await input.fill('1e5');
        await input.press('Enter');
        await input.blur();
        await expect(page.getByTitle('Remove tag')).toHaveCount(3);
        if (surface === 'guided') await page.locator('.wiz-step', { hasText: 'Basics' }).click();
        await page.locator('.view-body input').first().fill('Tags preserved');
        await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect.poll(() => writes.length).toBe(1);
        expect(writes[0].exportData.channelTags.channelTag.map((tag: any) => tag.name)).toEqual(['-0', 'null', '1e5']);
    });

    for (const failure of [403, 503, '', '<error/>', '<set><channelTag>']) {
        test(`${surface}: unverifiable tags block save and retain edits for retry (${JSON.stringify(failure)})`, async ({ page }) => {
            let channel = taggedChannel();
            let failing = false;
            const writes: any[] = [];
            await mockEngine(page, {
                'GET /channels/xml-tags': (req: any) => req.headers().accept === 'application/xml'
                    ? (failing ? (typeof failure === 'number' ? { __status: failure } : failure) : CHANNEL_TAGS_XML) : { channel },
                'GET /server/channelTags': () => failing ? { __status: 503 } : ENGINE_TAGS_XML,
                'PUT /channels/xml-tags': (req: any) => { channel = req.postDataJSON().channel; writes.push(channel); return true; }
            });
            await page.goto(`/channels/xml-tags/${surface}`);
            await page.locator('.view-body input').first().fill('Retained tag edit');
            failing = true;
            await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
            const error = page.getByRole('dialog', { name: 'Error', exact: true });
            await expect(error).toBeVisible();
            expect(writes).toHaveLength(0);
            await expect(page.locator('.view-body input').first()).toHaveValue('Retained tag edit');
            await error.getByRole('button', { name: 'Close', exact: true }).last().click();
            failing = false;
            await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
            await expect.poll(() => writes.length).toBe(1);
            expect(writes[0].exportData.channelTags.channelTag.map((tag: any) => tag.name)).toEqual(['-0', 'null']);
        });
    }
}

for (const xml of ['', '<error/>', '<set><channelTag>', '<set><channelTag><id>missing-name</id></channelTag></set>',
    '<set><channelTag><id>duplicate</id><name>a</name></channelTag><channelTag><id>duplicate</id><name>b</name></channelTag></set>']) {
    test(`tag API rejects invalid XML instead of returning an empty set (${JSON.stringify(xml)})`, async ({ page }) => {
        await mockEngine(page, { 'GET /server/channelTags': xml });
        await page.goto('/settings?tab=tags');
        await expect(page.getByText(/Failed to load tags:/).first()).toBeVisible();
    });
}

test('channel tag fallback rejects XML belonging to another channel', async ({ page }) => {
    await mockEngine(page, { 'GET /channels/xml-tags': CHANNEL_TAGS_XML.replace('<id>xml-tags</id>', '<id>other</id>') });
    await page.goto('/dashboard');
    const error = await page.evaluate(async () => {
        const { default: api } = await import(String('/core/api.js'));
        try { await api.channels.tags('xml-tags'); return null; } catch (e: any) { return e.message; }
    });
    expect(error).toBe('Engine returned invalid channel tag XML');
});

for (const lookup of ['tags', 'channel']) {
    test(`clone sends exact tag names (${lookup} lookup)`, async ({ page }) => {
        const channel = { ...taggedChannel(), name: 'Tagged channel' };
        const creates: any[] = [];
        await mockEngine(page, {
            'GET /channels': { list: { channel: [channel] } },
            'GET /channels/xml-tags': (req: any) => req.headers().accept === 'application/xml' ? CHANNEL_TAGS_XML : { channel },
            'GET /server/channelTags': lookup === 'tags' ? ENGINE_TAGS_XML : { __status: 403 },
            'POST /channels': (req: any) => { creates.push(req.postDataJSON().channel); return true; }
        });
        await page.goto('/channels');
        if (lookup === 'channel') {
            const error = page.getByRole('dialog', { name: 'Error', exact: true });
            await error.getByRole('button', { name: 'Close', exact: true }).last().click();
        }
        await page.getByText('Tagged channel', { exact: true }).click();
        await page.getByRole('button', { name: 'Clone Channel', exact: true }).click();
        await expect.poll(() => creates.length).toBe(1);
        expect(creates[0].id).not.toBe('xml-tags');
        expect(creates[0].exportData.channelTags.channelTag.map((tag: any) => [tag.id, tag.name]))
            .toEqual([['tag-negzero', '-0'], ['tag-null', 'null']]);
    });
}
