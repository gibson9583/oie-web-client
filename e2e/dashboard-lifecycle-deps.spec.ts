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
    let submitted = false;
    await mockEngine(page, {
        'GET /channels/statuses': () => submitted ? {
            list: { dashboardStatus: [
                { channelId: 'c-alpha', name: 'Alpha Channel', state: 'STARTED', statistics: {} },
                { channelId: 'c-bravo', name: 'Bravo Channel', state: 'STARTED', statistics: {} },
            ] }
        } : TWO_STOPPED,
        'POST /channels/_start': () => { submitted = true; return ''; }
    });

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

test('a redacted id makes a bulk lifecycle action report partial completion', async ({ page }) => {
    /* The engine's bulk endpoints remove unauthorized ids and still return 204.
       Model Alpha as authorized/started and Bravo as redacted/still stopped: the
       action must not read that response as complete success. */
    let submitted = false;
    await mockEngine(page, {
        'GET /channels/statuses': () => submitted ? {
            list: { dashboardStatus: [
                { channelId: 'c-alpha', name: 'Alpha Channel', state: 'STARTED', statistics: {} },
                { channelId: 'c-bravo', name: 'Bravo Channel', state: 'STOPPED', statistics: {} },
            ] }
        } : TWO_STOPPED,
        'POST /channels/_start': () => { submitted = true; return ''; }
    });

    await page.goto('/dashboard');
    await expect(page.getByText('Alpha Channel', { exact: true })).toBeVisible();
    await page.locator('tr', { hasText: 'Alpha Channel' }).first().click();
    await page.locator('tr', { hasText: 'Bravo Channel' }).first().click({ modifiers: ['ControlOrMeta'] });
    await page.getByRole('button', { name: 'Start', exact: true }).click();

    await expect(page.getByText(/Start failed:.*did not confirm start for c-bravo.*operation may be partial/i)).toBeVisible();
});

test('a redacted id makes a bulk undeploy report partial completion', async ({ page }) => {
    let submitted = false;
    await mockEngine(page, {
        'GET /channels/statuses': () => ({ list: { dashboardStatus: submitted ? [
            { channelId: 'c-alpha', name: 'Alpha Channel', state: 'UNDEPLOYED', statistics: {} },
            { channelId: 'c-bravo', name: 'Bravo Channel', state: 'STARTED', statistics: {} }
        ] : [
            { channelId: 'c-alpha', name: 'Alpha Channel', state: 'STARTED', statistics: {} },
            { channelId: 'c-bravo', name: 'Bravo Channel', state: 'STARTED', statistics: {} }
        ] } }),
        'GET /channels/c-alpha/status': () => submitted
            ? { __status: 404, body: { message: 'Not Found' } }
            : { dashboardStatus: { channelId: 'c-alpha', state: 'STARTED' } },
        'GET /channels/c-bravo/status': {
            dashboardStatus: { channelId: 'c-bravo', state: 'STARTED' }
        },
        'POST /channels/_undeploy': () => { submitted = true; return ''; }
    });

    await page.goto('/dashboard');
    await expect(page.getByText('Alpha Channel', { exact: true })).toBeVisible();
    await page.locator('tr', { hasText: 'Alpha Channel' }).first().click();
    await page.locator('tr', { hasText: 'Bravo Channel' }).first().click({ modifiers: ['ControlOrMeta'] });
    await page.getByRole('button', { name: 'Undeploy Channel', exact: true }).click();
    await page.getByRole('dialog', { name: 'Undeploy' })
        .getByRole('button', { name: 'Undeploy', exact: true }).click();

    await expect(page.getByText(/did not confirm undeploy for c-bravo.*operation may be partial/i)).toBeVisible();
});

