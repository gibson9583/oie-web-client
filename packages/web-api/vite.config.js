import { defineConfig } from 'vite';

// Library build: bundle the barrel (which re-exports the canonical web-admin
// source) into a single self-contained ESM file for publishing. Plugin authors
// import this for types + local builds; at runtime the web admin substitutes its
// own shared instance via the import map.
export default defineConfig({
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        lib: {
            entry: 'index.js',
            formats: ['es'],
            fileName: () => 'index.js'
        }
    }
});
