import { defineConfig } from 'vite';
import path from 'node:path';
const core = path.resolve(import.meta.dirname, '../../web-administrator/client/core');
function externalLayers(map) {
    const lookup = new Map();
    for (const [pkg, files] of Object.entries(map)) for (const f of files) lookup.set(path.join(core, f), pkg);
    return {
        name: 'oie-external-layers', enforce: 'pre',
        async resolveId(source, importer, options) {
            if (!importer) return null;
            const r = await this.resolve(source, importer, { ...options, skipSelf: true });
            if (r && lookup.has(path.resolve(r.id))) return { id: lookup.get(path.resolve(r.id)), external: true };
            return null;
        }
    };
}
export default defineConfig({
    plugins: [externalLayers({ '@oie/web-api': ['api.js', 'mirth.js'], '@oie/web-ui': ['ui.js', 'columns.js', 'codeeditor.js'] })],
    build: { outDir: 'dist', emptyOutDir: true, lib: { entry: 'index.js', formats: ['es'], fileName: () => 'index.js' },
        rollupOptions: { external: ['@oie/web-api', '@oie/web-ui'] } }
});
