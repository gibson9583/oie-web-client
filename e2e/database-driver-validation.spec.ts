import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { CASES, makeChannel } from './connector-fixtures.js';

const databases = [
    { name: 'Database Reader', mode: 'SOURCE', sql: 'select' },
    { name: 'Database Writer', mode: 'DESTINATION', sql: 'query' },
];

async function openDatabase(page: any, database: typeof databases[number], driver: string, overrides: Record<string, unknown> = {}) {
    const id = `driver-validation-${database.mode.toLowerCase()}`;
    const properties = { ...CASES.find(c => c.name === database.name)!.properties(), driver, ...overrides };
    const channel = makeChannel(id, {
        [database.mode === 'SOURCE' ? 'source' : 'destination']: { transportName: database.name, properties },
    });
    const writes: any[] = [];
    await mockEngine(page, {
        [`GET /channels/${id}`]: { channel },
        [`PUT /channels/${id}`]: (request: any) => { writes.push(request.postDataJSON().channel); return ''; },
        'GET /server/databaseDrivers': {
            list: { driverInfo: [{ name: 'PostgreSQL', className: 'org.postgresql.Driver' }] },
        },
    });
    await page.goto(`/channels/${id}/edit`);
    // Make Save actionable before returning to the active connector panel.
    await page.locator('.panel input[type=text]').first().fill('Driver validation edited');
    await page.getByRole('tab', { name: database.mode === 'SOURCE' ? 'Source' : 'Destinations', exact: true }).click();
    if (database.mode === 'DESTINATION') await page.getByRole('cell', { name: database.name, exact: true }).first().click();
    await expect(page.locator('[data-fkey="url"]')).toBeVisible();
    return { writes, id };
}

async function expectDriverBlocked(page: any, writes: any[], action: string) {
    await page.getByRole('button', { name: action, exact: true }).click();
    const dialog = page.getByRole('dialog', {
        name: action === 'Validate Connector' ? 'Validation Errors' : 'Cannot Save Channel', exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('li')).toHaveCount(1);
    await expect(dialog.locator('li')).toContainText('Driver is required');
    await expect(page.locator('[data-fkey="driver"]')).toHaveClass(/cform-invalid/);
    await expect(page.locator('[data-fkey="url"]')).not.toHaveClass(/cform-invalid/);
    expect(writes).toHaveLength(0);
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(dialog).toHaveCount(0);
}

for (const database of databases) {
    test(`${database.name}: SQL placeholder blocks Validate and Save before any PUT`, async ({ page }) => {
        const { writes } = await openDatabase(page, database, 'Please Select One');
        for (const action of ['Validate Connector', 'Save Changes']) {
            await page.getByRole('button', { name: action, exact: true }).click();
            const warning = page.getByRole('dialog').filter({ hasText: 'Driver is required' });
            await expect(warning).toContainText('Driver is required');
            expect(writes).toHaveLength(0);
            await warning.getByRole('button', { name: /^(OK|Close)$/, exact: true }).last().click();
        }
    });

    test(`${database.name}: an unlisted real driver class round-trips unchanged`, async ({ page }) => {
        const driver = 'org.example.CustomDriver';
        const { writes } = await openDatabase(page, database, driver);
        await expect(page.locator('select').filter({ has: page.locator(`option[value="${driver}"]`) })).toHaveValue(driver);
        await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect.poll(() => writes.length).toBe(1);
        const saved = database.mode === 'SOURCE' ? writes[0].sourceConnector : writes[0].destinationConnectors.connector[0];
        expect(saved.properties.driver).toBe(driver);
    });

    for (const useScript of [true, 'true']) {
        test(`${database.name}: JavaScript ${typeof useScript} mode requires Driver, permits blank URL, and clears the corrected marker`, async ({ page }) => {
            const missingDriver = typeof useScript === 'boolean' ? 'Please Select One' : '';
            const script = database.mode === 'SOURCE' ? 'return [];' : 'return true;';
            const { writes } = await openDatabase(page, database, missingDriver, {
                useScript, url: '', [database.sql]: script,
            });
            await expect(page.locator('[data-fkey="useScript"]').getByRole('radio', { name: 'Yes', exact: true })).toBeChecked();
            await expect(page.locator('[data-fkey="url"]')).toHaveValue('');
            for (const action of ['Validate Connector', 'Save Changes']) {
                await expectDriverBlocked(page, writes, action);
            }

            const field = page.locator('[data-fkey="driver"]');
            const select = field.locator('select');
            await select.focus();
            await expect(field).toHaveClass(/cform-invalid/);
            await expect(select.locator('option[value="org.postgresql.Driver"]')).toHaveCount(1);
            await select.selectOption({ label: 'PostgreSQL' });
            await page.getByRole('button', { name: 'Validate Connector', exact: true }).click();
            await expect(page.getByText('Connector configuration is valid', { exact: true })).toBeVisible();
            await expect(field).not.toHaveClass(/cform-invalid/);
            await expect(page.locator('.cform-invalid[data-fkey]')).toHaveCount(0);
            await expect(page.locator('[data-fkey="url"]')).toHaveValue('');
            expect(writes).toHaveLength(0);

            await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
            await expect.poll(() => writes.length).toBe(1);
            const saved = database.mode === 'SOURCE' ? writes[0].sourceConnector : writes[0].destinationConnectors.connector[0];
            expect(saved.properties.driver).toBe('org.postgresql.Driver');
            expect(saved.properties.url).toBe('');
            expect(saved.properties.useScript).toBe(useScript);
            expect(saved.properties[database.sql]).toBe(script);
        });
    }

    test(`${database.name}: switching SQL to JavaScript keeps Driver required while removing the URL requirement`, async ({ page }) => {
        const { writes } = await openDatabase(page, database, 'Please Select One');
        await expectDriverBlocked(page, writes, 'Validate Connector');
        await page.locator('[data-fkey="useScript"]').getByRole('radio', { name: 'Yes', exact: true }).check();
        await page.locator('[data-fkey="url"]').fill('');
        await page.locator('[data-fkey="url"]').blur();
        for (const action of ['Validate Connector', 'Save Changes']) {
            await expectDriverBlocked(page, writes, action);
        }
    });
}

test('SQL and script modes validate drivers consistently for both boolean wire shapes', async ({ page }) => {
    await openDatabase(page, databases[0], 'org.example.Driver');
    const results = await page.evaluate(async () => {
        const pkg = '@oie/web-shell';
        const { platform } = await import(pkg);
        const rows: Array<{ name: string; useScript: boolean | string; driver: string; errors: string[] }> = [];
        for (const [name, mode, sql] of [['Database Reader', 'SOURCE', 'select'], ['Database Writer', 'DESTINATION', 'query']]) {
            const def = platform.connectorPanel(name, mode);
            for (const useScript of [false, 'false', true, 'true']) {
                for (const driver of [undefined, null, '', '  ', 'Please Select One', 'org.postgresql.Driver', 'org.example.CustomDriver']) {
                    const script = useScript === true || useScript === 'true';
                    const properties = { ...def.defaults('4.6.0'), driver, useScript, url: script ? '' : 'jdbc:test', [sql]: 'SELECT 1' };
                    rows.push({ name, useScript, driver: String(driver), errors: def.validate(properties).map((error: any) => error.key) });
                }
            }
        }
        return rows;
    });
    expect(results).toHaveLength(56);
    for (const result of results) {
        const realDriver = result.driver.startsWith('org.');
        expect(result.errors, JSON.stringify(result)).toEqual(realDriver ? [] : ['driver']);
    }
});
