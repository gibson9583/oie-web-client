import { DEFAULT_FIXTURES } from './fixtures.js';

/*
 * Intercept every /api/* request in the browser and fulfill it from fixtures,
 * so the SPA runs end-to-end with no engine. Unmatched calls return an empty
 * body (parseBody → null → asList → []) so the app never hangs or crashes on a
 * call a test didn't anticipate.
 *
 *   await mockEngine(page);                              // happy-path defaults
 *   await mockEngine(page, { 'GET /users/current': { __status: 401 } });  // override
 */
export async function mockEngine(page, overrides = {}) {
    const fixtures = { ...DEFAULT_FIXTURES, ...overrides };
    const patterns = Object.keys(fixtures).filter((k) => k.includes('*'));

    await page.route('**/api/**', async (route) => {
        const req = route.request();
        const path = new URL(req.url()).pathname.replace(/^\/api/, '');
        const key = `${req.method()} ${path}`;

        let fx = fixtures[key];
        if (fx === undefined) {
            for (const p of patterns) {
                const [method, pat] = p.split(' ');
                if (method !== req.method()) continue;
                const re = new RegExp('^' + pat.replace(/[.]/g, '\\.').replace(/\*/g, '[^/]+') + '$');
                if (re.test(path)) { fx = fixtures[p]; break; }
            }
        }

        if (typeof fx === 'function') fx = fx(req);
        if (fx === undefined) {
            return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
        }
        if (typeof fx === 'string') {
            return route.fulfill({ status: 200, contentType: 'text/plain', body: fx });
        }
        if (fx && fx.__status) {
            return route.fulfill({ status: fx.__status, contentType: 'application/json', body: JSON.stringify(fx.body ?? {}) });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fx) });
    });
}

/** Sign in through the real login form (used when current → 401). */
export async function login(page, username = 'admin', password = 'admin') {
    await page.getByPlaceholder('admin').fill(username);
    await page.locator('input[type=password]').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
}
