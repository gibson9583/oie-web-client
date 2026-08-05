/*
 * Vendors third-party npm packages that the EXTERNAL framework modules
 * (client/core/*.js, served raw — see vite.config.mjs externalFramework) import
 * by bare specifier. Vite never processes those raw files in a built app, so a
 * bare `import ... from 'js-beautify'` reaches the browser unresolved and crashes
 * the whole SPA. We bundle each such dep to a browser-native ESM file under
 * client/vendor/ and map the bare specifier to it in the page import map
 * (client/index.html), so the raw core module resolves it at runtime.
 *
 * In dev this is unused: externalFramework is build-only, so Vite bundles the core
 * modules and resolves the deps itself; the import-map entry is inert.
 */

import { fileURLToPath } from 'node:url';

// esbuild is a devDependency. On a production install (`npm ci --omit=dev`)
// it is absent — and that is fine: the vendored bundles it produces are
// committed, so regeneration is a development convenience, not a boot
// requirement. Skip gracefully instead of crashing `npm start`.
let build;
try { ({ build } = await import('esbuild')); }
catch {
    console.log('[build-vendor] esbuild not installed (production install?) — using the committed vendor bundles.');
    process.exit(0);
}
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const clientDir = resolve(here, '..', 'client');

// Bare specifier -> entry that re-exports it. Add future core-imported deps here.
const VENDOR = {
    // js-beautify is CJS; import the module object and re-export its members as
    // named ESM exports so `import { js } from 'js-beautify'` resolves.
    'js-beautify': "import pkg from 'js-beautify'; export const js = pkg.js; export const css = pkg.css; export const html = pkg.html; export default pkg;",
    'qrcode-generator': "import qrcode from 'qrcode-generator'; export default qrcode;"
};

for (const [pkg, entry] of Object.entries(VENDOR)) {
    await build({
        stdin: { contents: entry, resolveDir: clientDir, loader: 'js' },
        outfile: resolve(clientDir, 'vendor', `${pkg}.js`),
        bundle: true,
        format: 'esm',
        platform: 'browser',
        target: 'es2022',
        legalComments: 'none'
    });
    console.log(`[build-vendor] bundled ${pkg} -> client/vendor/${pkg}.js`);
}

/*
 * Monaco is special: a large multi-module ESM package with its own CSS + webfont
 * that also spawns web workers. core/monaco.js imports it via the 'monaco-editor'
 * specifier (mapped to /vendor/monaco/editor.main.js in the page import map) and
 * constructs the workers from /vendor/monaco/*.worker.js. Everything is bundled
 * here into client/vendor/monaco/ so it loads self-hosted (no CDN, air-gapped) as
 * modern ESM — replacing the deprecated AMD min/vs loader.
 */
const monacoOut = resolve(clientDir, 'vendor', 'monaco');
// Editor namespace (ESM). esbuild emits editor.main.css alongside (Monaco's CSS
// isn't auto-injected the way Vite/webpack do it); core/monaco.js links it. The
// codicon webfont is inlined as a data URL so there are no separate asset files
// or path rewrites to serve.
await build({
    // monaco-editor >=0.53 ships an `exports` map that rewrites `monaco-editor/*`
    // to `esm/vs/*`; the old deep `esm/vs/...` specifier now double-resolves, so
    // reference the exports-map path (the `esm/vs/` prefix is added back for us).
    entryPoints: { 'editor.main': 'monaco-editor/editor/editor.main.js' },
    outdir: monacoOut,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    loader: { '.ttf': 'dataurl' }
});
// Language-service workers — self-contained classic (IIFE) scripts loaded via
// new Worker(url). Each bundles its own dependencies, so there's no importScripts
// / AMD baseUrl dance.
await build({
    entryPoints: {
        'editor.worker': 'monaco-editor/editor/editor.worker.js',
        'ts.worker': 'monaco-editor/language/typescript/ts.worker.js',
        'json.worker': 'monaco-editor/language/json/json.worker.js',
        'css.worker': 'monaco-editor/language/css/css.worker.js',
        'html.worker': 'monaco-editor/language/html/html.worker.js'
    },
    outdir: monacoOut,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'none'
});
console.log('[build-vendor] bundled monaco-editor -> client/vendor/monaco/ (editor.main.js + 5 workers)');
