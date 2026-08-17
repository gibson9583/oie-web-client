import assert from 'node:assert/strict';
import { normalizeBasePath, joinBasePath, stripBasePath } from './deployment.js';

assert.equal(normalizeBasePath(''), '');
assert.equal(normalizeBasePath('/'), '');
assert.equal(normalizeBasePath('/oie/oie-web-client/'), '/oie/oie-web-client');
assert.equal(normalizeBasePath('oie-web-client'), '/oie-web-client');

assert.equal(joinBasePath('', '/api/users/current'), '/api/users/current');
assert.equal(joinBasePath('/oie-web-client', '/assets/logo.svg'), '/oie-web-client/assets/logo.svg');
assert.equal(joinBasePath('/oie-web-client', ''), '/oie-web-client');

assert.equal(stripBasePath('/dashboard', ''), '/dashboard');
assert.equal(stripBasePath('/oie-web-client', '/oie-web-client'), '/');
assert.equal(stripBasePath('/oie-web-client/channels/1', '/oie-web-client'), '/channels/1');
assert.equal(stripBasePath('/other/channels', '/oie-web-client'), '/other/channels');

console.log('deployment tests passed');
