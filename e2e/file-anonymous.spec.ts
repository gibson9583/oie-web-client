import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { CASES, makeChannel } from './connector-fixtures.js';

for (const [name, mode] of [['File Reader', 'SOURCE'], ['File Writer', 'DESTINATION']]) {
    const id = `anonymous-${mode.toLowerCase()}`;
    const propertiesOf = (channel: any) => mode === 'SOURCE' ? channel.sourceConnector.properties
        : ([] as any[]).concat(channel.destinationConnectors.connector)[0].properties;

    async function open(page: any, overrides: any = {}) {
        const fixture = CASES.find(c => c.name === name)!;
        const properties = { ...fixture.properties(), host: 'files.example/incoming', anonymous: false,
            username: 'operator', password: 'secret', ...overrides };
        let channel = makeChannel(id, mode === 'SOURCE'
            ? { source: { transportName: name, properties } }
            : { destination: { transportName: name, properties } });
        const writes: any[] = [];
        await mockEngine(page, {
            [`GET /channels/${id}`]: () => ({ channel }),
            [`PUT /channels/${id}`]: (req: any) => {
                channel = JSON.parse(req.postData()).channel;
                writes.push(structuredClone(channel));
                return 'true';
            },
        });
        await page.goto(`/channels/${id}/edit`);
        await page.getByRole('tab', { name: mode === 'SOURCE' ? 'Source' : 'Destinations', exact: true }).click();
        if (mode === 'DESTINATION') await page.getByRole('cell', { name, exact: true }).first().click();
        await expect(page.locator('[data-fkey="scheme"]')).toBeVisible();
        return writes;
    }

    test(`${name}: anonymous FTP/WebDAV credentials survive saves and scheme changes; S3 stays blank`, async ({ page }) => {
        const writes = await open(page);
        const scheme = page.locator('[data-fkey="scheme"]');
        const username = page.locator('[data-fkey="username"]');
        const password = page.locator('[data-fkey="password"]');
        await scheme.selectOption('FTP');
        await expect(username).toHaveValue('operator');
        await page.locator('[data-fkey="anonymous"]').getByRole('radio', { name: 'Yes', exact: true }).check();
        for (const [index, next] of ['FTP', 'WEBDAV', 'S3', 'FTP'].entries()) {
            if (index) await scheme.selectOption(next);
            const credential = next === 'S3' ? '' : 'anonymous';
            await expect(username).toHaveValue(credential);
            await expect(password).toHaveValue(credential);
            await expect(username).toBeDisabled();
            await expect(password).toBeDisabled();
            await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
            await expect.poll(() => writes.length).toBe(index + 1);
            expect(propertiesOf(writes[index])).toMatchObject({ scheme: next, anonymous: true,
                username: credential, password: credential });
        }
        await page.locator('[data-fkey="anonymous"]').getByRole('radio', { name: 'No', exact: true }).check();
        await expect(username).toBeEnabled();
        await username.fill('named-user');
        await password.fill('named-password');
        await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect.poll(() => writes.length).toBe(5);
        expect(propertiesOf(writes[4])).toMatchObject({ anonymous: false, username: 'named-user', password: 'named-password' });
    });

    test(`${name}: loaded string-boolean anonymous settings preserve custom credentials until toggled`, async ({ page }) => {
        const writes = await open(page, { scheme: 'WEBDAV', anonymous: 'true', username: 'anonymous', password: 'contact@example.test' });
        await expect(page.locator('[data-fkey="password"]')).toHaveValue('contact@example.test');
        await page.getByRole('tab', { name: 'Summary', exact: true }).click();
        await page.locator('.panel input[type=text]').first().fill('Preserve imported credentials');
        await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect.poll(() => writes.length).toBe(1);
        expect(propertiesOf(writes[0])).toMatchObject({ anonymous: 'true', username: 'anonymous', password: 'contact@example.test' });
        const defaults = await page.evaluate(async ({ name, mode }) => {
            const { platform } = await import(String('/core/platform.js'));
            return platform.connectorPanel(name, mode)!.defaults('4.6.0');
        }, { name, mode });
        expect(defaults).toMatchObject({ username: 'anonymous', password: 'anonymous', anonymous: true });
    });

    test(`${name}: saving legacy blank anonymous FTP credentials repairs both fields`, async ({ page }) => {
        const writes = await open(page, { scheme: 'FTP', anonymous: 'true', username: '', password: '' });
        await page.getByRole('tab', { name: 'Summary', exact: true }).click();
        await page.locator('.panel input[type=text]').first().fill('Repair legacy File credentials');
        await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect.poll(() => writes.length).toBe(1);
        expect(propertiesOf(writes[0])).toMatchObject({ anonymous: 'true', username: 'anonymous', password: 'anonymous' });
    });

    test(`${name}: stale SFTP Anonymous flag does not overwrite named credentials on scheme change`, async ({ page }) => {
        const writes = await open(page, { scheme: 'SFTP', anonymous: true, username: 'named-user', password: 'named-password' });
        const scheme = page.locator('[data-fkey="scheme"]');
        await scheme.selectOption('FTP');
        await expect(page.locator('[data-fkey="anonymous"]').getByRole('radio', { name: 'No', exact: true })).toBeChecked();
        await expect(page.locator('[data-fkey="username"]')).toHaveValue('named-user');
        await expect(page.locator('[data-fkey="password"]')).toHaveValue('named-password');
        await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect.poll(() => writes.length).toBe(1);
        expect(propertiesOf(writes[0])).toMatchObject({ scheme: 'FTP', anonymous: false,
            username: 'named-user', password: 'named-password' });
        await scheme.selectOption('SMB');
        await expect(page.locator('[data-fkey="anonymous"]').getByRole('radio', { name: 'No', exact: true })).toBeChecked();
        await expect(page.locator('[data-fkey="username"]')).toHaveValue('named-user');
        await expect(page.locator('[data-fkey="password"]')).toHaveValue('named-password');
    });

    test(`${name}: stale SFTP Anonymous flag cannot bypass required credentials`, async ({ page }) => {
        const writes = await open(page, { scheme: 'SFTP', anonymous: true, username: '', password: '' });
        await page.getByRole('button', { name: 'Validate Connector', exact: true }).click();
        const errors = page.getByRole('dialog', { name: 'Validation Errors', exact: true });
        await expect(errors).toContainText('Username');
        await expect(errors).toContainText('Password');
        expect(writes).toHaveLength(0);
    });
}
