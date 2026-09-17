import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
// Monaco embeds a separate source copy, so an npm override alone is insufficient.
// Both Vite development and the production vendor build use the patched ESM file.
export const sanitizerEntry = resolve(dirname(require.resolve('dompurify')), 'purify.es.mjs');
export const monacoMain = require.resolve('monaco-editor/editor/editor.main.js');
export const embeddedSanitizer = resolve(dirname(monacoMain), '../base/browser/dompurify/dompurify.js');
