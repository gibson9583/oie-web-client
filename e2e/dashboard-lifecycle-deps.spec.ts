import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * Issue #43 — lifecycle actions must reach the engine as a SET, and must offer
 * the channels the selection is wired to in /server/channelDependencies.
 *
 * The two halves pinned here:
 *   1. A multi-channel Start goes out as ONE POST /channels/_start carrying both
 *      ids (form-urlencoded `channelId` repeated), not a POST per channel — only
 *      a whole set can be dependency-ordered by the engine.
 *   2. Undeploying a depended-ON channel prompts to include its dependents, and
 *      taking the offer widens the set that is actually submitted.
 *
 * A single-channel action deliberately still uses the per-channel endpoint
 * (dashboard.spec.ts / cards.spec.ts pin that), so both fixtures below select
 * two channels or expand to two.
 */

const TWO_STOPPED = {
    list: {
        dashboardStatus: [
            { channelId: 'c-alpha', name: 'Alpha Channel', state: 'STOPPED', statistics: {} },
            { channelId: 'c-bravo', name: 'Bravo Channel', state: 'STOPPED', statistics: {} },
        ],
    },
};

// Bravo depends on Alpha: Alpha must come up first, and undeploying Alpha
// strands Bravo. XStream serializes the set as { set: { channelDependency: … } }.
const ALPHA_HAS_DEPENDENT = {
    set: { channelDependency: [{ dependentId: 'c-bravo', dependencyId: 'c-alpha' }] },
};

test('a multi-select Start issues ONE bulk _start, not one request per channel', async ({ page }) => {
    await mockEngine(page, { 'GET /channels/statuses': TWO_STOPPED });

    // Every _start POST that reaches the wire, so "N single calls" fails loudly.
    const startPaths: string[] = [];
    page.on('request', (r) => {
        const path = new URL(r.url()).pathname;
        if (r.method() === 'POST' && /_start$/.test(path)) startPaths.push(path);
    });

    await page.goto('/dashboard');
    await expect(page.getByText('Alpha Channel', { exact: true })).toBeVisible();

    await page.locator('tr', { hasText: 'Alpha Channel' }).first().click();
    await page.locator('tr', { hasText: 'Bravo Channel' }).first().click({ modifiers: ['ControlOrMeta'] });

    const bulk = page.waitForRequest(
        (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/channels/_start'
    );
    // The post-action refresh: once it lands, the handler has issued everything
    // it is going to issue, so the counts below are final.
    const refreshed = page.waitForRequest(
        (r) => r.method() === 'GET' && new URL(r.url()).pathname === '/api/channels/statuses'
    );
    await page.getByRole('button', { name: 'Start', exact: true }).click();

    const request = await bulk;
    const body = new URLSearchParams(request.postData() || '');
    expect(body.getAll('channelId').sort()).toEqual(['c-alpha', 'c-bravo']);
    await refreshed;

    expect(startPaths).toEqual(['/api/channels/_start']);
});

test('undeploying a depended-on channel offers to include its dependents', async ({ page }) => {
    await mockEngine(page, {
        'GET /channels/statuses': TWO_STOPPED,
        'GET /server/channelDependencies': ALPHA_HAS_DEPENDENT,
    });
    await page.goto('/dashboard');
    await expect(page.getByText('Alpha Channel', { exact: true })).toBeVisible();

    // Alpha alone — Bravo is related but NOT selected.
    await page.locator('tr', { hasText: 'Alpha Channel' }).first().click();
    await page.getByRole('button', { name: 'Undeploy Channel', exact: true }).click();

    const prompt = page.getByRole('dialog', { name: 'Channel Dependencies' });
    await expect(prompt).toBeVisible();
    await expect(prompt.getByText(/depend on the selected channel/i)).toBeVisible();
    await expect(prompt.getByText('Bravo Channel', { exact: true })).toBeVisible();
    // Leaving them out has to stay available — this is an offer, not a redirect.
    await expect(prompt.getByRole('button', { name: 'Selected Only', exact: true })).toBeVisible();
    await prompt.getByRole('button', { name: 'Include', exact: true }).click();

    // The existing Undeploy confirmation survives, now counting the wider set.
    const confirm = page.getByRole('dialog', { name: 'Undeploy' });
    await expect(confirm.getByText('Undeploy 2 channel(s)?')).toBeVisible();

    const undeployed = page.waitForRequest(
        (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/channels/_undeploy'
    );
    await confirm.getByRole('button', { name: 'Undeploy', exact: true }).click();

    const request = await undeployed;
    expect(JSON.parse(request.postData() || '{}')).toEqual({
        set: { string: ['c-alpha', 'c-bravo'] },
    });
});
