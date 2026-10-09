import type { Page, Request } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine, login } from './mock.js';

// Model the engine's incremental cursor and bounded retained history. A static
// response would repopulate every poll and cannot detect a lost remount cursor.
function entry(id: number, message = `Server log entry ${id}`) {
    return { id: String(id), level: 'INFO', category: 'test', lineNumber: '1', message,
        date: { time: 1700000000000 + id, timezone: 'UTC' } };
}
function logEngine(initial = [entry(10), entry(11)]) {
    const engine = {
        entries: initial,
        calls: [] as Array<{ cursor: number | null; size: number }>,
        read(request: Request) {
            const query = new URL(request.url()).searchParams;
            const cursor = query.has('lastLogId') ? Number(query.get('lastLogId')) : null;
            const size = Number(query.get('fetchSize') || 100);
            engine.calls.push({ cursor, size });
            return { serverLogItem: engine.entries
                .filter(row => cursor == null || Number(row.id) > cursor)
                .sort((a, b) => Number(b.id) - Number(a.id))
                .slice(0, Math.min(size, 100)).map(row => ({ ...row })) };
        }
    };
    return engine;
}
function gate() {
    let release!: () => void;
    const promise = new Promise<void>(resolve => { release = resolve; });
    return { promise, release };
}
const rows = (page: Page) => page.locator('table.server-log tbody tr');
const clear = (page: Page) => page.getByTitle('Clear the displayed log', { exact: true }).click();
const pause = (page: Page) => page.getByTitle('Pause or resume the live log', { exact: true });
async function tick(page: Page) { await page.clock.fastForward(5001); }
async function remount(page: Page, surface: 'route' | 'dock' | 'cards') {
    if (surface === 'route') {
        await page.getByRole('button', { name: 'Channels', exact: true }).click();
        await expect(page).toHaveURL(/\/channels$/);
        await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
        await expect(page).toHaveURL(/\/dashboard$/);
    } else if (surface === 'dock') {
        await page.getByRole('tab', { name: 'Connection Log', exact: true }).click();
        await expect(page.locator('table.server-log')).toHaveCount(0);
        await page.getByRole('tab', { name: 'Server Log', exact: true }).click();
    } else {
        await page.getByRole('button', { name: 'Card view', exact: true }).click();
        await expect(page.locator('table.server-log')).toHaveCount(0);
        await page.getByRole('button', { name: 'Table view', exact: true }).click();
    }
    await expect(page.locator('table.server-log')).toBeVisible();
}

test.beforeEach(async ({ page }) => { await page.clock.install(); });

for (const surface of ['route', 'dock', 'cards'] as const) {
    test(`clear survives a ${surface} remount and subsequent polls still show new entries`, async ({ page }) => {
        const engine = logEngine();
        await mockEngine(page, { 'GET /extensions/serverlog': (request: Request) => engine.read(request) });
        await page.goto('/dashboard');
        await expect(rows(page)).toHaveCount(2);
        await clear(page);
        await expect(rows(page)).toHaveText(['No server log entries yet.']);
        await remount(page, surface);
        await tick(page);
        await expect(rows(page)).toHaveText(['No server log entries yet.']);
        // Repeated clear must not rewind the cursor or resurrect old rows.
        await clear(page);
        engine.entries.push(entry(12));
        await tick(page);
        await expect(rows(page)).toHaveCount(1);
        await expect(rows(page)).toContainText('Server log entry 12');
        expect(engine.calls.slice(1).some(call => call.cursor === 11)).toBe(true);
        await remount(page, surface);
        await expect(rows(page)).toHaveCount(1);
        await expect(rows(page)).toContainText('Server log entry 12');
    });
}

test('displayed rows, pause and log size survive every remount in the same session', async ({ page }) => {
    const engine = logEngine();
    await mockEngine(page, { 'GET /extensions/serverlog': (request: Request) => engine.read(request) });
    await page.goto('/dashboard');
    await expect(rows(page)).toHaveCount(2);
    const size = page.locator('.dash-dock input[type=number]');
    await size.fill('1');
    await size.press('Enter');
    await expect(rows(page)).toHaveCount(1);
    await pause(page).click();
    await expect(pause(page)).toHaveText('⏵');
    engine.entries.push(entry(12));
    const requestsBefore = engine.calls.length;
    for (const surface of ['route', 'dock', 'cards'] as const) {
        await remount(page, surface);
        await expect(size).toHaveValue('1');
        await expect(pause(page)).toHaveText('⏵');
        await expect(rows(page)).toHaveCount(1);
        await expect(rows(page)).toContainText('Server log entry 11');
        await tick(page);
    }
    expect(engine.calls).toHaveLength(requestsBefore);
    await pause(page).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page)).toContainText('Server log entry 12');
});

