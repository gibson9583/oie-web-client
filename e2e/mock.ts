import { DEFAULT_FIXTURES } from './fixtures.js';

// These engine reads negotiate XML to preserve Java String fields that the
// engine's JSON bridge treats as primitives. Keep JSON fixtures available for
// their other consumers; individual wire-contract tests can provide raw XML.
function fixtureXml(tag: string, value: any): string {
    if (Array.isArray(value)) return value.map(item => fixtureXml(tag, item)).join('');
    const escape = (text: any) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (value == null) return `<${tag}/>`;
    const content = typeof value === 'object'
        ? Object.entries(value).map(([key, child]) => fixtureXml(key, child)).join('')
        : escape(value);
    return `<${tag}>${content}</${tag}>`;
}

/*
 * Intercept every /api/* request in the browser and fulfill it from fixtures,
 * so the SPA runs end-to-end with no engine. Unmatched calls return an empty
 * body (parseBody → null → asList → []) so the app never hangs or crashes on a
 * call a test didn't anticipate.
 *
 *   await mockEngine(page);                              // happy-path defaults
 *   await mockEngine(page, { 'GET /users/current': { __status: 401 } });  // override
 */
export async function mockEngine(page: any, overrides = {}) {
    const fixtures = { ...DEFAULT_FIXTURES, ...overrides };
    const patterns = Object.keys(fixtures).filter((k) => k.includes('*'));

    await page.route('**/api/**', async (route: any) => {
        const req = route.request();
        const path = new URL(req.url()).pathname.replace(/^\/api/, '');
        const key = `${req.method()} ${path}`;

        let fx = (fixtures as any)[key];
        if (fx === undefined) {
            for (const p of patterns) {
                const [method, pat] = p.split(' ');
                if (method !== req.method()) continue;
                const re = new RegExp('^' + pat.replace(/[.]/g, '\\.').replace(/\*/g, '[^/]+') + '$');
                if (re.test(path)) { fx = (fixtures as any)[p]; break; }
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
        if (req.method() === 'GET' && req.headers().accept?.includes('application/xml')
            && (path === '/server/globalScripts' || /^\/channels\/[^/]+\/status$/.test(path))) {
            return route.fulfill({ status: 200, contentType: 'application/xml',
                body: Object.entries(fx).map(([tag, value]) => fixtureXml(tag, value)).join('') });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fx) });
    });
}

/** Sign in through the real login form (used when current → 401). */
export async function login(page: any, username = 'admin', password = 'admin') {
    await page.getByPlaceholder('admin').fill(username);
    await page.locator('input[type=password]').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
}
