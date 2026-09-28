import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { CASES, makeChannel } from './connector-fixtures.js';

interface HighlightCase { name: string; keys: string[]; extras?: Record<string, unknown>; }
const cases: HighlightCase[] = [
    { name: 'JavaScript Reader', keys: ['script'] },
    { name: 'JavaScript Writer', keys: ['script'] },
    { name: 'Database Reader', keys: ['select', 'update'], extras: { updateMode: 3 } },
    { name: 'Database Writer', keys: ['query'] },
    ...['File Writer', 'TCP Sender', 'DICOM Sender', 'JMS Sender', 'Document Writer'].map(name => ({ name, keys: ['template'] })),
    { name: 'Web Service Sender', keys: ['wsdlUrl', 'service', 'port', 'envelope'] },
    ...['HTTP Listener', 'TCP Listener', 'Web Service Listener', 'DICOM Listener'].map(name => ({ name, keys: ['listenerConnectorProperties.host'] })),
];

async function openPanel(page: any, spec: HighlightCase, { fallback = true, fixtures = {} }: { fallback?: boolean; fixtures?: Record<string, any> } = {}) {
    if (fallback) await page.route('**/vendor/monaco/**', (route: any) => route.abort());
    const c = CASES.find(candidate => candidate.name === spec.name)!;
    const properties: Record<string, any> = { ...c.properties(), ...spec.extras };
    for (const key of spec.keys) {
        const parts = key.split('.');
        let target = properties;
        for (const part of parts.slice(0, -1)) target = target[part];
        target[parts.at(-1)!] = '';
    }
    const id = `highlight-${spec.name.toLowerCase().replace(/\s+/g, '-')}`;
    const channel = makeChannel(id, {
        [c.mode === 'SOURCE' ? 'source' : 'destination']: { transportName: c.name, properties },
    });
    const writes: any[] = [];
    await mockEngine(page, {
        [`GET /channels/${id}`]: { channel },
        [`PUT /channels/${id}`]: (request: any) => { writes.push(request.postDataJSON()); return ''; },
        ...fixtures,
    });
    await page.goto(`/channels/${id}/edit`);
    await page.locator('.panel input[type=text]').first().fill('Required fields edited');
    await page.getByRole('tab', { name: c.mode === 'SOURCE' ? 'Source' : 'Destinations', exact: true }).click();
    if (c.mode === 'DESTINATION') await page.getByRole('cell', { name: c.name, exact: true }).first().click();
    await expect(page.locator('.cform-section').first()).toBeVisible();
    return { writes };
}

async function validate(page: any, action = 'Validate Connector') {
    await page.getByRole('button', { name: action, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: action === 'Validate Connector' ? 'Validation Errors' : 'Cannot Save Channel', exact: true });
    await expect(dialog).toBeVisible();
    return dialog;
}

async function highlighted(page: any) {
    return page.locator('.cform-invalid[data-fkey]').evaluateAll((elements: Element[]) => elements.map(el => el.getAttribute('data-fkey')).sort());
}

for (const spec of cases) {
    test(`${spec.name}: Save and Validate mark every required control on the active form`, async ({ page }, testInfo) => {
        const { writes } = await openPanel(page, spec);
        for (const action of ['Validate Connector', 'Save Changes']) {
            const dialog = await validate(page, action);
            expect(await highlighted(page)).toEqual([...spec.keys].sort());
            await expect(dialog.locator('li')).toHaveCount(spec.keys.length);
            for (const key of spec.keys) {
                const control = page.locator(`[data-fkey="${key}"]`);
                await expect(control).toBeVisible();
                if (await control.evaluate((el: Element) => el.classList.contains('cform-code'))) {
                    await expect(control).toHaveCSS('outline-style', 'solid');
                    await expect(control).toHaveCSS('outline-width', '1px');
                    await expect(control.locator('textarea.ce-area')).toBeVisible();
                }
            }
            expect(writes).toHaveLength(0);
            await dialog.getByRole('button', { name: 'OK', exact: true }).click();
            if (spec.name === 'Web Service Sender' && action === 'Save Changes') {
                await page.locator('[data-fkey="wsdlUrl"]').scrollIntoViewIfNeeded();
                const screenshot = testInfo.outputPath('required-field-feedback.png');
                await page.screenshot({ path: screenshot });
                await testInfo.attach('required-field-feedback', { path: screenshot, contentType: 'image/png' });
            }
        }
    });
}