test('clear fences a pending initial history response and establishes a baseline for new entries', async ({ page }) => {
    const engine = logEngine();
    const held = gate();
    let initial = true;
    await mockEngine(page, { 'GET /extensions/serverlog': async (request: Request) => {
        const response = engine.read(request);
        if (initial) { initial = false; await held.promise; }
        return response;
    } });
    try {
        await page.goto('/dashboard');
        await expect.poll(() => engine.calls.length).toBe(1);
        await clear(page);
        const initialResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/extensions/serverlog');
        held.release();
        await (await initialResponse).finished();
        await expect(rows(page)).toHaveText(['No server log entries yet.']);
        // The successful initial response establishes the suppressed baseline.
        await tick(page);
        await expect(rows(page)).toHaveText(['No server log entries yet.']);
        engine.entries.push(entry(12));
        await tick(page);
        await expect(rows(page)).toHaveCount(1);
        await expect(rows(page)).toContainText('Server log entry 12');
    } finally { held.release(); }
});

test('an old response cannot restore entries after clear and a route remount', async ({ page }) => {
    const engine = logEngine();
    const held = gate();
    let holdNext = false, waiting = false;
    await mockEngine(page, { 'GET /extensions/serverlog': async (request: Request) => {
        const response = engine.read(request);
        if (holdNext) { holdNext = false; waiting = true; await held.promise; }
        return response;
    } });
    try {
        await page.goto('/dashboard');
        await expect(rows(page)).toHaveCount(2);
        engine.entries.push(entry(12, 'Pending before clear'));
        holdNext = true;
        await tick(page);
        await expect.poll(() => waiting).toBe(true);
        await clear(page);
        await remount(page, 'route');
        held.release();
        await tick(page);
        await expect(rows(page)).toHaveText(['No server log entries yet.']);
        engine.entries.push(entry(13, 'Created after clear'));
        await tick(page);
        await expect(rows(page)).toHaveCount(1);
        await expect(rows(page)).toContainText('Created after clear');
    } finally { held.release(); }
});

test('failed reads recover without forgetting a clear boundary', async ({ page }) => {
    const engine = logEngine();
    let failing = true;
    await mockEngine(page, { 'GET /extensions/serverlog': (request: Request) => {
        const response = engine.read(request);
        return failing ? { __status: 503, body: { message: 'Synthetic log outage' } } : response;
    } });
    await page.goto('/dashboard');
    await expect(rows(page)).toContainText('Server Log unavailable:');
    failing = false;
    await tick(page);
    await expect(rows(page)).toHaveCount(2);
    await clear(page);
    failing = true;
    await tick(page);
    await expect(rows(page)).toContainText('Server Log unavailable:');
    failing = false;
    await remount(page, 'route');
    await expect(rows(page)).toHaveText(['No server log entries yet.']);
    engine.entries.push(entry(12));
    await tick(page);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page)).toContainText('Server log entry 12');
});

test('rapid pause and resume while a read is pending does not duplicate entries', async ({ page }) => {
    const engine = logEngine();
    const held = gate();
    let holdNext = false, waiting = false;
    await mockEngine(page, { 'GET /extensions/serverlog': async (request: Request) => {
        const response = engine.read(request);
        if (holdNext) { holdNext = false; waiting = true; await held.promise; }
        return response;
    } });
    try {
        await page.goto('/dashboard');
        await expect(rows(page)).toHaveCount(2);
        engine.entries.push(entry(12));
        holdNext = true;
        await tick(page);
        await expect.poll(() => waiting).toBe(true);
        const requestsBefore = engine.calls.length;
        await pause(page).click();
        await pause(page).click();
        await tick(page);
        expect(engine.calls).toHaveLength(requestsBefore);
        held.release();
        await expect(rows(page)).toHaveCount(3);
        await expect(rows(page).filter({ hasText: 'Server log entry 12' })).toHaveCount(1);
    } finally { held.release(); }
});

