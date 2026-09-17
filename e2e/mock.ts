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
 * so the SPA runs end-to-end with no engine. Unexpected writes fail the test;
 * read-only requests may return an empty collection. Query-specific fixtures
 * take precedence over path-only defaults. Async fixtures can hold responses
 * to exercise ordering and partial completion.
 *
 *   await mockEngine(page);                              // happy-path defaults
 *   await mockEngine(page, { 'GET /users/current': { __status: 401 } });  // override
 */
export async function mockEngine(page: any, overrides = {}) {
    const normalize = (key: string) => {
        const space = key.indexOf(' ');
        const url = new URL(key.slice(space + 1), 'http://fixture');
        url.searchParams.sort();
        return `${key.slice(0, space)} ${url.pathname}${url.search}`;
    };
    const fixtures = Object.fromEntries(Object.entries({ ...DEFAULT_FIXTURES, ...overrides })
        .map(([key, value]) => [normalize(key), value]));
    const patterns = Object.keys(fixtures).filter((k) => k.includes('*'));

    await page.route('**/api/**', async (route: any) => {
        const req = route.request();
        const url = new URL(req.url());
        const path = url.pathname.replace(/^\/api/, '');
        url.searchParams.sort();
        const key = `${req.method()} ${path}`;
        const queryKey = key + url.search;

        let fx: any;
        for (const candidate of [...new Set([queryKey, key])]) {
            if (Object.hasOwn(fixtures, candidate)) { fx = fixtures[candidate]; break; }
            for (const p of patterns) {
                const [method, pat] = p.split(' ');
                if (method !== req.method()) continue;
                if (pat.includes('?') !== candidate.includes('?')) continue;
                const re = new RegExp('^' + pat.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/?]+') + '$');
                if (re.test(candidate.slice(method.length + 1))) { fx = fixtures[p]; break; }
            }
            if (fx !== undefined) break;
        }

        if (typeof fx === 'function') fx = await fx(req);
        if (fx === undefined) {
            if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
                const message = `Unexpected engine mutation: ${queryKey}\nBody: ${req.postData() ?? '<empty>'}`;
                await route.fulfill({ status: 501, contentType: 'text/plain', body: message });
                throw new Error(message);
            }
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
