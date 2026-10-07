import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { listen } from './server-harness.js';

test.beforeEach(async ({ page }) => {
    await mockEngine(page);
});

test('stylesheets load fonts as same-origin files that the CSP allows', async ({ request }) => {
    const shell = await (await request.get('/')).text();
    const sheets = [...shell.matchAll(/href="([^"]+\.css)"/g)].map(match => match[1]);
    sheets.push('/vendor/monaco/editor.main.css');
    for (const sheet of sheets) {
        expect(await (await request.get(sheet)).text(), sheet).not.toContain('data:font');
    }
    const monacoCss = await (await request.get('/vendor/monaco/editor.main.css')).text();
    const codicon = monacoCss.match(/url\(["']?([^"')]+\.ttf)["']?\)/)?.[1];
    expect(codicon).toBeTruthy();
    const font = await request.get(new URL(codicon!, 'http://host/vendor/monaco/editor.main.css').pathname);
    expect(font.status()).toBe(200);
});

test('the find widget draws its icons', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', message => { if (/Content Security Policy/i.test(message.text())) violations.push(message.text()); });
    await page.goto('/global-scripts');
    await page.locator('.ce-monaco .monaco-editor .view-lines').first().click();
    const mac = await page.evaluate(() => navigator.userAgent.includes('Macintosh'));
    await page.keyboard.press(mac ? 'Meta+f' : 'Control+f');
    const regex = page.locator('.find-widget [aria-label^="Use Regular Expression"]').first();
    await expect(regex).toBeVisible();
    await expect.poll(() => page.evaluate(() => [...document.fonts]
        .filter(face => face.family.replace(/["']/g, '') === 'codicon').map(face => face.status)))
        .toEqual(['loaded']);
    expect(violations).toEqual([]);
});

for (const base of ['', '/engine/custom-admin']) {
    test(`an upgrade replaces cached inline-font CSS at ${base || '/'}`, async ({ browser, request, baseURL }) => {
        const cssPath = '/vendor/monaco/editor.main.css';
        const css = await (await request.get(cssPath)).text();
        const fontUrl = css.match(/url\(["']?([^"')]+\.ttf)["']?\)/)![1];
        const font = await (await request.get(new URL(fontUrl, baseURL + cssPath).href)).body();
        const oldCss = css.replace(fontUrl, `data:font/ttf;base64,${font.toString('base64')}`);
        let upgraded = false;
        const cssRequests: string[] = [];
        const server = await listen((req, res) => {
            const url = new URL(req.url!, 'http://localhost');
            const path = url.pathname.slice(base.length);
            if (path === cssPath) {
                cssRequests.push(url.pathname + url.search);
                res.setHeader('Content-Type', 'text/css');
                res.setHeader('Cache-Control', 'public, max-age=86400');
                res.end(upgraded ? css : oldCss);
            } else if (path === '/') {
                res.setHeader('Content-Type', 'text/html');
                res.setHeader('Cache-Control', 'no-store');
                res.setHeader('Content-Security-Policy', "font-src 'self'");
                res.end(`<base href="${base}/"><meta name="oie-webadmin-app-base" content="${base}">
                    <script type="importmap">{"imports":{"js-beautify":"${base}/vendor/js-beautify.js"}}</script>
                    <span style="font-family: codicon">&#xea6d;</span>
                    ${url.searchParams.has('runtime') ? `<script type="module">
                        import { ensureMonaco } from './core/monaco.js';
                        await Promise.all([ensureMonaco(), ensureMonaco()]);
                    </script>` : `<link id="oie-monaco-css" rel="stylesheet" href="${base + cssPath}">`}`);
            } else {
                void fetch(baseURL + path).then(async response => {
                    res.writeHead(response.status, { 'Content-Type': response.headers.get('content-type') || 'application/octet-stream' });
                    res.end(Buffer.from(await response.arrayBuffer()));
                }).catch(() => { res.writeHead(502); res.end(); });
            }
        });
        // Routing disables the browser HTTP cache. Use an unrouted context and
        // a real server so the stale, still-fresh stylesheet is actually reused.
        const context = await browser.newContext();
        const page = await context.newPage();
        const fontStatus = () => page.evaluate(async () => {
            const font = [...document.fonts].find(face => face.family.replace(/["']/g, '') === 'codicon');
            await font?.load().catch(() => {});
            return font?.status;
        });
        try {
            await page.goto(server.url + base + '/');
            await expect.poll(fontStatus).toBe('error');
            await page.evaluate(() => localStorage.setItem('retained-preference', 'keep'));
            upgraded = true;
            // Positive control: new server bytes alone cannot repair a fresh cache.
            await page.goto(server.url + base + '/?unchanged-url');
            await expect.poll(fontStatus).toBe('error');
            expect(cssRequests).toEqual([base + cssPath]);

            await page.goto(server.url + base + '/?runtime');
            await expect.poll(fontStatus).toBe('loaded');
            await expect(page.locator('#oie-monaco-css')).toHaveCount(1);
            expect(cssRequests).toHaveLength(2);
            expect(cssRequests[1]).toMatch(new RegExp('^' + base + cssPath.replaceAll('.', '\\.') + '\\?'));
            expect(await page.evaluate(() => localStorage.getItem('retained-preference'))).toBe('keep');
            await page.goto(server.url + base + '/?runtime&again');
            await expect.poll(fontStatus).toBe('loaded');
            expect(cssRequests).toHaveLength(2);
        } finally {
            await context.close();
            server.server.closeAllConnections();
            await new Promise<void>(resolve => server.server.close(() => resolve()));
        }
    });
}
