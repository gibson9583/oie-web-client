import { test, expect } from '@playwright/test';

/*
 * The Node server sets security headers on every response (server/index.js):
 * a Content-Security-Policy, plus X-Content-Type-Options and Referrer-Policy
 * (Security Phase 1 §1.2). These assert against the REAL running server — no
 * engine needed, since the document loads before any /api call.
 */
test.describe('security headers', () => {
    test('the app document carries CSP, nosniff, and Referrer-Policy', async ({ page }) => {
        const resp = await page.goto('/');
        expect(resp, 'the app document responded').toBeTruthy();
        const h = resp!.headers();

        expect(h['x-content-type-options']).toBe('nosniff');
        expect(h['referrer-policy']).toBe('same-origin');
        expect(h['content-security-policy']).toContain("default-src 'self'");
        // x-powered-by is disabled so the server doesn't advertise Express.
        expect(h['x-powered-by']).toBeUndefined();
    });

    test('script-src is nonce-based — no unsafe-inline or unsafe-eval', async ({ page }) => {
        for (const path of ['/', '/index.html', '/dashboard']) {
            const resp = await page.request.get(path);
            const csp = resp.headers()['content-security-policy'];
            const scriptSrc = csp.split(';').map((s) => s.trim()).find((s) => s.startsWith('script-src'));
            expect(scriptSrc, `${path} script-src`).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
            expect(scriptSrc, `${path} script-src`).not.toContain('unsafe-inline');
            expect(scriptSrc, `${path} script-src`).not.toContain('unsafe-eval');

            // The served shell's importmap (its one inline script) carries the SAME
            // nonce the header authorizes — on every path that can serve the shell,
            // including the raw-file route that must not bypass the injection.
            const nonce = /'nonce-([^']+)'/.exec(scriptSrc!)![1];
            const html = await resp.text();
            expect(html, `${path} importmap nonce`).toContain(`<script type="importmap" nonce="${nonce}"`);
        }
    });

    test('the pre-auth config endpoint no longer discloses engine URLs (§1.3)', async ({ page }) => {
        const resp = await page.request.get('/webadmin/config.json');
        expect(resp.ok()).toBeTruthy();
        const cfg = await resp.json();

        // Engines are advertised by name only; no URL reaches the browser.
        expect(Array.isArray(cfg.engines)).toBeTruthy();
        expect(cfg).not.toHaveProperty('engineUrl');
        for (const e of cfg.engines) {
            expect(e).toHaveProperty('name');
            expect(e).not.toHaveProperty('url');
        }
    });
});