for (const exit of ['logout', 'expiry'] as const) {
    test(`${exit} discards the previous session's buffer, cursor and display settings`, async ({ page }) => {
        const engine = logEngine();
        let authenticated = true, userId = 1;
        await mockEngine(page, {
            'GET /extensions/serverlog': (request: Request) => engine.read(request),
            'GET /users/current': () => authenticated
                ? { user: { id: userId, username: userId === 1 ? 'admin' : 'second-admin' } }
                : { __status: 401 },
            'POST /users/_login': () => { authenticated = true; return { status: 'SUCCESS' }; },
            'POST /users/_logout': () => { authenticated = false; return ''; },
        });
        await page.goto('/dashboard');
        await expect(rows(page)).toHaveCount(2);
        const size = page.locator('.dash-dock input[type=number]');
        await size.fill('1');
        await size.press('Enter');
        await pause(page).click();
        if (exit === 'logout') {
            await page.locator('button.user-chip').click();
            await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
        } else {
            authenticated = false;
            await page.evaluate(async () => {
                const api = await import(String('/core/api.js'));
                await api.get('/users/current').catch(() => {});
            });
        }
        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
        engine.entries = [entry(1, 'New session only')];
        userId = exit === 'expiry' ? 2 : 1;
        const requestsBefore = engine.calls.length;
        await login(page, userId === 1 ? 'admin' : 'second-admin');
        await expect(page.locator('.shell')).toBeVisible();
        await expect(rows(page)).toHaveCount(1);
        await expect(rows(page)).toContainText('New session only');
        await expect(size).toHaveValue('100');
        await expect(pause(page)).toHaveText('⏸');
        expect(engine.calls.slice(requestsBefore).some(call => call.cursor == null || call.cursor < 1)).toBe(true);
        expect(await page.evaluate(() => JSON.stringify({ local: localStorage, session: sessionStorage })))
            .not.toContain('Server log entry');
    });
}

test('an engine restart with lower log IDs resumes the live stream', async ({ page }) => {
    const engine = logEngine();
    await mockEngine(page, { 'GET /extensions/serverlog': (request: Request) => engine.read(request) });
    await page.goto('/dashboard');
    await expect(rows(page)).toHaveCount(2);
    await clear(page);
    engine.entries = [entry(1, 'New process startup')];
    await tick(page);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page)).toContainText('New process startup');
    engine.entries.push(entry(2, 'New process live entry'));
    await tick(page);
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).filter({ hasText: 'New process live entry' })).toHaveCount(1);
});

test('refreshing the same user with a normalized ID or renamed username preserves the live log', async ({ page }) => {
    const engine = logEngine();
    await mockEngine(page, { 'GET /extensions/serverlog': (request: Request) => engine.read(request) });
    await page.goto('/dashboard');
    await expect(rows(page)).toHaveCount(2);
    await page.evaluate(async () => {
        const store = await import(String('/core/store.js'));
        const user = store.getState('user');
        store.setState('user', { ...user, id: String(user.id) });
        store.setState('user', { ...user, username: 'renamed-admin' });
    });
    await expect(rows(page)).toHaveCount(2);
    engine.entries.push(entry(12));
    await tick(page);
    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).filter({ hasText: 'Server log entry 12' })).toHaveCount(1);
    await remount(page, 'route');
    await expect(rows(page)).toHaveCount(3);
});

test('revoked log access clears the remount cache and restored access shows only new entries', async ({ page }) => {
    const engine = logEngine();
    let authorized = true;
    await mockEngine(page, { 'GET /extensions/serverlog': (request: Request) => {
        const response = engine.read(request);
        return authorized ? response : { __status: 403, body: { message: 'Synthetic log access denied' } };
    } });
    await page.goto('/dashboard');
    await expect(rows(page)).toHaveCount(2);
    authorized = false;
    await remount(page, 'route');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page)).toContainText('Server Log unavailable:');
    await expect(rows(page)).toContainText('Synthetic log access denied');
    await expect(page.locator('.shell')).toBeVisible();
    await remount(page, 'dock');
    await expect(rows(page)).toContainText('Server Log unavailable:');
    await expect(rows(page).filter({ hasText: 'Server log entry' })).toHaveCount(0);
    authorized = true;
    engine.entries.push(entry(12, 'Newly authorized live entry'));
    await tick(page);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page)).toContainText('Newly authorized live entry');
    await remount(page, 'route');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page)).toContainText('Newly authorized live entry');
});

