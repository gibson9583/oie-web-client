/* Unit tests for the icon registry (core/icons.js) — the DOM-free surface:
   registerIcon + iconPath. icon() builds an SVGElement and needs a browser. */
import { registerIcon, iconPath } from './icons.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.error('  FAIL -', label); } };

const warnings = [];
console.warn = (msg) => warnings.push(String(msg));

const INFO = iconPath('info');

// Unknown names fall back to the info glyph.
ok(iconPath('no-such-glyph') === INFO, 'unknown name falls back to info');

// A registered glyph resolves by name.
registerIcon('helmet', 'M5 20v-7a7 7 0 0 1 14 0v7');
ok(iconPath('helmet') === 'M5 20v-7a7 7 0 0 1 14 0v7', 'registered glyph resolves');

// Re-registering a plugin name overwrites (same rule as other name-keyed registries).
registerIcon('helmet', 'M4 20h16');
ok(iconPath('helmet') === 'M4 20h16', 're-registration overwrites');

// Built-in names are protected: lookup unchanged, a warning is emitted.
registerIcon('info', 'M0 0h24v24H0z');
ok(iconPath('info') === INFO, 'built-in name is not overridden');
ok(warnings.some(w => w.includes("'info'")), 'built-in override warns');

// Empty/invalid registrations are ignored with a warning.
registerIcon('blank', '   ');
ok(iconPath('blank') === INFO, 'blank path data is rejected');
registerIcon('', 'M1 1h1');
ok(warnings.length >= 3, 'invalid registrations warn');

console.log(`icons.test: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
