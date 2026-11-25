import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';
import type { Page, Request } from '@playwright/test';

async function openSourceFilter(page: Page) {
    await page.getByRole('tab', { name: 'Source', exact: true }).click();
    await page.getByRole('button', { name: 'Edit Filter', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Back to Channel', exact: true })).toBeVisible();
}

async function backToSummary(page: Page) {
    await page.getByRole('button', { name: 'Back to Channel', exact: true }).click();
    await page.getByRole('tab', { name: 'Summary', exact: true }).click();
}

async function saveChannelTags(page: Page, channelId: string, button = 'Save Changes') {
    const write = page.waitForRequest(request =>
        request.method() === 'PUT' && new URL(request.url()).pathname === `/api/channels/${channelId}`);
    await page.getByRole('button', { name: button, exact: true }).click();
    return (await write).postDataJSON().channel.exportData.channelTags;
}

test('a tag read from before Back to Channel cannot undo a later tag removal', async ({ page }) => {
    const channel = makeChannel('tag-read-order');
    const tag = { id: 'production', name: 'Production', channelIds: { string: [channel.id] } };
    channel.exportData = { channelTags: { channelTag: [tag] } };
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    let originalRead: Request | undefined;
    const summary = page.getByRole('tab', { name: 'Summary', exact: true });
    await mockEngine(page, {
        [`GET /channels/${channel.id}`]: { channel },
        'GET /server/channelTags': async (request: Request) => {
            // The channel load also reads tag names before mounting Summary.
            if (!originalRead && await summary.count()) {
                originalRead = request;
                await pending;
            }
            return { set: { channelTag: [tag] } };
        }
    });
    try {
        await page.goto(`/channels/${channel.id}/edit`);
        await expect.poll(() => !!originalRead).toBe(true);
        await openSourceFilter(page);
        await page.getByRole('button', { name: 'Back to Channel', exact: true }).click();
        await summary.click();
        const chip = page.getByTitle('Remove tag');
        await chip.click();
        release();
        await (await originalRead!.response())?.finished();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.getByRole('tabpanel').locator('textarea').fill('Removed Production');
        await expect(chip).toHaveCount(0);
        expect(await saveChannelTags(page, channel.id)).toBe('');
    } finally {
        release();
    }
});

for (const [saveIn, button] of [['channel editor', 'Save Changes'], ['source filter', 'Save Channel']]) {
    test(`Back to Channel retains a local tag removal alongside updated Settings assignments on save in the ${saveIn}`, async ({ page }) => {
        const channel = makeChannel('tag-membership-changes');
        const tag = (name: string, assigned = true) => ({
            id: name.toLowerCase(), name, channelIds: assigned ? { string: [channel.id] } : ''
        });
        let tags = [tag('Local'), tag('Retired'), tag('Production', false)];
        await mockEngine(page, {
            'GET /server/channelTags': () => ({ set: { channelTag: tags } }),
            [`GET /channels/${channel.id}`]: () => ({ channel: { ...channel, exportData: {
                metadata: { enabled: true, userId: 1, lastModified: { time: 1700000000000, timezone: 'UTC' } },
                channelTags: { channelTag: tags.filter(t => t.channelIds) }
            } } })
        });
        await page.goto(`/channels/${channel.id}/edit`);
        const chips = page.getByTitle('Remove tag').locator('..');
        await chips.filter({ hasText: 'Local' }).getByTitle('Remove tag').click();
        await openSourceFilter(page);
        // Settings writes the global tag set independently of the channel's last saver.
        tags = [tag('Local'), tag('Retired', false), tag('Production')];
        await backToSummary(page);
        await expect(chips).toHaveCount(1);
        await expect(chips).toContainText('Production');
        if (saveIn === 'source filter') await openSourceFilter(page);
        const saved = await saveChannelTags(page, channel.id, button);
        expect(saved.channelTag).toEqual([expect.objectContaining(tag('Production'))]);
    });
}

test('removing a tag after the engine matched its name case-insensitively survives Back to Channel', async ({ page }) => {
    let channel = makeChannel('tag-canonical-name');
    const tag = { id: 'production-id', name: 'Production', channelIds: { string: ['other-channel'] } };
    channel.exportData = { channelTags: '' };
    await mockEngine(page, {
        [`GET /channels/${channel.id}`]: () => ({ channel }),
        'GET /server/channelTags': () => ({ set: { channelTag: [tag] } }),
        [`PUT /channels/${channel.id}`]: (request: Request) => {
            channel = request.postDataJSON().channel;
            // DefaultChannelController retains the existing server tag's ID and name.
            const submitted = channel.exportData.channelTags.channelTag ?? [];
            const assigned = submitted.some((t: { name: string }) => t.name.toLowerCase() === 'production');
            tag.channelIds.string = assigned ? ['other-channel', channel.id] : ['other-channel'];
            channel.exportData.channelTags = assigned ? { channelTag: [tag] } : '';
            return true;
        }
    });
    await page.goto(`/channels/${channel.id}/edit`);
    const input = page.getByPlaceholder('Add tag…');
    await input.fill('production');
    await input.blur();
    await saveChannelTags(page, channel.id);
    await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toHaveCount(0);
    await page.getByTitle('Remove tag').click();
    await openSourceFilter(page);
    await backToSummary(page);
    await expect(input).toBeVisible();
    await expect(page.getByTitle('Remove tag')).toHaveCount(0);
    expect(await saveChannelTags(page, channel.id)).toBe('');
});

test('a new channel keeps an unsaved tag when the global tag read fails and recovers between returns', async ({ page }) => {
    let unavailable = false;
    await mockEngine(page, {
        'GET /server/channelTags': () => unavailable ? { __status: 503 } : { set: '' }
    });
    await page.goto('/channels');
    await page.getByRole('button', { name: 'New Channel', exact: true }).click();
    await page.getByRole('dialog', { name: 'New Channel', exact: true }).getByText('Classic editor', { exact: true }).click();
    const input = page.getByPlaceholder('Add tag…');
    await input.fill('Testing');
    await input.blur();
    const chip = page.getByTitle('Remove tag').locator('..');
    await expect(chip).toHaveText(/Testing/);
    for (const failRead of [true, false]) {
        await openSourceFilter(page);
        unavailable = failRead;
        await backToSummary(page);
        await expect(chip).toHaveText(/Testing/);
    }
});

test('a wizard tag removal survives a classic filter round trip without Tags View', async ({ page }) => {
    const channel = makeChannel('tag-wizard-handoff');
    const tag = { id: 'production-id', name: 'Production', channelIds: { string: [channel.id] } };
    channel.exportData = { channelTags: { channelTag: [tag] } };
    await mockEngine(page, {
        [`GET /channels/${channel.id}`]: { channel },
        'GET /server/channelTags': { __status: 403 }
    });
    await page.goto(`/channels/${channel.id}/guided`);
    await page.locator('.wiz-step', { hasText: 'Channel Options' }).click();
    await page.getByTitle('Remove tag').click();
    await page.getByRole('button', { name: 'Classic editor', exact: true }).click();
    await expect(page.getByPlaceholder('Add tag…')).toBeVisible();
    await expect(page.getByTitle('Remove tag')).toHaveCount(0);
    await page.getByRole('tabpanel').locator('textarea').fill('Updated description');
    await openSourceFilter(page);
    await page.getByRole('button', { name: 'Back to Channel', exact: true }).click();
    expect(await saveChannelTags(page, channel.id)).toBe('');
});

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
