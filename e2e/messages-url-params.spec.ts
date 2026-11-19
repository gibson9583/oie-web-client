import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

const CID = 'c-started';

const MESSAGE = {
    messageId: '12345',
    channelId: CID,
    serverId: 's1',
    receivedDate: { time: 1700000000000 },
    processed: true,
    connectorMessages: {
        entry: [
            {
                int: 0,
                connectorMessage: {
                    metaDataId: 0,
                    connectorName: 'Source',
                    status: 'RECEIVED',
                    receivedDate: { time: 1700000000000 },
                },
            },
            {
                int: 1,
                connectorMessage: {
                    metaDataId: 1,
                    connectorName: 'HTTP Sender',
                    status: 'ERROR',
                    receivedDate: { time: 1700000001000 },
                },
            },
        ],
    },
};

function setupMessagesMock(page: any, onSearch?: (params: URLSearchParams) => void) {
    return mockEngine(page, {
        [`GET /channels/${CID}/messages`]: (req: any) => {
            const sp = new URL(req.url()).searchParams;
            onSearch?.(sp);
            const offset = Number(sp.get('offset') || 0);
            return { list: { message: offset > 0 ? [] : [MESSAGE] } };
        },
        [`GET /channels/${CID}/messages/maxMessageId`]: { long: 12345 },
        [`GET /channels/${CID}/messages/count`]: { long: 1 },
        [`GET /channels/${CID}/connectorNames`]: {
            map: {
                entry: [
                    { int: 0, string: 'Source' },
                    { int: 1, string: 'HTTP Sender' },
                    { int: 2, string: 'Archive Writer' },
                ],
            },
        },
        [`GET /channels/${CID}/metaDataColumns`]: '',
        'GET /channels/idsAndNames': { map: { entry: [{ string: [CID, 'Demo Started'] }] } },
    });
}

test('single metaDataId selects the toolbar Connector dropdown and does not mark Advanced active', async ({ page }) => {
    const searches: URLSearchParams[] = [];
    await setupMessagesMock(page, sp => searches.push(sp));
    await page.setViewportSize({ width: 1500, height: 800 });

    await page.goto(`/messages/${CID}?metaDataId=1`);
    await expect(page.getByText('12345', { exact: true })).toBeVisible();

    const connectorSelect = page.locator('.field', { has: page.locator('label', { hasText: 'Connector' }) }).locator('select');
    await expect(connectorSelect).toHaveValue('1');

    const advBtn = page.getByRole('button', { name: 'Advanced…', exact: true });
    await expect(advBtn.locator('.bg-accent')).toHaveCount(0);

    expect(searches.length).toBeGreaterThan(0);
    expect(searches[0].getAll('includedMetaDataId')).toEqual(['1']);
    await expect(page.getByText(/Connectors: HTTP Sender/)).toBeVisible();
});

test('metaDataId + status (comma-separated and repeated) pre-fill toolbar controls and execute on load', async ({ page }) => {
    const searches: URLSearchParams[] = [];
    await setupMessagesMock(page, sp => searches.push(sp));
    await page.setViewportSize({ width: 1500, height: 800 });

    await page.goto(`/messages/${CID}?metaDataId=0&status=ERROR,QUEUED`);
    await expect(page.getByText('12345', { exact: true })).toBeVisible();

    const connectorSelect = page.locator('.field', { has: page.locator('label', { hasText: 'Connector' }) }).locator('select');
    await expect(connectorSelect).toHaveValue('0');

    const statusTrigger = page.locator('.field', { has: page.locator('label', { hasText: 'Status' }) }).locator('button');
    await expect(statusTrigger).toContainText('2 selected');

    expect(searches[0].getAll('includedMetaDataId')).toEqual(['0']);
    expect(searches[0].getAll('status')).toEqual(['ERROR', 'QUEUED']);
    await expect(page.getByText(/Statuses: ERROR, QUEUED/)).toBeVisible();
    await expect(page.getByText(/Connectors: Source/)).toBeVisible();
});

test('startDate, endDate, textSearch, and textSearchRegex pre-fill toolbar inputs and execute on load', async ({ page }) => {
    const searches: URLSearchParams[] = [];
    await setupMessagesMock(page, sp => searches.push(sp));
    await page.setViewportSize({ width: 1500, height: 800 });

    await page.goto(
        `/messages/${CID}?startDate=2026-11-17T00:00&endDate=2026-11-17T23:59&textSearch=%5EMSH&textSearchRegex=true`
    );
    await expect(page.getByText('12345', { exact: true })).toBeVisible();

    await expect(page.getByPlaceholder('Search message content…')).toHaveValue('^MSH');
    await expect(page.locator('.msg-regex input[type="checkbox"]')).toBeChecked();

    expect(searches[0].get('textSearch')).toBe('^MSH');
    expect(searches[0].get('textSearchRegex')).toBe('true');
    expect(searches[0].get('startDate')).toMatch(/^2026-11-17T00:00:00\.000/);
    expect(searches[0].get('endDate')).toMatch(/^2026-11-17T23:59:00\.000/);
    await expect(page.getByText(/Text Search: "\^MSH" \(regex\)/)).toBeVisible();
});

