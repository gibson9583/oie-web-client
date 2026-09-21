import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

function statusXml(destinations = [{ id: 3, name: 'Selected' }, { id: 7, name: 'Excluded' }], source = true) {
    const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const children = [...(source ? [{ id: 0, name: 'Source' }] : []), ...destinations];
    return `<dashboardStatus><channelId>c-started</channelId><statusType>CHANNEL</statusType><childStatuses>${children.map(child =>
        `<dashboardStatus><channelId>c-started</channelId><name>${escape(child.name)}</name><metaDataId>${child.id}</metaDataId><statusType>${child.id === 0 ? 'SOURCE_CONNECTOR' : 'DESTINATION_CONNECTOR'}</statusType><childStatuses/></dashboardStatus>`
    ).join('')}</childStatuses></dashboardStatus>`;
}

test('F06: repeated submission while processing sends one message', async ({ page }) => {
    await page.route('**/vendor/monaco/**', route => route.abort());
    await mockEngine(page);
    let sends = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/channels/c-started/messages*', async route => {
        if (route.request().method() !== 'POST') return route.fallback();
        sends++;
        await gate;
        await route.fulfill({ status: 200, body: '' });
    });
    await page.goto('/messages/c-started');
    await page.getByRole('button', { name: 'Send Message', exact: true }).click();
    await page.locator('textarea.ce-area').fill('MSH|synthetic regression payload');
    await page.getByRole('button', { name: 'Process Message', exact: true })
        .evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await expect.poll(() => sends).toBe(1);
    await expect(page.getByRole('button', { name: 'Processing…', exact: true })).toBeDisabled();
    release();
    await expect(page.getByText('Message sent for processing', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Message', exact: true })).toHaveCount(0);
    expect(sends).toBe(1);
});