test('an undeploy 404 is not success unless the channel still exists and is authorized', async ({ page }) => {
    let submitted = false;
    await mockEngine(page, {
        'GET /channels/statuses': { list: { dashboardStatus: [
            { channelId: 'c-alpha', name: 'Alpha Channel', state: 'STARTED', statistics: {} },
            { channelId: 'c-bravo', name: 'Bravo Channel', state: 'STARTED', statistics: {} }
        ] } },
        'GET /channels/c-bravo': () => submitted ? '' : {
            channel: { id: 'c-bravo', name: 'Bravo Channel', revision: 1,
                exportData: { metadata: { enabled: true } } }
        },
        'GET /channels/c-alpha/status': { __status: 404, body: { message: 'Not Found' } },
        'GET /channels/c-bravo/status': { __status: 404, body: { message: 'Not Found' } },
        'POST /channels/_undeploy': () => { submitted = true; return ''; }
    });

    await page.goto('/dashboard');
    await page.locator('tr', { hasText: 'Alpha Channel' }).first().click();
    await page.locator('tr', { hasText: 'Bravo Channel' }).first().click({ modifiers: ['ControlOrMeta'] });
    await page.getByRole('button', { name: 'Undeploy Channel', exact: true }).click();
    await page.getByRole('dialog', { name: 'Undeploy' })
        .getByRole('button', { name: 'Undeploy', exact: true }).click();

    await expect(page.getByText(/did not confirm undeploy for c-bravo.*unauthorized, deleted/i)).toBeVisible();
});

test('a single undeploy uses the authorized endpoint and surfaces permission revocation', async ({ page }) => {
    const undeployPaths: string[] = [];
    page.on('request', request => {
        const path = new URL(request.url()).pathname;
        if (request.method() === 'POST' && /_undeploy$/.test(path)) undeployPaths.push(path);
    });
    await mockEngine(page, {
        'GET /channels/statuses': { list: { dashboardStatus: [
            { channelId: 'c-alpha', name: 'Alpha Channel', state: 'STARTED', statistics: {} }
        ] } },
        'POST /channels/c-alpha/_undeploy': {
            __status: 403,
            body: { message: 'Channel permission was revoked' }
        }
    });

    await page.goto('/dashboard');
    await page.locator('tr', { hasText: 'Alpha Channel' }).first().click();
    await page.getByRole('button', { name: 'Undeploy Channel', exact: true }).click();
    await page.getByRole('dialog', { name: 'Undeploy' })
        .getByRole('button', { name: 'Undeploy', exact: true }).click();

    await expect(page.getByText('Channel permission was revoked', { exact: true })).toBeVisible();
    expect(undeployPaths).toEqual(['/api/channels/c-alpha/_undeploy']);
});