for (const name of ['Database Reader', 'Database Writer']) {
    for (const fail of [false, true]) {
        test(`${name}: driver error survives asynchronous ${fail ? 'fallback input' : 'select'} replacement`, async ({ page }) => {
            let release!: () => void;
            const gate = new Promise<void>(resolve => { release = resolve; });
            const { writes } = await openPanel(page, { name, keys: ['driver'] }, { fixtures: {
                'GET /server/databaseDrivers': async () => {
                    await gate;
                    return fail ? { __status: 500, body: { error: 'driver list unavailable' } }
                        : { list: { driverInfo: [{ name: 'PostgreSQL', className: 'org.postgresql.Driver' }] } };
                },
            } });
            try {
                const field = page.locator('[data-fkey="driver"]');
                await expect(field.locator('select option')).toHaveCount(1);
                const dialog = await validate(page);
                await expect(field).toHaveClass(/cform-invalid/);
                release();
                const input = field.locator(fail ? 'input' : 'select');
                if (fail) await expect(input).toBeVisible();
                else await expect(input.locator('option')).toHaveCount(2);
                await expect(field).toHaveClass(/cform-invalid/);
                await expect(input).toHaveCSS('border-top-color', await page.evaluate(() => { const sample = document.createElement('span'); sample.style.color = 'var(--err)'; document.body.appendChild(sample); const color = getComputedStyle(sample).color; sample.remove(); return color; }));
                expect(writes).toHaveLength(0);
                await dialog.getByRole('button', { name: 'OK', exact: true }).click();
                // Focusing a still-empty field must not hide an unresolved error.
                await input.focus();
                await expect(field).toHaveClass(/cform-invalid/);
                if (fail) { await input.fill('org.example.Driver'); await input.blur(); }
                else await input.selectOption('org.postgresql.Driver');
                await page.getByRole('button', { name: 'Validate Connector', exact: true }).click();
                await expect(page.getByText('Connector configuration is valid', { exact: true })).toBeVisible();
                expect(await highlighted(page)).toEqual([]);
            } finally { release(); }
        });
    }
}

test('Monaco code errors remain visible on focus and clear after successful revalidation', async ({ page }) => {
    await openPanel(page, { name: 'JavaScript Reader', keys: ['script'] }, { fallback: false });
    const host = page.locator('[data-fkey="script"]');
    await expect(host.locator('.monaco-editor')).toBeVisible();
    const dialog = await validate(page);
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await host.locator('.view-lines').click();
    await expect(host).toHaveClass(/cform-invalid/);
    await expect(host).toHaveCSS('outline-style', 'solid');
    await page.keyboard.type('return 1;');
    await page.getByRole('button', { name: 'Validate Connector', exact: true }).click();
    await expect(page.getByText('Connector configuration is valid', { exact: true })).toBeVisible();
    expect(await highlighted(page)).toEqual([]);
});

for (const [name, key] of [['JavaScript Reader', 'script'], ['Database Writer', 'query'], ['Web Service Sender', 'envelope']]) {
    test(`${name}: a corrected code field loses its error outline after a successful Save`, async ({ page }) => {
        const writes: any[] = [];
        await openPanel(page, { name, keys: [key] }, { fixtures: {
            [`PUT /channels/highlight-${name.toLowerCase().replace(/\s+/g, '-')}`]: (request: any) => { writes.push(request.postDataJSON()); return true; },
        } });
        const host = page.locator(`[data-fkey="${key}"]`);
        const dialog = await validate(page);
        await dialog.getByRole('button', { name: 'OK', exact: true }).click();
        await expect(host).toHaveClass(/cform-invalid/);
        await host.locator('textarea.ce-area').fill(key === 'envelope' ? '<soap>ok</soap>' : 'return true;');
        await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect.poll(() => writes.length).toBe(1);
        await expect(page.getByText('Saved Required fields edited', { exact: true })).toBeVisible();
        expect(await highlighted(page)).toEqual([]);
    });
}

test('listener compound address can be corrected to All interfaces and revalidated', async ({ page }) => {
    await openPanel(page, { name: 'HTTP Listener', keys: ['listenerConnectorProperties.host'] });
    const dialog = await validate(page);
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    await page.getByRole('radio', { name: 'All interfaces', exact: true }).check();
    await expect(page.locator('[data-fkey="listenerConnectorProperties.host"]')).toHaveValue('0.0.0.0');
    await page.getByRole('button', { name: 'Validate Connector', exact: true }).click();
    await expect(page.getByText('Connector configuration is valid', { exact: true })).toBeVisible();
    expect(await highlighted(page)).toEqual([]);
});
