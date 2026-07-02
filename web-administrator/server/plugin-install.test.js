'use strict';
/*
 * Tests for the web-admin plugin install/uninstall forward. Install is now a thin
 * pass-through to the engine (no local extraction), so the only unit-testable piece
 * is the CSRF header guard; the forward + relay behaviour is covered by e2e.
 */
const assert = require('assert');
const { csrfOk } = require('./plugin-install.js');

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ok  -', name); }
    catch (e) { failures++; console.error('  FAIL -', name, '\n      ', e.message); }
}

console.log('plugin-install.test.js');

test('csrfOk requires X-Requested-With', () => {
    assert.strictEqual(csrfOk({ headers: { 'x-requested-with': 'OpenIntegrationEngine-WebAdmin' } }), true);
    assert.strictEqual(csrfOk({ headers: {} }), false);
});

if (failures) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
console.log('  all passed');
