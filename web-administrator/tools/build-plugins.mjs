/*
 * Builds first-party plugin web entries authored in React: plugins/<id>/web/
 * plugin.jsx -> plugin.js (the served entry named in plugin.json). JSX compiles
 * to React.createElement; the plugin gets React from platform.React (in scope),
 * so plugin components share the host's single React instance without importing
 * react. The @oie/web-* framework imports stay external (resolved at runtime by
 * the index.html importmap -> /core/pkg-*.js), same as hand-written plugins.
 *
 * Run by `npm run build` (after vite build). A plugin with no plugin.jsx is left
 * as-is (hand-written plugin.js / third-party plugins are untouched).
 */
import { build } from 'esbuild';
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginsDir = path.join(root, 'plugins');

const entryPoints = {};
for (const dirent of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const jsx = path.join(pluginsDir, dirent.name, 'web', 'plugin.jsx');
    if (existsSync(jsx)) entryPoints[`plugins/${dirent.name}/web/plugin`] = jsx;
}

const names = Object.keys(entryPoints);
if (!names.length) { console.log('[build-plugins] no React (.jsx) plugin entries'); process.exit(0); }

await build({
    entryPoints,
    outdir: root,
    bundle: true,
    format: 'esm',
    target: 'es2022',
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    // The shared framework + React (via platform) are resolved at runtime, not bundled.
    external: ['@oie/web-api', '@oie/web-ui', '@oie/web-shell'],
    logLevel: 'warning',
});
console.log(`[build-plugins] built ${names.length} React plugin(s): ${names.map(n => n.split('/')[1]).join(', ')}`);