test('undeploying a depended-on channel offers to include its dependents', async ({ page }) => {
    let submitted = false;
    await mockEngine(page, {
        'GET /channels/statuses': () => submitted ? {
            list: { dashboardStatus: [
                { channelId: 'c-alpha', name: 'Alpha Channel', state: 'UNDEPLOYED', statistics: {} },
                { channelId: 'c-bravo', name: 'Bravo Channel', state: 'UNDEPLOYED', statistics: {} }
            ] }
        } : TWO_STOPPED,
        'GET /server/channelDependencies': ALPHA_HAS_DEPENDENT,
        'GET /channels/c-alpha/status': { __status: 404, body: { message: 'Not Found' } },
        'GET /channels/c-bravo/status': { __status: 404, body: { message: 'Not Found' } },
        'POST /channels/_undeploy': () => { submitted = true; return ''; }
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

test('a dependency already in the target state is not offered', async ({ page }) => {
    /* Swing only offers a related channel when acting on it would DO something
       (Frame.addChannelToTaskSet skips a dependency that is already STARTED).
       Without that test the dialog interrupts every single action on any server
       that uses dependencies at all, and "Include" then submits ids the engine
       no-ops — which teaches people to click through it. */
    await mockEngine(page, {
        'GET /channels/statuses': {
            list: {
                dashboardStatus: [
                    { channelId: 'c-alpha', name: 'Alpha Channel', state: 'STARTED', statistics: {} },
                    { channelId: 'c-bravo', name: 'Bravo Channel', state: 'STOPPED', statistics: {} },
                ],
            },
        },
        'GET /server/channelDependencies': ALPHA_HAS_DEPENDENT,
    });
    await page.goto('/dashboard');
    await expect(page.getByText('Bravo Channel', { exact: true })).toBeVisible();

    // Starting Bravo depends on Alpha, which is already STARTED — nothing to add.
    await page.locator('tr', { hasText: 'Bravo Channel' }).first().click();
    const started = page.waitForRequest(
        (r) => r.method() === 'POST' && /_start$/.test(new URL(r.url()).pathname)
    );
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await started;
    await expect(page.getByRole('dialog', { name: 'Channel Dependencies' })).toBeHidden();
});

test('Pause offers the dependents Swing offers it', async ({ page }) => {
    // ChannelTask.PAUSE goes through getStatusesWithDependencies in Swing just
    // as STOP and UNDEPLOY do; only HALT has no expansion.
    let submitted = false;
    await mockEngine(page, {
        'GET /channels/statuses': () => ({
            list: {
                dashboardStatus: [
                    { channelId: 'c-alpha', name: 'Alpha Channel', state: submitted ? 'PAUSED' : 'STARTED', statistics: {} },
                    { channelId: 'c-bravo', name: 'Bravo Channel', state: submitted ? 'PAUSED' : 'STARTED', statistics: {} },
                ],
            },
        }),
        'GET /server/channelDependencies': ALPHA_HAS_DEPENDENT,
        'POST /channels/_pause': () => { submitted = true; return ''; }
    });
    await page.goto('/dashboard');
    await expect(page.getByText('Alpha Channel', { exact: true })).toBeVisible();

    await page.locator('tr', { hasText: 'Alpha Channel' }).first().click();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();

    const prompt = page.getByRole('dialog', { name: 'Channel Dependencies' });
    await expect(prompt).toBeVisible();
    await expect(prompt.getByText('Bravo Channel', { exact: true })).toBeVisible();

    const paused = page.waitForRequest(
        (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/channels/_pause'
    );
    await prompt.getByRole('button', { name: 'Include', exact: true }).click();
    const body = new URLSearchParams((await paused).postData() || '');
    expect(body.getAll('channelId').sort()).toEqual(['c-alpha', 'c-bravo']);
});

test('a failed dependency lookup is reported and aborts the lifecycle action', async ({ page }) => {
    await mockEngine(page, {
        'GET /channels/statuses': TWO_STOPPED,
        'GET /server/channelDependencies': {
            __status: 500,
            body: { message: 'dependency service unavailable' }
        }
    });
    const starts: string[] = [];
    page.on('request', request => {
        const path = new URL(request.url()).pathname;
        if (request.method() === 'POST' && /_start$/.test(path)) starts.push(path);
    });

    await page.goto('/dashboard');
    await expect(page.getByText('Alpha Channel', { exact: true })).toBeVisible();
    await page.locator('tr', { hasText: 'Alpha Channel' }).first().click();
    await page.getByRole('button', { name: 'Start', exact: true }).click();

    await expect(page.getByText(/Start cancelled — channel dependencies could not be loaded/i)).toBeVisible();
    expect(starts).toEqual([]);
});

test('deploy does not offer a disabled dependency the engine would no-op', async ({ page }) => {
    /* Swing's deploy walker (addChannelToDeploySet) skips disabled channels;
       the engine's DeployTask.checkEnabled no-ops them anyway, so a prompt that
       offers to deploy one promises something that will not happen. */
    const deployBodies: string[] = [];
    const CANDIDATES: Record<string, any> = {
        'c-disabled': {
            '@version': '4.5.0', id: 'c-disabled', name: 'Disabled Dependency', revision: 1,
            exportData: { metadata: { enabled: false } }
        },
        // Enabled, but reachable ONLY through the disabled channel: Swing does
        // not recurse through a skipped node, so this must not be offered.
        'c-chained': {
            '@version': '4.5.0', id: 'c-chained', name: 'Chained Dependency', revision: 1,
            exportData: { metadata: { enabled: true } }
        }
    };
    await mockEngine(page, {
        'GET /server/channelDependencies': {
            set: { channelDependency: [
                { dependentId: 'c-started', dependencyId: 'c-disabled' },
                { dependentId: 'c-disabled', dependencyId: 'c-chained' }
            ] }
        },
        'GET /channels': (req: any) => {
            const ids = new URL(req.url()).searchParams.getAll('channelId');
            if (ids.length) {
                return { list: { channel: ids.map(id => CANDIDATES[id]).filter(Boolean) } };
            }
            return { list: { channel: [
                { '@version': '4.5.0', id: 'c-started', name: 'Demo Started', revision: 1 },
                { '@version': '4.5.0', id: 'c-stopped', name: 'Demo Stopped', revision: 1 },
            ] } };
        },
        'POST /channels/_deploy': (req: any) => { deployBodies.push(req.postData() || ''); return ''; },
        'POST /channels/c-started/_deploy': () => { deployBodies.push('single:c-started'); return ''; }
    });

    await page.goto('/channels');
    await page.getByRole('gridcell', { name: 'Demo Started', exact: true }).click();
    await page.getByRole('button', { name: 'Deploy Channel', exact: true }).click();

    // The deploy went out without a dependencies prompt: the only directly
    // related channel is disabled, and the enabled one behind it is unreachable
    // once the disabled node is skipped — nothing left to truthfully offer.
    await expect.poll(() => deployBodies.length).toBeGreaterThan(0);
    await expect(page.getByRole('dialog', { name: 'Channel Dependencies' })).toHaveCount(0);
    expect(deployBodies.join(' ')).not.toContain('c-disabled');
    expect(deployBodies.join(' ')).not.toContain('c-chained');
});

test('a failed enabled-state lookup withholds Include — the closure is unknowable', async ({ page }) => {
    /* A → disabled B → enabled C: the correct walk stops at B and never reaches
       C. When the enabled flags cannot be read, the client cannot compute that
       closure — Include on the unfiltered walk would submit C, and the engine
       (which only no-ops B itself) would deploy it. So the dialog explains why
       and offers only Selected Only / Cancel; the user's own selection is the
       one thing still safe to deploy. */
    const deployBodies: string[] = [];
    await mockEngine(page, {
        'GET /server/channelDependencies': {
            set: { channelDependency: [
                { dependentId: 'c-started', dependencyId: 'c-dep' },
                { dependentId: 'c-dep', dependencyId: 'c-chained' }
            ] }
        },
        'GET /channels': (req: any) => {
            const ids = new URL(req.url()).searchParams.getAll('channelId');
            if (ids.length) return { __status: 500, body: { message: 'metadata unavailable' } };
            return { list: { channel: [
                { '@version': '4.5.0', id: 'c-started', name: 'Demo Started', revision: 1 },
                { '@version': '4.5.0', id: 'c-stopped', name: 'Demo Stopped', revision: 1 },
            ] } };
        },
        'POST /channels/_deploy': (req: any) => { deployBodies.push(req.postData() || ''); return ''; },
        'POST /channels/c-started/_deploy': () => { deployBodies.push('single:c-started'); return ''; }
    });

    await page.goto('/channels');
    await page.getByRole('gridcell', { name: 'Demo Started', exact: true }).click();
    await page.getByRole('button', { name: 'Deploy Channel', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Channel Dependencies' });
    await expect(dialog).toContainText('c-dep');
    await expect(dialog).toContainText(/cannot be safely included/);
    await expect(dialog.getByRole('button', { name: 'Include', exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Selected Only', exact: true }).click();

    await expect.poll(() => deployBodies.length).toBeGreaterThan(0);
    expect(deployBodies.join(' ')).toContain('c-started');
    expect(deployBodies.join(' ')).not.toContain('c-dep');
    expect(deployBodies.join(' ')).not.toContain('c-chained');
});

test('a candidate missing from the enabled-state answer blocks Include the same way', async ({ page }) => {
    /* The lookup can also fail quietly: a 200 that simply lacks a record for a
       candidate leaves that channel's enabled state — and therefore the whole
       closure — just as unknowable as a 500 does. */
    const deployBodies: string[] = [];
    await mockEngine(page, {
        'GET /server/channelDependencies': {
            set: { channelDependency: [
                { dependentId: 'c-started', dependencyId: 'c-dep' },
                { dependentId: 'c-dep', dependencyId: 'c-chained' }
            ] }
        },
        'GET /channels': (req: any) => {
            const ids = new URL(req.url()).searchParams.getAll('channelId');
            if (ids.length) {
                // Answers for c-chained but "forgets" c-dep.
                return { list: { channel: [{
                    '@version': '4.5.0', id: 'c-chained', name: 'Chained Dependency', revision: 1,
                    exportData: { metadata: { enabled: true } }
                }] } };
            }
            return { list: { channel: [
                { '@version': '4.5.0', id: 'c-started', name: 'Demo Started', revision: 1 },
                { '@version': '4.5.0', id: 'c-stopped', name: 'Demo Stopped', revision: 1 },
            ] } };
        },
        'POST /channels/_deploy': (req: any) => { deployBodies.push(req.postData() || ''); return ''; },
        'POST /channels/c-started/_deploy': () => { deployBodies.push('single:c-started'); return ''; }
    });

    await page.goto('/channels');
    await page.getByRole('gridcell', { name: 'Demo Started', exact: true }).click();
    await page.getByRole('button', { name: 'Deploy Channel', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Channel Dependencies' });
    await expect(dialog).toContainText(/cannot be safely included/);
    await expect(dialog.getByRole('button', { name: 'Include', exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Selected Only', exact: true }).click();

    await expect.poll(() => deployBodies.length).toBeGreaterThan(0);
    expect(deployBodies.join(' ')).toContain('c-started');
    expect(deployBodies.join(' ')).not.toContain('c-dep');
    expect(deployBodies.join(' ')).not.toContain('c-chained');
});

test('a mixed Start resumes a paused dependency before starting its stopped dependent', async ({ page }) => {
    /* Bravo (stopped) depends on Alpha (paused). Start is two engine operations
       (_start no-ops a PAUSED channel) and the engine orders within ONE request
       only, so the client must sequence across them: Alpha's resume has to
       reach the wire before Bravo's start, or Bravo runs before its
       prerequisite. */
    const calls: string[] = [];
    page.on('request', (r) => {
        const path = new URL(r.url()).pathname;
        if (r.method() === 'POST' && /_(start|resume)$/.test(path)) calls.push(path);
    });
    await mockEngine(page, {
        'GET /channels/statuses': { list: { dashboardStatus: [
            { channelId: 'c-alpha', name: 'Alpha Channel', state: 'PAUSED', statistics: {} },
            { channelId: 'c-bravo', name: 'Bravo Channel', state: 'STOPPED', statistics: {} },
        ] } },
        'GET /server/channelDependencies': ALPHA_HAS_DEPENDENT,
    });

    await page.goto('/dashboard');
    await expect(page.getByText('Alpha Channel', { exact: true })).toBeVisible();
    await page.locator('tr', { hasText: 'Alpha Channel' }).first().click();
    await page.locator('tr', { hasText: 'Bravo Channel' }).first().click({ modifiers: ['ControlOrMeta'] });
    await page.getByRole('button', { name: 'Start', exact: true }).click();

    await expect.poll(() => calls.length).toBe(2);
    expect(calls).toEqual(['/api/channels/c-alpha/_resume', '/api/channels/c-bravo/_start']);
});

test('a mixed Start starts a stopped dependency before resuming its paused dependent', async ({ page }) => {
    // The mirror case — a fixed resume-first order would break THIS one, which
    // is why the batches are tiered by the graph rather than reordered.
    const calls: string[] = [];
    page.on('request', (r) => {
        const path = new URL(r.url()).pathname;
        if (r.method() === 'POST' && /_(start|resume)$/.test(path)) calls.push(path);
    });
    await mockEngine(page, {
        'GET /channels/statuses': { list: { dashboardStatus: [
            { channelId: 'c-alpha', name: 'Alpha Channel', state: 'STOPPED', statistics: {} },
            { channelId: 'c-bravo', name: 'Bravo Channel', state: 'PAUSED', statistics: {} },
        ] } },
        'GET /server/channelDependencies': ALPHA_HAS_DEPENDENT,
    });

    await page.goto('/dashboard');
    await expect(page.getByText('Alpha Channel', { exact: true })).toBeVisible();
    await page.locator('tr', { hasText: 'Alpha Channel' }).first().click();
    await page.locator('tr', { hasText: 'Bravo Channel' }).first().click({ modifiers: ['ControlOrMeta'] });
    await page.getByRole('button', { name: 'Start', exact: true }).click();

    await expect.poll(() => calls.length).toBe(2);
    expect(calls).toEqual(['/api/channels/c-alpha/_start', '/api/channels/c-bravo/_resume']);
});

test('a failed prerequisite aborts the tiers behind it', async ({ page }) => {
    /* Alpha (paused) fails to resume: Bravo (stopped, depends on Alpha) must
       NOT be started — submitting it anyway would recreate the ordering bug
       the tiering exists to prevent. The failure surfaces with the skipped
       count. */
    const calls: string[] = [];
    page.on('request', (r) => {
        const path = new URL(r.url()).pathname;
        if (r.method() === 'POST' && /_(start|resume)$/.test(path)) calls.push(path);
    });
    await mockEngine(page, {
        'GET /channels/statuses': { list: { dashboardStatus: [
            { channelId: 'c-alpha', name: 'Alpha Channel', state: 'PAUSED', statistics: {} },
            { channelId: 'c-bravo', name: 'Bravo Channel', state: 'STOPPED', statistics: {} },
        ] } },
        'GET /server/channelDependencies': ALPHA_HAS_DEPENDENT,
        'POST /channels/c-alpha/_resume': { __status: 500, body: { message: 'resume exploded' } }
    });

    await page.goto('/dashboard');
    await expect(page.getByText('Alpha Channel', { exact: true })).toBeVisible();
    await page.locator('tr', { hasText: 'Alpha Channel' }).first().click();
    await page.locator('tr', { hasText: 'Bravo Channel' }).first().click({ modifiers: ['ControlOrMeta'] });
    await page.getByRole('button', { name: 'Start', exact: true }).click();

    await expect(page.getByText(/Start failed:[\s\S]*not submitted because a prerequisite failed/).first()).toBeVisible();
    expect(calls).toEqual(['/api/channels/c-alpha/_resume']);
});

test('start/resume classification uses action-time state, not the render poll', async ({ page }) => {
    /* The table drew Alpha as STOPPED, but by the time Start is clicked it is
       PAUSED. The submit's own filtered status read (channelId param) is the
       action-time truth: Alpha must be RESUMED — _start would be an engine
       no-op that leaves it paused. */
    const calls: string[] = [];
    page.on('request', (r) => {
        const path = new URL(r.url()).pathname;
        if (r.method() === 'POST' && /_(start|resume)$/.test(path)) calls.push(path);
    });
    await mockEngine(page, {
        'GET /channels/statuses': (req: any) => {
            const filtered = new URL(req.url()).searchParams.has('channelId');
            return { list: { dashboardStatus: [
                { channelId: 'c-alpha', name: 'Alpha Channel', state: filtered ? 'PAUSED' : 'STOPPED', statistics: {} },
            ] } };
        },
    });

    await page.goto('/dashboard');
    await expect(page.getByText('Alpha Channel', { exact: true })).toBeVisible();
    await page.locator('tr', { hasText: 'Alpha Channel' }).first().click();
    await page.getByRole('button', { name: 'Start', exact: true }).click();

    await expect.poll(() => calls.length).toBeGreaterThan(0);
    expect(calls).toEqual(['/api/channels/c-alpha/_resume']);
});

test('an incomplete action-time status answer aborts the start instead of guessing', async ({ page }) => {
    /* The filtered read omits Alpha (deleted or undeployed between the
       dependency prompt and the submit). Classifying the missing channel as
       STOPPED would _start it — an engine no-op — and then release Bravo
       anyway, so nothing may be posted at all. */
    const calls: string[] = [];
    page.on('request', (r) => {
        const path = new URL(r.url()).pathname;
        if (r.method() === 'POST' && /_(start|resume)$/.test(path)) calls.push(path);
    });
    await mockEngine(page, {
        'GET /channels/statuses': (req: any) => {
            const filtered = new URL(req.url()).searchParams.has('channelId');
            return { list: { dashboardStatus: [
                ...(filtered ? [] : [{ channelId: 'c-alpha', name: 'Alpha Channel', state: 'PAUSED', statistics: {} }]),
                { channelId: 'c-bravo', name: 'Bravo Channel', state: 'STOPPED', statistics: {} },
            ] } };
        },
        'GET /server/channelDependencies': ALPHA_HAS_DEPENDENT,
    });

    await page.goto('/dashboard');
    await expect(page.getByText('Alpha Channel', { exact: true })).toBeVisible();
    await page.locator('tr', { hasText: 'Alpha Channel' }).first().click();
    await page.locator('tr', { hasText: 'Bravo Channel' }).first().click({ modifiers: ['ControlOrMeta'] });
    await page.getByRole('button', { name: 'Start', exact: true }).click();

    await expect(page.getByText(/Start failed:[\s\S]*not deployed or no longer exists/).first()).toBeVisible();
    expect(calls).toEqual([]);
});

test('a related channel with no visible status is disclosed, not silently dropped', async ({ page }) => {
    /* Bravo depends on c-secret, which has NO status row — the status endpoint
       redacts channels this account cannot see, and a deleted or undeployed
       prerequisite looks identical. The walker used to skip it silently and
       start Bravo bare; now the prompt says so before anything is submitted. */
    const calls: string[] = [];
    page.on('request', (r) => {
        const path = new URL(r.url()).pathname;
        if (r.method() === 'POST' && /_(start|resume)$/.test(path)) calls.push(path);
    });
    await mockEngine(page, {
        'GET /channels/statuses': { list: { dashboardStatus: [
            { channelId: 'c-bravo', name: 'Bravo Channel', state: 'STOPPED', statistics: {} },
        ] } },
        'GET /server/channelDependencies': {
            set: { channelDependency: [{ dependentId: 'c-bravo', dependencyId: 'c-secret' }] }
        },
    });

    await page.goto('/dashboard');
    await expect(page.getByText('Bravo Channel', { exact: true })).toBeVisible();
    await page.locator('tr', { hasText: 'Bravo Channel' }).first().click();
    await page.getByRole('button', { name: 'Start', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Channel Dependencies' });
    await expect(dialog).toContainText(/could not be verified/);
    await expect(dialog).toContainText('c-secret');
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click();

    await expect.poll(() => calls.length).toBeGreaterThan(0);
    expect(calls).toEqual(['/api/channels/c-bravo/_start']);
});

test('a dependency appearing after the closure was computed cancels the action', async ({ page }) => {
    /* The initial read shows no dependencies (empty closure, no dialog), but by
       submit time an edge to a channel with NO visible status exists — the
       walker can only see it as "unknown", and the pre-submit re-read must
       catch exactly that. */
    let depReads = 0;
    const calls: string[] = [];
    page.on('request', (r) => {
        const path = new URL(r.url()).pathname;
        if (r.method() === 'POST' && /_(start|resume)$/.test(path)) calls.push(path);
    });
    await mockEngine(page, {
        'GET /channels/statuses': { list: { dashboardStatus: [
            { channelId: 'c-bravo', name: 'Bravo Channel', state: 'STOPPED', statistics: {} },
        ] } },
        'GET /server/channelDependencies': () => {
            depReads++;
            return depReads === 1
                ? { set: '' }
                : { set: { channelDependency: [{ dependentId: 'c-bravo', dependencyId: 'c-secret' }] } };
        },
    });

    await page.goto('/dashboard');
    await expect(page.getByText('Bravo Channel', { exact: true })).toBeVisible();
    await page.locator('tr', { hasText: 'Bravo Channel' }).first().click();
    await page.getByRole('button', { name: 'Start', exact: true }).click();

    await expect(page.getByText(/Start cancelled[\s\S]*dependencies changed while confirming/).first()).toBeVisible();
    expect(calls).toEqual([]);
});

test('a relationship REMOVED while confirming cancels the action', async ({ page }) => {
    /* Stop offered dependent Bravo and the user Included it — but the edge was
       deleted while the dialog sat open. Submitting anyway stops a channel no
       longer covered by the relationship the user confirmed. */
    let depReads = 0;
    const stops: string[] = [];
    page.on('request', (r) => {
        const path = new URL(r.url()).pathname;
        if (r.method() === 'POST' && /_stop$/.test(path)) stops.push(path);
    });
    await mockEngine(page, {
        'GET /channels/statuses': { list: { dashboardStatus: [
            { channelId: 'c-alpha', name: 'Alpha Channel', state: 'STARTED', statistics: {} },
            { channelId: 'c-bravo', name: 'Bravo Channel', state: 'STARTED', statistics: {} },
        ] } },
        'GET /server/channelDependencies': () => {
            depReads++;
            return depReads === 1 ? ALPHA_HAS_DEPENDENT : { set: '' };
        },
    });

    await page.goto('/dashboard');
    await expect(page.getByText('Alpha Channel', { exact: true })).toBeVisible();
    await page.locator('tr', { hasText: 'Alpha Channel' }).first().click();
    await page.getByRole('button', { name: 'Stop', exact: true }).click();

    const prompt = page.getByRole('dialog', { name: 'Channel Dependencies' });
    await expect(prompt.getByText('Bravo Channel', { exact: true })).toBeVisible();
    await prompt.getByRole('button', { name: 'Include', exact: true }).click();

    await expect(page.getByText(/Stop cancelled[\s\S]*dependencies changed while confirming/).first()).toBeVisible();
    expect(stops).toEqual([]);
});

test('an enabled flag flipping while confirming cancels the deploy', async ({ page }) => {
    /* Bravo was DISABLED when the offer was computed (so it was filtered out,
       no dialog), but became enabled before submit. The stale metadata would
       deploy Alpha without the now-eligible Bravo — the offer recomputation
       reads the flags again and refuses. */
    let recordReads = 0;
    const deploys: string[] = [];
    page.on('request', (r) => {
        const path = new URL(r.url()).pathname;
        if (r.method() === 'POST' && /_deploy$/.test(path)) deploys.push(path);
    });
    await mockEngine(page, {
        'GET /server/channelDependencies': {
            set: { channelDependency: [{ dependentId: 'c-started', dependencyId: 'c-toggle' }] }
        },
        'GET /channels': (req: any) => {
            const ids = new URL(req.url()).searchParams.getAll('channelId');
            if (ids.includes('c-toggle')) {
                recordReads++;
                return { list: { channel: [{
                    '@version': '4.5.0', id: 'c-toggle', name: 'Toggling Dependency', revision: 1,
                    exportData: { metadata: { enabled: recordReads > 1 } }
                }] } };
            }
            return { list: { channel: [
                { '@version': '4.5.0', id: 'c-started', name: 'Demo Started', revision: 1 },
                { '@version': '4.5.0', id: 'c-stopped', name: 'Demo Stopped', revision: 1 },
            ] } };
        },
    });

    await page.goto('/channels');
    await page.getByRole('gridcell', { name: 'Demo Started', exact: true }).click();
    await page.getByRole('button', { name: 'Deploy Channel', exact: true }).click();

    await expect(page.getByText(/Deploy cancelled[\s\S]*dependencies changed while confirming/).first()).toBeVisible();
    expect(deploys).toEqual([]);
});

test('a malformed dependency answer cancels the action instead of acting graphless', async ({ page }) => {
    /* 200 {} is not an empty graph: asList would read it as one and the action
       would proceed with no dependency knowledge at all. */
    const calls: string[] = [];
    page.on('request', (r) => {
        const path = new URL(r.url()).pathname;
        if (r.method() === 'POST' && /_(start|resume)$/.test(path)) calls.push(path);
    });
    await mockEngine(page, {
        'GET /channels/statuses': { list: { dashboardStatus: [
            { channelId: 'c-bravo', name: 'Bravo Channel', state: 'STOPPED', statistics: {} },
        ] } },
        'GET /server/channelDependencies': {},
    });

    await page.goto('/dashboard');
    await expect(page.getByText('Bravo Channel', { exact: true })).toBeVisible();
    await page.locator('tr', { hasText: 'Bravo Channel' }).first().click();
    await page.getByRole('button', { name: 'Start', exact: true }).click();

    await expect(page.getByText(/Start cancelled[\s\S]*unusable channel dependency list/).first()).toBeVisible();
    expect(calls).toEqual([]);
});