test('scalar and boolean Advanced params pre-fill the Advanced dialog, light up the indicator, and execute on load', async ({ page }) => {
    const searches: URLSearchParams[] = [];
    await setupMessagesMock(page, sp => searches.push(sp));
    await page.setViewportSize({ width: 1500, height: 800 });

    await page.goto(
        `/messages/${CID}?minMessageId=100&maxMessageId=500&minOriginalId=40&maxOriginalId=42&minImportId=10&maxImportId=20&serverId=srv-99&excludedMetaDataId=0&minSendAttempts=1&maxSendAttempts=5&attachment=true&error=true`
    );
    await expect(page.getByText('12345', { exact: true })).toBeVisible();

    const advBtn = page.getByRole('button', { name: 'Advanced…', exact: true });
    await expect(advBtn.locator('.bg-accent')).toHaveCount(1);

    const sp = searches[0];
    expect(sp.get('minMessageId')).toBe('100');
    expect(sp.get('maxMessageId')).toBe('500');
    expect(sp.get('minOriginalId')).toBe('40');
    expect(sp.get('maxOriginalId')).toBe('42');
    expect(sp.get('minImportId')).toBe('10');
    expect(sp.get('maxImportId')).toBe('20');
    expect(sp.get('serverId')).toBe('srv-99');
    expect(sp.getAll('excludedMetaDataId')).toEqual(['0']);
    expect(sp.get('minSendAttempts')).toBe('1');
    expect(sp.get('maxSendAttempts')).toBe('5');
    expect(sp.get('attachment')).toBe('true');
    expect(sp.get('error')).toBe('true');

    await advBtn.click();
    const dialog = page.getByRole('dialog', { name: 'Advanced Search Filter', exact: true });
    const numInputs = dialog.locator('input[type="number"]');
    await expect(numInputs.nth(0)).toHaveValue('100');
    await expect(numInputs.nth(1)).toHaveValue('500');
    await expect(numInputs.nth(2)).toHaveValue('40');
    await expect(numInputs.nth(3)).toHaveValue('42');
    await expect(numInputs.nth(4)).toHaveValue('10');
    await expect(numInputs.nth(5)).toHaveValue('20');
    await expect(numInputs.nth(6)).toHaveValue('1');
    await expect(numInputs.nth(7)).toHaveValue('5');
    await expect(dialog.getByLabel('Has Attachment')).toBeChecked();
    await expect(dialog.getByLabel('Has Error')).toBeChecked();
});

test('route change re-hydrates criteria and invalid parameters are ignored safely', async ({ page }) => {
    const searches: URLSearchParams[] = [];
    await setupMessagesMock(page, sp => searches.push(sp));
    await page.setViewportSize({ width: 1500, height: 800 });

    await page.goto(`/messages/${CID}?metaDataId=invalid&status=UNKNOWN&startDate=bad-date&minMessageId=-9`);
    await expect(page.getByText('12345', { exact: true })).toBeVisible();

    const connectorSelect = page.locator('.field', { has: page.locator('label', { hasText: 'Connector' }) }).locator('select');
    await expect(connectorSelect).toHaveValue('');
    const statusTrigger = page.locator('.field', { has: page.locator('label', { hasText: 'Status' }) }).locator('button');
    await expect(statusTrigger).toContainText('Any');

    // Navigate from inside the SPA to a filtered URL on the same route.
    await page.evaluate(async (cid: string) => {
        const router = await import('/core/router.js' as any);
        router.navigate(`/messages/${cid}?metaDataId=2&status=sent`);
    }, CID);

    await expect(connectorSelect).toHaveValue('2');
    await expect(statusTrigger).toContainText('SENT');
    await expect(page.getByText(/Connectors: Archive Writer/)).toBeVisible();
    await expect(page.getByText(/Statuses: SENT/)).toBeVisible();
    expect(searches.at(-1)?.getAll('includedMetaDataId')).toEqual(['2']);
    expect(searches.at(-1)?.getAll('status')).toEqual(['SENT']);
});

