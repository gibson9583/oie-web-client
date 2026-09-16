import { test, expect } from '@playwright/test';
import { listen } from './server-harness.js';
import { rewriteImportMap } from '../web-administrator/tools/war-import-map.mjs';

test('WAR import-map filenames remain JSON data inside the HTML script element', async ({ page }) => {
    const name = 'plugins/demo/</script><script>window.importMapInjection=true</script>/extra.js';
    const html = rewriteImportMap('<base href="https://example.invalid/admin/"><script type="importmap">{"imports":{}}</script>',
        new Map([[name, 'export const value = 1;']]));
    await page.setContent(html);
    expect(await page.evaluate(() => window.importMapInjection)).toBeUndefined();
    await expect(page.locator('script')).toHaveCount(1);
    const map = JSON.parse(await page.locator('script[type=importmap]').textContent());
    expect(map.imports[`./${name}`]).toMatch(/\?v=[a-f0-9]{64}$/);
    expect(map.imports[`./${name}`].split('?')[0]).toBe(`./${name}`);
});

for (const base of ['/oie-webadmin', '/engine/custom-admin']) {
    test(`WAR upgrade replaces cached modules and preserves shared state at ${base}`, async ({ page }) => {
        // Real HTTP caching is essential: page.route() disables the cache and
        // would hide the stale-module failure this test must reproduce.
        let generation = 'old';
        let versioned = false;
        const requests = [];
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const modules = () => new Map([
            ['core/generation.js', `export const generation = '${generation}';`],
            ['core/api.js', `
                export { generation } from './generation.js';
                window.apiEvaluations = (window.apiEvaluations || 0) + 1;
                export const state = {};
                ${generation === 'old' ? '' : 'export function purgeChannelDrafts() { return true; }'}
            `],
            ['core/pkg-api.js', `export * from './api.js';`],
            ['plugins/demo/plugin.js', `export { state } from '/core/api.js';`],
        ]);
        const server = await listen((req, res) => {
            const url = new URL(req.url, 'http://localhost');
            requests.push(url.pathname + url.search);
            const source = modules().get(url.pathname.slice(base.length + 1));
            if (source !== undefined) {
                res.setHeader('Content-Type', 'text/javascript');
                res.setHeader('Cache-Control', 'public, max-age=86400');
                res.end(source);
                return;
            }
            const imports = {
                '@oie/web-api': '/core/pkg-api.js',
                '/core/': '/core/',
                '/plugins/': '/plugins/',
            };
            const script = generation === 'old'
                ? `import { generation } from '@oie/web-api'; document.body.textContent = generation;`
                : `
                    import { state, generation, purgeChannelDrafts } from '@oie/web-api';
                    import { state as rootState } from '/core/api.js';
                    import { state as relativeState } from './core/api.js';
                    const plugin = await import('${base}/plugins/demo/plugin.js');
                    const blob = URL.createObjectURL(new Blob([
                        "export { state } from '@oie/web-api';"
                    ], { type: 'text/javascript' }));
                    try {
                        const enginePlugin = await import(blob);
                        window.result = {
                            generation, purged: purgeChannelDrafts(), evaluations: window.apiEvaluations,
                            shared: [rootState, relativeState, plugin.state, enginePlugin.state].every(s => s === state)
                        };
                        document.body.textContent = generation;
                    } finally { URL.revokeObjectURL(blob); }
                `;
            let html = `<base href="${base}/"><script type="importmap">${JSON.stringify({ imports })}</script>
                <body>Loading<script type="module">${script}</script></body>`;
            if (versioned) html = rewriteImportMap(html, modules());
            else {
                // The old WAR maps root aliases into its context without a
                // version, leaving relative transitive imports cacheable too.
                html = html.replace(JSON.stringify({ imports }), JSON.stringify({ imports:
                    Object.fromEntries(Object.entries(imports).map(([k, v]) => [k, `.${v}`]))
                }));
            }
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('Content-Type', 'text/html');
            res.end(html);
        });
        try {
            await page.goto(server.url + base + '/');
            await expect(page.locator('body')).toHaveText('old');
            const oldRequests = requests.length;

            // Positive control: an upgrade at the same URLs leaves the page
            // stuck because the old cached barrel has no newly added export.
            generation = 'new';
            await page.reload();
            await expect.poll(() => errors.join('\n')).toContain('purgeChannelDrafts');
            expect(requests.slice(oldRequests).filter(p => p.endsWith('.js'))).toEqual([]);
            errors.length = 0;

            versioned = true;
            const upgradeRequests = requests.length;
            await page.reload();
            await expect.poll(() => page.evaluate(() => window.result)).toEqual({
                generation: 'new', purged: true, evaluations: 1, shared: true
            });
            const modulesFetched = requests.slice(upgradeRequests).filter(p => p.includes('.js'));
            expect(modulesFetched).toHaveLength(4);
            expect(modulesFetched.every(p => /\?v=[a-f0-9]{64}$/.test(p))).toBe(true);
            expect(errors).toEqual([]);

            // No release version bump: a change in a transitive module must
            // still invalidate the graph and stay consistent on another reload.
            generation = 'patched';
            await page.reload();
            await expect.poll(() => page.evaluate(() => window.result?.generation)).toBe('patched');
            await page.reload();
            await expect.poll(() => page.evaluate(() => window.result)).toEqual({
                generation: 'patched', purged: true, evaluations: 1, shared: true
            });
            expect(errors).toEqual([]);
        } finally {
            server.server.closeAllConnections();
            await new Promise(resolve => server.server.close(resolve));
        }
    });
}
