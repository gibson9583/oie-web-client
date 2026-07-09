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

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
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
