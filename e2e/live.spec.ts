import { test, expect } from '@playwright/test';
import { login } from './mock.js';

const configuredBase = new URL(process.env.E2E_BASE_URL || 'http://localhost:3030');
const appBase = configuredBase.pathname.replace(/\/$/, '').replace(/^\/$/, '');
const appPath = (path: string) => `${appBase}${path}`;

async function matchingChannels(page: any, apiBase: string, name: string) {
    return page.evaluate(async ({ base, channelName }: any) => {
        const response = await fetch(`${base}/channels`, {
            headers: { Accept: 'application/json', 'X-Requested-With': 'OpenAPI' }
        });
        if (!response.ok) throw new Error(`Channel cleanup list failed (${response.status})`);
        const body = await response.json();
        const raw = body?.list?.channel ?? body?.channel ?? [];
        const channels = Array.isArray(raw) ? raw : [raw];
        return channels
            .filter((candidate: any) => candidate?.name === channelName)
            .map((candidate: any) => ({ id: String(candidate.id), name: String(candidate.name) }));
    }, { base: apiBase, channelName: name });
}

async function removeMatchingChannels(page: any, apiBase: string, name: string) {
    const matches = await matchingChannels(page, apiBase, name);
    for (const channel of matches) {
        await page.evaluate(async ({ base, id }: any) => {
            const response = await fetch(`${base}/channels/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                headers: { Accept: 'application/json', 'X-Requested-With': 'OpenAPI' }
            });
            if (!response.ok) throw new Error(`Channel cleanup delete failed for ${id} (${response.status})`);
        }, { base: apiBase, id: channel.id });
    }
    const residual = await matchingChannels(page, apiBase, name);
    if (residual.length) throw new Error(`Channel cleanup left ${residual.length} matching channel(s)`);
}

/*
 * Opt-in smoke test against a REAL engine — runs only with E2E_LIVE=1, which
 * registers the `live` project (see playwright.config.js). No mocking: it drives
 * the actual engine through the web admin proxy. Start /oie + the web admin
 * first; see e2e/README.md. Credentials via E2E_USER / E2E_PASS (default admin).
 *
 * The write is intentionally disposable and undeployed: it proves authenticated
 * CRUD without changing the running engine after a successful smoke run.
 */
test('logs in and round-trips a disposable channel against a live engine', async ({ page }, testInfo) => {
    test.setTimeout(120_000); // real engine + cold plugin imports are intentionally slower than mocks
    const user = process.env.E2E_USER || 'admin';
    const pass = process.env.E2E_PASS || 'admin';
    const expectedEngine = process.env.E2E_EXPECT_ENGINE_VERSION || '4.6.0';
    const expectedClient = process.env.E2E_EXPECT_CLIENT_VERSION || '0.8.0';
    const expectedDeployment = process.env.E2E_EXPECT_DEPLOYMENT;
    // Stable across Playwright retries: a retry first removes any residue from
    // the failed attempt instead of hiding it behind a new timestamped name.
    const channelName = `OIE Web 08 smoke ${testInfo.parallelIndex}`;

    await page.goto(appPath('/'));
    // A prior session may already be active — only log in if prompted.
    const needsLogin = await page.getByRole('button', { name: 'Sign in' }).isVisible().catch(() => false);
    if (needsLogin) await login(page, user, pass);

    await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
    const apiBase = await page.locator('meta[name="oie-webadmin-api-base"]').getAttribute('content') || '/api';
    const identity = await page.evaluate(async ({ configPath, api }: any) => {
        const [configResponse, versionResponse] = await Promise.all([
            fetch(configPath, { headers: { Accept: 'application/json', 'X-Requested-With': 'OpenAPI' } }),
            fetch(`${api}/server/version`, { headers: { Accept: 'text/plain', 'X-Requested-With': 'OpenAPI' } })
        ]);
        if (!configResponse.ok) throw new Error(`Web client identity failed (${configResponse.status})`);
        if (!versionResponse.ok) throw new Error(`Engine identity failed (${versionResponse.status})`);
        return {
            config: await configResponse.json(),
            engineVersion: (await versionResponse.text()).trim()
        };
    }, { configPath: appPath('/webadmin/config.json'), api: apiBase });
    expect(identity.engineVersion).toBe(expectedEngine);
    expect(identity.config.version).toBe(expectedClient);
    if (expectedDeployment) expect(identity.config.deployment).toBe(expectedDeployment);

    // Idempotent preflight also proves a prior interrupted run did not leave an
    // undeletable resource before this attempt performs its representative write.
    await removeMatchingChannels(page, apiBase, channelName);

    let createdId: string | null = null;
    let primaryFailure: unknown = null;
    try {
        // Exercise a representative write through the real UI/API path. The
        // channel is deliberately not deployed and is removed before the test
        // completes, so repeated release validation is idempotent.
        await page.goto(appPath('/channels/new/guided'));
        const next = page.getByRole('button', { name: 'Next', exact: true });
        await page.locator('.view-body input').first().fill(channelName);
        for (let step = 0; step < 6; step++) await next.click();
        await expect(page.getByText(channelName, { exact: true })).toBeVisible();
        await page.getByRole('main').getByRole('button', { name: 'Create Channel', exact: true }).click();

        await expect(page).toHaveURL(/\/channels$/, { timeout: 15_000 });
        await expect(page.getByText(channelName, { exact: true })).toBeVisible();
        const created = await matchingChannels(page, apiBase, channelName);
        expect(created).toHaveLength(1);
        createdId = created[0].id;
        await page.getByText(channelName, { exact: true }).click();
        await page.getByRole('button', { name: 'Delete Channel', exact: true }).click();
        await page.getByRole('dialog', { name: 'Delete channels' })
            .getByRole('button', { name: 'Delete', exact: true }).click();
        await expect(page.getByText(channelName, { exact: true })).toHaveCount(0);
        expect(await matchingChannels(page, apiBase, channelName)).toHaveLength(0);
        createdId = null;
    } catch (error) {
        primaryFailure = error;
    }

    let cleanupFailure: unknown = null;
    try {
        // Search by the reserved smoke name even if the response carrying the
        // created ID was interrupted.
        await removeMatchingChannels(page, apiBase, channelName);
        createdId = null;
    } catch (error) {
        cleanupFailure = new Error(
            `Could not remove disposable channel${createdId ? ` ${createdId}` : ''}: ${(error as Error).message}`,
            { cause: error }
        );
    }

    if (primaryFailure && cleanupFailure)
        throw new AggregateError([primaryFailure, cleanupFailure], 'Live smoke failed and cleanup also failed');
    if (primaryFailure) throw primaryFailure;
    if (cleanupFailure) throw cleanupFailure;
});