test('Reset restores retained history with the current size, sort and pause setting', async ({ page }) => {
    const engine = logEngine([entry(10), entry(11), entry(12)]);
    await mockEngine(page, { 'GET /extensions/serverlog': (request: Request) => engine.read(request) });
    await page.goto('/dashboard');
    await expect(rows(page)).toHaveCount(3);
    const size = page.locator('.dash-dock input[type=number]');
    await size.fill('3');
    await size.press('Enter');
    await page.locator('table.server-log th', { hasText: 'Message' }).click();
    await pause(page).click();
    // Older cached entries have aged out of the server buffer. Reset must
    // replace them with the retained snapshot, not append to them.
    engine.entries = [entry(20, 'Zebra retained'), entry(21, 'Alpha retained'), entry(22, 'Mike retained'), entry(23, 'Bravo retained')];
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).locator('td:last-child')).toHaveText([
        '(test:1): Alpha retained', '(test:1): Bravo retained', '(test:1): Mike retained'
    ]);
    await expect(size).toHaveValue('3');
    await expect(pause(page)).toHaveText('⏵');
    const requestsBefore = engine.calls.length;
    await tick(page);
    expect(engine.calls).toHaveLength(requestsBefore);
    await clear(page);
    await expect(rows(page)).toHaveText(['No server log entries yet.']);
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).locator('td:last-child')).toHaveText([
        '(test:1): Alpha retained', '(test:1): Bravo retained', '(test:1): Mike retained'
    ]);
    await remount(page, 'route');
    await expect(rows(page)).toHaveCount(3);
    await expect(pause(page)).toHaveText('⏵');
    await expect(size).toHaveValue('3');
});

test('Reset supersedes a pending old poll and replaces it with current retained history', async ({ page }) => {
    const engine = logEngine();
    const held = gate();
    let holdNext = false, waiting = false;
    await mockEngine(page, { 'GET /extensions/serverlog': async (request: Request) => {
        const response = engine.read(request);
        if (holdNext) { holdNext = false; waiting = true; await held.promise; }
        return response;
    } });
    try {
        await page.goto('/dashboard');
        await expect(rows(page)).toHaveCount(2);
        engine.entries.push(entry(12, 'Superseded poll row'));
        holdNext = true;
        await tick(page);
        await expect.poll(() => waiting).toBe(true);
        engine.entries = [entry(20, 'Latest retained snapshot')];
        await page.getByRole('button', { name: 'Reset', exact: true }).click();
        held.release();
        await expect(rows(page)).toHaveCount(1);
        await expect(rows(page)).toContainText('Latest retained snapshot');
        await expect(rows(page).filter({ hasText: 'Superseded poll row' })).toHaveCount(0);
        engine.entries.push(entry(21, 'Live after reset'));
        await tick(page);
        await expect(rows(page)).toHaveCount(2);
        await expect(rows(page).filter({ hasText: 'Live after reset' })).toHaveCount(1);
    } finally { held.release(); }
});

test('Clear after Reset wins over its pending reload while future log entries remain live', async ({ page }) => {
    const engine = logEngine();
    const held = gate();
    let holdNext = false, waiting = false;
    await mockEngine(page, { 'GET /extensions/serverlog': async (request: Request) => {
        const response = engine.read(request);
        if (holdNext) { holdNext = false; waiting = true; await held.promise; }
        return response;
    } });
    try {
        await page.goto('/dashboard');
        await expect(rows(page)).toHaveCount(2);
        holdNext = true;
        await page.getByRole('button', { name: 'Reset', exact: true }).click();
        await expect.poll(() => waiting).toBe(true);
        await expect(page.getByRole('button', { name: 'Reset', exact: true })).toBeDisabled();
        await expect(page.locator('table.server-log')).toHaveAttribute('aria-busy', 'true');
        await expect(page.getByTitle('Clear the displayed log', { exact: true })).toBeEnabled();
        await clear(page);
        const resetResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/extensions/serverlog');
        held.release();
        await (await resetResponse).finished();
        await expect(rows(page)).toHaveText(['No server log entries yet.']);
        await tick(page);
        await expect(rows(page)).toHaveText(['No server log entries yet.']);
        engine.entries.push(entry(12, 'Live after cleared reset'));
        await tick(page);
        await expect(rows(page)).toHaveCount(1);
        await expect(rows(page)).toContainText('Live after cleared reset');
    } finally { held.release(); }
});

test('a failed Reset exposes an error and a second Reset retries without resuming a paused log', async ({ page }) => {
    const engine = logEngine();
    let failing = false;
    await mockEngine(page, { 'GET /extensions/serverlog': (request: Request) => {
        const response = engine.read(request);
        return failing ? { __status: 503, body: { message: 'Synthetic reset failure' } } : response;
    } });
    await page.goto('/dashboard');
    await expect(rows(page)).toHaveCount(2);
    await pause(page).click();
    failing = true;
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(page.getByText(/Synthetic reset failure/)).toBeVisible();
    await expect(rows(page).filter({ hasText: 'Server log entry' })).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Reset', exact: true })).toBeEnabled();
    await expect(page.locator('table.server-log')).toHaveAttribute('aria-busy', 'false');
    await expect(pause(page)).toHaveText('⏵');
    failing = false;
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByText(/Synthetic reset failure/)).toHaveCount(0);
    await expect(pause(page)).toHaveText('⏵');
    const requestsBefore = engine.calls.length;
    await tick(page);
    expect(engine.calls).toHaveLength(requestsBefore);
});

