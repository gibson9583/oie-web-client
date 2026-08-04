/*
 * Builds first-party plugin web entries: plugins/<id>/web/plugin.tsx|plugin.ts
 * -> plugin.js (the served entry named in plugin.json). JSX compiles to
 * React.createElement; the plugin gets React from platform.React (in scope),
 * so plugin components share the host's single React instance without importing
 * react. The @oie/web-* framework imports stay external (resolved at runtime by
 * the index.html importmap -> /core/pkg-*.js), and so do the raw-served
 * /core/* and /connectors/* absolute URLs — same as hand-written plugins.
 * Type-checking is tsconfig.plugins.json (via `npm run typecheck`); this emit
 * stays esbuild because plugin entries are BUNDLED, not twinned.
 *
 * Run by `npm run build` (after vite build). A plugin with no TypeScript entry
 * is left as-is (hand-written plugin.js / third-party plugins are untouched).
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
    for (const ext of ['tsx', 'ts']) {
        const entry = path.join(pluginsDir, dirent.name, 'web', `plugin.${ext}`);
        if (existsSync(entry)) { entryPoints[`plugins/${dirent.name}/web/plugin`] = entry; break; }
    }
}

const names = Object.keys(entryPoints);
if (!names.length) { console.log('[build-plugins] no TypeScript plugin entries'); process.exit(0); }

await build({
    // Pin the working dir so the entry-path comment esbuild writes into each
    // bundle is identical no matter where the tool is invoked from (the CI
    // drift check compares bytes).
    absWorkingDir: root,
    entryPoints,
    outdir: root,
    bundle: true,
    format: 'esm',
    target: 'es2022',
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    // The shared framework + React (via platform) are resolved at runtime, not bundled.
    external: ['@oie/web-api', '@oie/web-ui', '@oie/web-shell', '/core/*', '/connectors/*', '/datatypes/*'],
    logLevel: 'warning',
});
console.log(`[build-plugins] built ${names.length} plugin(s): ${names.map(n => n.split('/')[1]).join(', ')}`);
