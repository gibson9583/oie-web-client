import type { Page, Request } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { CASES, makeChannel } from './connector-fixtures.js';

// Number fields: numeric-only fields save integers, templatable fields keep any
// text the engine's Velocity replacer resolves.

const S3_TEMP = {
    scheme: 'S3', host: 'bucket', anonymous: false,
    schemeProperties: {
        '@class': 'com.mirth.connect.connectors.file.S3SchemeProperties',
        useDefaultCredentialProviderChain: true, useTemporaryCredentials: true, duration: 7200,
        region: 'us-east-1', customHeaders: { '@class': 'linked-hash-map' },
    },
};

async function open(page: Page, name: string, extras: Record<string, unknown>, id: string) {
    const spec = CASES.find(c => c.name === name)!;
    let stored = makeChannel(id, {
        [spec.mode === 'SOURCE' ? 'source' : 'destination']: { transportName: name, properties: { ...spec.properties(), ...extras } },
    });
    const writes: any[] = [];
    await mockEngine(page, {
        'GET /server/version': '4.7.0',
        [`GET /channels/${id}`]: () => ({ channel: stored }),
        [`PUT /channels/${id}`]: (request: Request) => { const c = request.postDataJSON().channel; writes.push(c); stored = c; return true; },
    });
    await page.goto(`/channels/${id}/edit`);
    await page.getByRole('tab', { name: spec.mode === 'SOURCE' ? 'Source' : 'Destinations', exact: true }).click();
    await expect(page.locator('.cform-section').first()).toBeVisible();
    const saved = () => spec.mode === 'SOURCE' ? writes.at(-1).sourceConnector.properties : writes.at(-1).destinationConnectors.connector[0].properties;
    return { writes, saved };
}

async function save(page: Page, writes: any[]) {
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
}

for (const name of ['File Reader', 'File Writer']) {
    for (const [typed, expected] of [['900.5', 900], ['900.', 900], ['900.0', 900], ['', 0], ['1800', 1800]] as const) {
        test(`${name}: S3 Duration ${JSON.stringify(typed)} saves the integer ${expected}`, async ({ page }) => {
            const { writes, saved } = await open(page, name, S3_TEMP, `s3-${name.replaceAll(' ', '-')}-${typed.length}`);
            const duration = page.locator('input[data-fkey="schemeProperties.duration"]');
            await duration.fill(typed);
            await duration.blur();
            await expect(duration).toHaveValue(String(expected));
            await save(page, writes);
            expect(saved().schemeProperties.duration).toBe(expected);
        });
    }

    test(`${name}: focusing a stored S3 Duration leaves the channel unchanged`, async ({ page }) => {
        await open(page, name, S3_TEMP, `s3-${name.replaceAll(' ', '-')}-focus`);
        const duration = page.locator('input[data-fkey="schemeProperties.duration"]');
        await duration.focus();
        await duration.blur();
        await expect(duration).toHaveValue('7200');
        await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toHaveCount(0);
    });

    test(`${name}: ArrowUp on a typed S3 Duration "900.5" saves the integer 901`, async ({ page }) => {
        const { writes, saved } = await open(page, name, S3_TEMP, `s3-key-${name.replaceAll(' ', '-')}`);
        const duration = page.locator('input[data-fkey="schemeProperties.duration"]');
        await duration.fill('900.5');
        await duration.press('ArrowUp');
        await save(page, writes);
        expect(saved().schemeProperties.duration).toBe(901);
    });

    for (const [typed, expected] of [['900.5', 900], ['', 0], ['-', 0]] as const) {
        test(`${name}: S3 Duration ${JSON.stringify(typed)} then Summary saves the integer ${expected}`, async ({ page }) => {
            const { writes, saved } = await open(page, name, S3_TEMP, `s3-tab-${name.replaceAll(' ', '-')}-${typed.length}`);
            await page.locator('input[data-fkey="schemeProperties.duration"]').fill(typed);
            await page.getByRole('tab', { name: 'Summary', exact: true }).click();
            await save(page, writes);
            expect(saved().schemeProperties.duration).toBe(expected);
        });
    }
}

for (const typed of ['.', '-']) {
    test(`TCP Sender: Buffer Size ${JSON.stringify(typed)} then Summary cannot be saved`, async ({ page }) => {
        const { writes } = await open(page, 'TCP Sender', {}, `buffer-tab-${typed.charCodeAt(0)}`);
        await page.locator('input[data-fkey="bufferSize"]').fill(typed);
        await page.getByRole('tab', { name: 'Summary', exact: true }).click();
        await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'Cannot Save Channel', exact: true })).toContainText('Buffer Size');
        expect(writes).toHaveLength(0);
    });
}

for (const [name, key, extras, value] of [
    ['HTTP Listener', 'responseStatusCode', {}, '#if($ok)200#else500#end'],
    ['TCP Sender', 'remotePort', { serverMode: 'false' }, '66${suffix}'],
    ['TCP Sender', 'remotePort', { serverMode: 'false' }, '#set($port = 6660)$port'],
] as const) {
    test(`${name}: typed template ${JSON.stringify(value)} survives arrows, blur and Save`, async ({ page }) => {
        const { writes, saved } = await open(page, name, extras, `typed-${key}-${value.length}`);
        const input = page.locator(`input[data-fkey="${key}"]`);
        await input.fill('');
        await input.pressSequentially(value);
        await input.press('ArrowUp');
        await input.press('ArrowDown');
        await input.blur();
        await expect(input).toHaveValue(value);
        await save(page, writes);
        expect(saved()[key]).toBe(value);
    });
}
