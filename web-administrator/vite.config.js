import { defineConfig } from 'vite';
import path from 'node:path';

const clientDir = path.join(import.meta.dirname, 'client');

/*
 * The shared framework (everything under client/core/ and client/connectors/) is
 * what runtime-loaded plugins import by absolute URL (`/core/ui.js`,
 * `/connectors/forms.js`, …). For the app and those plugins to share ONE
 * framework instance (the platform registries, the store, the api session), the
 * app bundle must NOT inline the framework — it must import it from the same
 * stable URLs the plugins use. This plugin marks any import that resolves into
 * core/ or connectors/ as an external `/core/*.js` / `/connectors/*.js` URL.
 *
 * Build-only: in dev, Vite serves/HMRs the framework normally (single instance
 * already, since everything is one module graph).
 */
function externalFramework() {
    const FRAMEWORK = /^(core|connectors)[\\/]/;
    return {
        name: 'oie-external-framework',
        apply: 'build',
        enforce: 'pre',
        async resolveId(source, importer, options) {
            if (!importer) return null;
            const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
            if (!resolved || resolved.external) return null;
            const rel = path.relative(clientDir, resolved.id);
            if (FRAMEWORK.test(rel)) {
                return { id: '/' + rel.split(path.sep).join('/'), external: true };
            }
            return null;
        }
    };
}

export default defineConfig({
    root: 'client',
    plugins: [externalFramework()],
    server: { hmr: true },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        target: 'es2022',
        // Keep the framework's `/core/*.js` external imports as absolute URLs
        // (don't rewrite them to relative paths).
        rollupOptions: {
            makeAbsoluteExternalsRelative: false
        }
    }
});
