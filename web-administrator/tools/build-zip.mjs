import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const packageDir = dirname(require.resolve('@zip.js/zip.js/package.json'));

// Resolve from this workspace: npm may install ZIP here or hoist it to the root.
// Keep the native, worker-free core used by core/zip.ts self-hosted.
await build({
    entryPoints: [resolve(packageDir, 'lib/zip-core.js')],
    outfile: resolve(import.meta.dirname, '../client/vendor/zipjs.min.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'inline'
});
console.log('[build-zip] bundled @zip.js/zip.js -> client/vendor/zipjs.min.js');
