/* @oie/web-api public surface — engine REST client + model helpers.
   Served barrel (import-map + Vite-alias target). */
export { default } from './api.js';
export * from './api.js';
export * from './oie.js';
// Engine-backed script validation/formatting — the sanctioned path for plugins
// that need to check user scripts (the CSP allows no eval/new Function).
export { validateScript, formatScript } from './serialize.js';
