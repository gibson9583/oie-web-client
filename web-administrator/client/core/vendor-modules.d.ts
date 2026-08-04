/*
 * Ambient types for vendored third-party modules. At runtime these specifiers
 * resolve through the page importmap to the bundles built by
 * tools/build-vendor.mjs (e.g. 'js-beautify' -> /vendor/js-beautify.js), so
 * node_modules types don't apply — the upstream package ships none anyway.
 * Declare only the surface the core modules actually use.
 */

declare module 'js-beautify' {
    /** js-beautify's JavaScript formatter (the `js` export of the vendored bundle). */
    export const js: (source: string, options?: Record<string, unknown>) => string;
}