test('signing out during Reset prevents its late history from reaching the next session', async ({ page }) => {
    const engine = logEngine();
    const held = gate();
    let holdNext = false, waiting = false, authenticated = true;
    await mockEngine(page, {
        'GET /extensions/serverlog': async (request: Request) => {
            const response = engine.read(request);
            if (holdNext) { holdNext = false; waiting = true; await held.promise; }
            return response;
        },
        'GET /users/current': () => authenticated ? { user: { id: 1, username: 'admin' } } : { __status: 401 },
        'POST /users/_login': () => { authenticated = true; return { status: 'SUCCESS' }; },
        'POST /users/_logout': () => { authenticated = false; return ''; },
    });
    try {
        await page.goto('/dashboard');
        await expect(rows(page)).toHaveCount(2);
        holdNext = true;
        await page.getByRole('button', { name: 'Reset', exact: true }).click();
        await expect.poll(() => waiting).toBe(true);
        await page.locator('button.user-chip').click();
        await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
        engine.entries = [entry(1, 'Fresh session history')];
        await login(page);
        await expect(rows(page)).toHaveCount(1);
        await expect(rows(page)).toContainText('Fresh session history');
        const oldResetResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/extensions/serverlog');
        held.release();
        await (await oldResetResponse).finished();
        await tick(page);
        await expect(rows(page)).toHaveCount(1);
        await expect(rows(page)).toContainText('Fresh session history');
    } finally { held.release(); }
});

test('Reset matches the compact log toolbar buttons at desktop and narrow widths', async ({ page }, testInfo) => {
    const engine = logEngine();
    let pending: ReturnType<typeof gate> | null = null;
    await mockEngine(page, { 'GET /extensions/serverlog': async (request: Request) => {
        const response = engine.read(request);
        const held = pending;
        if (held) { pending = null; await held.promise; }
        return response;
    } });
    for (const viewport of [
        { name: 'desktop', width: 1440, height: 900 },
        { name: 'narrow', width: 375, height: 812 }
    ]) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto('/dashboard');
        await expect(rows(page)).toHaveCount(2);
        const toolbar = page.locator('.dash-dock .taskbar');
        const reset = toolbar.getByRole('button', { name: 'Reset', exact: true });
        await expect(reset).toHaveAccessibleName('Reset');
        await expect(reset.locator('svg')).toBeVisible();
        await expect(reset).toHaveText('');
        await page.evaluate(() => document.fonts.ready);
        const metrics = () => toolbar.locator('button').evaluateAll(buttons => buttons.slice(0, 3).map(button => {
            const rect = button.getBoundingClientRect();
            const style = getComputedStyle(button);
            return {
                width: rect.width, height: rect.height, top: rect.top - buttons[0].getBoundingClientRect().top,
                background: style.backgroundColor, border: style.border,
                radius: style.borderRadius, padding: style.padding
            };
        }));
        await page.mouse.move(0, 0);
        const ready = await metrics();
        expect(ready).toHaveLength(3);
        expect(ready[2]).toEqual(ready[0]);
        expect(ready[2]).toEqual(ready[1]);
        const readyScreenshot = testInfo.outputPath(`server-log-toolbar-${viewport.name}.png`);
        await toolbar.screenshot({ path: readyScreenshot, animations: 'disabled' });
        await testInfo.attach(`server-log-toolbar-${viewport.name}`, { path: readyScreenshot, contentType: 'image/png' });

        const held = gate();
        pending = held;
        try {
            await reset.click();
            await expect(reset).toBeDisabled();
            await expect(reset).toHaveAccessibleName('Reset');
            await expect(reset).toHaveText('');
            await expect(reset.locator('svg')).toBeVisible();
            await expect(reset).toHaveAttribute('title', 'Resetting displayed log…');
            await page.mouse.move(0, 0);
            expect(await metrics()).toEqual(ready);
            const loadingScreenshot = testInfo.outputPath(`server-log-toolbar-${viewport.name}-loading.png`);
            await toolbar.screenshot({ path: loadingScreenshot, animations: 'disabled' });
            await testInfo.attach(`server-log-toolbar-${viewport.name}-loading`, { path: loadingScreenshot, contentType: 'image/png' });
            held.release();
            await expect(reset).toBeEnabled();
        } finally { held.release(); pending = null; }
    }
});
