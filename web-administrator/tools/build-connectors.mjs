/*
 * Builds the React connector library: client/connectors/*.jsx -> *.js, the
 * raw-served modules the bundled connector-* plugins load by URL (and that
 * pkg-ui re-exports for third-party connectors). Like tools/build-plugins.mjs
 * but transpile-only (bundle:false): JSX compiles to React.createElement while
 * every import is kept as-is, so the served .js resolves /core/*, /connectors/*
 * and @oie/* at runtime through the page importmap — one shared framework
 * instance. React is taken (lazily) from ./react-platform.js, never bundled.
 *
 * Run by `npm run build` (after vite build + build-plugins). A connector with no
 * .jsx source is left as-is.
 */
import { build } from 'esbuild';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const connectorsDir = path.join(root, 'client', 'connectors');

const entryPoints = {};
for (const name of readdirSync(connectorsDir)) {
    if (!name.endsWith('.jsx')) continue;
    entryPoints[`client/connectors/${name.slice(0, -4)}`] = path.join(connectorsDir, name);
}

const names = Object.keys(entryPoints);
if (!names.length) { console.log('[build-connectors] no React (.jsx) connector entries'); process.exit(0); }

await build({
    entryPoints,
    outdir: root,
    bundle: false,           // transpile only — keep every import for raw-serving
    format: 'esm',
    target: 'es2022',
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    logLevel: 'warning',
});
console.log(`[build-connectors] built ${names.length} React connector module(s): ${names.map(n => n.split('/').pop()).join(', ')}`);
