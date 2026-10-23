'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertSupportedNodeVersion } = require('./runtime-version.js');

test('accept patched releases on each supported Node line', () => {
    for (const version of ['22.23.4', '22.23.5', '22.24.0', '24.22.1', '24.23.0', '26.12.1', '26.13.0']) {
        assert.doesNotThrow(() => assertSupportedNodeVersion(version), version);
    }
});
test('reject vulnerable, unsupported and prerelease runtimes', () => {
    for (const version of ['18.20.8', '20.19.5', '22.18.0', '22.22.3', '22.23.3', '23.11.0', '24.22.0', '25.9.0', '26.3.0', '26.12.0', '26.12.1-rc.1', '27.0.0', 'invalid']) {
        assert.throws(() => assertSupportedNodeVersion(version), /CVE-2026-111497 requires Node.js/, version);
    }
});