test('F07: failed discovery blocks sending and Retry recovers the explicit destinations', async ({ page }) => {
    await page.route('**/vendor/monaco/**', route => route.abort());
    await mockEngine(page);
    await page.goto('/messages/c-started');
    await expect(page.getByRole('button', { name: 'Send Message', exact: true })).toBeVisible();
    let reads = 0;
    let sends = 0;
    await page.route('**/api/channels/c-started/status', async route => {
        expect(route.request().headers().accept).toContain('application/xml');
        if (++reads === 1) await route.fulfill({ status: 503, body: 'discovery unavailable' });
        else await route.fulfill({ contentType: 'application/xml', body: statusXml() });
    });
    await page.route('**/api/channels/c-started/messages*', async route => {
        if (route.request().method() !== 'POST') return route.fallback();
        sends++;
        expect(route.request().postDataJSON()['com.mirth.connect.donkey.model.message.RawMessage'].destinationMetaDataIds.int).toEqual([3]);
        await route.fulfill({ status: 200, body: '' });
    });
    await page.getByRole('button', { name: 'Send Message', exact: true }).click();
    const failed = page.getByRole('dialog', { name: 'Unable to Load Destinations' });
    await expect(failed).toContainText('No message has been sent');
    await expect(page.getByRole('button', { name: 'Process Message', exact: true })).toHaveCount(0);
    expect(sends).toBe(0);
    await failed.getByRole('button', { name: 'Retry', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Message', exact: true });
    await dialog.locator('textarea.ce-area').fill('MSH|synthetic regression payload');
    await dialog.getByRole('row', { name: 'Excluded' }).getByRole('checkbox').uncheck();
    await dialog.getByRole('button', { name: 'Process Message', exact: true }).click();
    await expect.poll(() => sends).toBe(1);
});

for (const all of [true, false]) {
    test(`F07: ${all ? 'all' : 'no'} selected destinations use Swing's RawMessage contract`, async ({ page }) => {
        await page.route('**/vendor/monaco/**', route => route.abort());
        let sends = 0;
        await mockEngine(page, { 'POST /channels/c-started/messagesWithObj': (request: any) => {
            sends++;
            const raw = request.postDataJSON()['com.mirth.connect.donkey.model.message.RawMessage'];
            expect(raw.rawData).toBe('MSH|synthetic regression payload');
            if (all) expect(raw).not.toHaveProperty('destinationMetaDataIds');
            else expect(raw.destinationMetaDataIds).toEqual({ '@class': 'list', int: [] });
            return { long: 1 };
        } });
        await page.goto('/messages/c-started');
        await page.getByRole('button', { name: 'Send Message', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Message', exact: true });
        await dialog.locator('textarea.ce-area').fill('MSH|synthetic regression payload');
        if (!all) await dialog.getByRole('checkbox').uncheck();
        await dialog.getByRole('button', { name: 'Process Message', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        expect(sends).toBe(1);
        await expect(page.getByRole('dialog', { name: 'Process Without Destinations' })).toHaveCount(0);
    });
}

test('F06: a definite engine rejection allows correction and retry without a duplicate warning', async ({ page }) => {
    await page.route('**/vendor/monaco/**', route => route.abort());
    let sends = 0;
    await mockEngine(page, { 'POST /channels/c-started/messagesWithObj': () =>
        ++sends === 1 ? { __status: 400, body: { error: 'Invalid request' } } : { long: 1 } });
    await page.goto('/messages/c-started');
    await page.getByRole('button', { name: 'Send Message', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Message', exact: true });
    await dialog.locator('textarea.ce-area').fill('MSH|synthetic rejected request');
    await dialog.getByRole('button', { name: 'Process Message', exact: true }).click();
    const error = page.getByRole('dialog', { name: 'Error', exact: true });
    await expect(error).toContainText('Message was rejected');
    await error.getByRole('button', { name: 'Close', exact: true }).last().click();
    await dialog.locator('textarea.ce-area').fill('MSH|synthetic corrected request');
    await dialog.getByRole('button', { name: 'Process Message', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(sends).toBe(2);
    await expect(page.getByRole('dialog', { name: 'Retry Message', exact: true })).toHaveCount(0);
});

test('F06: an unknown send outcome requires an explicit duplicate-risk decision before retry', async ({ page }) => {
    await page.route('**/vendor/monaco/**', route => route.abort());
    await mockEngine(page);
    let sends = 0;
    await page.route('**/api/channels/c-started/messages*', async route => {
        if (route.request().method() !== 'POST') return route.fallback();
        if (++sends === 1) await route.abort('failed');
        else await route.fulfill({ status: 200, body: '' });
    });
    await page.goto('/messages/c-started');
    await page.getByRole('button', { name: 'Send Message', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Message', exact: true });
    await dialog.locator('textarea.ce-area').fill('MSH|synthetic uncertain outcome');
    await dialog.getByRole('button', { name: 'Process Message', exact: true }).click();
    const error = page.getByRole('dialog', { name: 'Error', exact: true });
    await expect(error).toContainText('Verify the engine result');
    await error.getByRole('button', { name: 'Close', exact: true }).last().click();
    await dialog.getByRole('button', { name: 'Process Message', exact: true }).click();
    const retry = page.getByRole('dialog', { name: 'Retry Message', exact: true });
    await expect(retry).toContainText('duplicate');
    await retry.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(sends).toBe(1);
    await dialog.getByRole('button', { name: 'Process Message', exact: true }).click();
    await retry.getByRole('button', { name: 'Resend Message', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(sends).toBe(2);
});

for (const denial of ['403', 'empty map']) {
    for (const selection of ['all', 'subset', 'none']) {
        test(`F07: dashboard operator without View Messages (${denial}) can process ${selection} destinations`, async ({ page }) => {
            await page.route('**/vendor/monaco/**', route => route.abort());
            let sends = 0, statusReads = 0, savedReads = 0;
            await mockEngine(page, {
                'GET /channels/c-started/connectorNames': () => { savedReads++;
                    return denial === '403' ? { __status: 403, body: 'View Messages is not granted' } : { map: null }; },
                'GET /channels/c-started/status': () => { statusReads++; return statusXml(); },
                'POST /channels/c-started/messagesWithObj': (req: any) => {
                    sends++;
                    const raw = req.postDataJSON()['com.mirth.connect.donkey.model.message.RawMessage'];
                    if (selection === 'all') expect(raw).not.toHaveProperty('destinationMetaDataIds');
                    else expect(raw.destinationMetaDataIds.int).toEqual(selection === 'subset' ? [3] : []);
                    return { long: 1 };
                },
            });
            await page.goto('/dashboard');
            await page.getByText('Demo Started', { exact: true }).first().click();
            await page.getByRole('button', { name: 'Send Message', exact: true }).click();
            const dialog = page.getByRole('dialog', { name: 'Message', exact: true });
            await dialog.locator('textarea.ce-area').fill('Operator message');
            if (selection !== 'all') await dialog.getByRole('row', { name: 'Excluded' }).getByRole('checkbox').uncheck();
            if (selection === 'none') await dialog.getByRole('row', { name: 'Selected' }).getByRole('checkbox').uncheck();
            await dialog.getByRole('button', { name: 'Process Message', exact: true }).click();
            await expect(dialog).toHaveCount(0);
            expect(sends).toBe(1);
            expect(statusReads).toBe(1);
            expect(savedReads).toBe(0);
        });
    }

}

for (const failure of [
    { name: 'forbidden', body: { __status: 403 } },
    { name: 'undeployed', body: { __status: 404 } },
    { name: 'unavailable', body: { __status: 503 } },
    { name: 'empty response', body: '' },
    { name: 'empty status', body: '<dashboardStatus/>' },
    { name: 'wrong channel', body: statusXml().replaceAll('c-started', 'other') },
    { name: 'wrong child channel', body: statusXml().replace('<dashboardStatus><channelId>c-started</channelId><name>Selected', '<dashboardStatus><channelId>other</channelId><name>Selected') },
    { name: 'malformed destination collection', body: statusXml([], false).replace('<childStatuses></childStatuses>', '<childStatuses>invalid</childStatuses>') },
    { name: 'invalid destination', body: statusXml().replace('<metaDataId>3</metaDataId>', '<metaDataId>invalid</metaDataId>') },
    { name: 'duplicate destination', body: statusXml().replace('<metaDataId>7</metaDataId>', '<metaDataId>3</metaDataId>') },
    { name: 'missing destinations', body: '<dashboardStatus><channelId>c-started</channelId><statusType>CHANNEL</statusType></dashboardStatus>' },
    { name: 'missing name', body: statusXml().replace('<name>Selected</name>', '') },
    { name: 'wrong connector type', body: statusXml().replaceAll('DESTINATION_CONNECTOR', 'CHAIN') },
    { name: 'malformed XML', body: '<dashboardStatus>' },
]) {
    test(`F07: ${failure.name} deployed discovery blocks sending and can be retried`, async ({ page }) => {
        await page.route('**/vendor/monaco/**', route => route.abort());
        let sends = 0, statusReads = 0;
        await mockEngine(page, {
            'GET /channels/c-started/status': () => ++statusReads === 1 ? failure.body : statusXml(),
            'POST /channels/c-started/messagesWithObj': () => { sends++; return { long: 1 }; },
        });
        await page.goto('/dashboard');
        await page.getByText('Demo Started', { exact: true }).first().click();
        await page.getByRole('button', { name: 'Send Message', exact: true }).click();
        const error = page.getByRole('dialog', { name: 'Unable to Load Destinations', exact: true });
        await expect(error).toBeVisible();
        await expect(page.getByRole('button', { name: 'Process Message', exact: true })).toHaveCount(0);
        expect(sends).toBe(0);
        expect(statusReads).toBe(1);
        await error.getByRole('button', { name: 'Retry', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Message', exact: true });
        await expect(dialog.getByRole('row', { name: 'Selected', exact: true })).toBeVisible();
        await expect(dialog.getByRole('row', { name: 'Excluded', exact: true })).toBeVisible();
        expect(statusReads).toBe(2);
        expect(sends).toBe(0);
    });
}

for (const origin of ['dashboard', 'messages/c-started']) {
    for (const selection of ['all', 'subset', 'none']) {
        test(`F07: ${origin} sends ${selection} using deployed destinations despite saved additions, removals and renames`, async ({ page }) => {
            await page.route('**/vendor/monaco/**', route => route.abort());
            let sends = 0, statusReads = 0;
            await mockEngine(page, {
                'GET /channels/c-started/connectorNames': { map: { entry: [
                    { int: 0, string: 'Source' }, { int: 3, string: 'Renamed since deployment' }, { int: 9, string: 'Not deployed yet' }
                ] } },
                'GET /channels/c-started/status': () => { statusReads++; return statusXml([
                    { id: 3, name: 'Deployed name' }, { id: 7, name: 'Removed from saved channel' }
                ]); },
                'POST /channels/c-started/messagesWithObj': (request: any) => {
                    sends++;
                    const raw = request.postDataJSON()['com.mirth.connect.donkey.model.message.RawMessage'];
                    if (selection === 'all') expect(raw).not.toHaveProperty('destinationMetaDataIds');
                    else expect(raw.destinationMetaDataIds.int).toEqual(selection === 'subset' ? [7] : []);
                    return { long: 1 };
                },
            });
            await page.goto(`/${origin}`);
            if (origin === 'dashboard') await page.getByText('Demo Started', { exact: true }).first().click();
            await page.getByRole('button', { name: 'Send Message', exact: true }).click();
            const dialog = page.getByRole('dialog', { name: 'Message', exact: true });
            await expect(dialog.getByRole('row', { name: 'Deployed name', exact: true })).toBeVisible();
            await expect(dialog.getByRole('row', { name: 'Removed from saved channel', exact: true })).toBeVisible();
            await expect(dialog.getByText('Renamed since deployment', { exact: true })).toHaveCount(0);
            await expect(dialog.getByText('Not deployed yet', { exact: true })).toHaveCount(0);
            await dialog.locator('textarea.ce-area').fill('Deployment parity');
            if (selection !== 'all') await dialog.getByRole('row', { name: 'Deployed name', exact: true }).getByRole('checkbox').uncheck();
            if (selection === 'none') await dialog.getByRole('row', { name: 'Removed from saved channel', exact: true }).getByRole('checkbox').uncheck();
            await dialog.getByRole('button', { name: 'Process Message', exact: true }).click();
            await expect(dialog).toHaveCount(0);
            expect(sends).toBe(1);
            expect(statusReads).toBe(1);
        });
    }
}

test('F07: deployed destination labels retain scalar-looking and escaped text', async ({ page }) => {
    await page.route('**/vendor/monaco/**', route => route.abort());
    const labels = ['123', 'false', 'null', '123.0', '1e3', '001', 'A < B & C'];
    await mockEngine(page, {
        'GET /channels/c-started/status': statusXml(labels.map((name, index) => ({ id: index + 1, name }))),
    });
    await page.goto('/dashboard');
    await page.getByText('Demo Started', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Send Message', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Message', exact: true });
    for (const name of labels) await expect(dialog.getByRole('row', { name, exact: true })).toBeVisible();
    await expect(dialog.getByRole('checkbox')).toHaveCount(labels.length);
});

for (const source of [true, false]) {
    test(`F07: a channel with ${source ? 'one source and no destinations' : 'an empty child status collection'} uses Swing's all-destinations contract`, async ({ page }) => {
        await page.route('**/vendor/monaco/**', route => route.abort());
        let sends = 0;
        await mockEngine(page, {
            'GET /channels/c-started/status': statusXml([], source),
            'POST /channels/c-started/messagesWithObj': (request: any) => {
                sends++;
                expect(request.postDataJSON()['com.mirth.connect.donkey.model.message.RawMessage']).not.toHaveProperty('destinationMetaDataIds');
                return { long: 1 };
            },
        });
        await page.goto('/dashboard');
        await page.getByText('Demo Started', { exact: true }).first().click();
        await page.getByRole('button', { name: 'Send Message', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Message', exact: true });
        await expect(dialog.getByRole('checkbox')).toHaveCount(0);
        await dialog.locator('textarea.ce-area').fill('Source only');
        await dialog.getByRole('button', { name: 'Process Message', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        expect(sends).toBe(1);
    });
}

for (const retry of [false, true]) {
    test(`expired destination discovery ${retry ? 'retry' : 'request'} does not reopen a dialog over sign-in`, async ({ page }) => {
        let discoveries = 0, sends = 0;
        await mockEngine(page, {
            'GET /channels/c-started/status': () => ({ __status: ++discoveries === 1 && retry ? 503 : 401 }),
            'POST /channels/c-started/messagesWithObj': () => { sends++; return { long: 1 }; },
        });
        await page.goto('/messages/c-started');
        await page.getByRole('button', { name: 'Send Message', exact: true }).click();
        if (retry) {
            const failed = page.getByRole('dialog', { name: 'Unable to Load Destinations', exact: true });
            await expect(failed).toBeVisible();
            await failed.getByRole('button', { name: 'Retry', exact: true }).click();
        }
        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
        await expect(page.locator('.shell')).toHaveCount(0);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect(discoveries).toBe(retry ? 2 : 1);
        expect(sends).toBe(0);
    });
}

for (const result of ['success', 'failure', 'cookie-change']) {
    test(`late destination discovery ${result} cannot reopen a previous session's dialog`, async ({ page }) => {
        await mockEngine(page, { 'GET /session-expiry-probe': { __status: 401 }, 'GET /users/current': (request: any) => request.headers()['x-oie-context']?.includes('replacement-session') ? { __status: 401 } : { user: { id: 1, username: 'admin' } } });
        let started = false;
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        await page.route('**/api/channels/c-started/status', async route => {
            started = true;
            await gate;
            await route.fulfill(result === 'failure' ? { status: 503, body: 'discovery unavailable' }
                : { contentType: 'application/xml', body: statusXml() });
        });
        await page.goto('/messages/c-started');
        await page.getByRole('button', { name: 'Send Message', exact: true }).click();
        await expect.poll(() => started).toBe(true);
        if (result === 'cookie-change') {
            await page.evaluate(() => { document.cookie = 'oie-login=replacement-session; path=/'; });
        } else {
            await page.evaluate(async () => {
                const api = await import(String('/core/api.js'));
                await api.get('/session-expiry-probe').catch(() => {});
            });
            await expect(page.locator('.shell')).toHaveCount(0);
        }
        const response = page.waitForResponse('**/api/channels/c-started/status');
        release();
        await response;
        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
        // Let the rejected response's catch continuation run before checking absence.
        await page.waitForTimeout(150);
        await expect(page.getByRole('dialog')).toHaveCount(0);
    });
}

test('dashboard lazy Send module cannot start discovery after its initiating session expires', async ({ page }) => {
    let discoveries = 0, loading = false;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await mockEngine(page, {
        'GET /session-expiry-probe': { __status: 401 }, 'GET /users/current': (request: any) => request.headers()['x-oie-context']?.includes('replacement-session') ? { __status: 401 } : { user: { id: 1, username: 'admin' } },
        'GET /channels/c-started/status': () => { discoveries++; return statusXml(); },
    });
    await page.route('**/assets/messages-*.js', async route => {
        const response = await route.fetch();
        loading = true;
        await gate;
        await route.fulfill({ response });
    });
    await page.goto('/dashboard');
    await page.getByText('Demo Started', { exact: true }).click();
    await page.getByRole('button', { name: 'Send Message', exact: true }).click();
    await expect.poll(() => loading).toBe(true);
    await page.evaluate(async () => {
        const api = await import(String('/core/api.js'));
        await api.get('/session-expiry-probe').catch(() => {});
    });
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    const response = page.waitForResponse('**/assets/messages-*.js');
    release();
    await response;
    await page.waitForTimeout(150);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(discoveries).toBe(0);
});
