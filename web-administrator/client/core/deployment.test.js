import assert from 'node:assert/strict';
import { normalizeBasePath, joinBasePath, stripBasePath } from './deployment.js';

assert.equal(normalizeBasePath(''), '');
assert.equal(normalizeBasePath('/'), '');
assert.equal(normalizeBasePath('/oie/oie-webadmin/'), '/oie/oie-webadmin');
assert.equal(normalizeBasePath('oie-webadmin'), '/oie-webadmin');

assert.equal(joinBasePath('', '/api/users/current'), '/api/users/current');
assert.equal(joinBasePath('/oie-webadmin', '/assets/logo.svg'), '/oie-webadmin/assets/logo.svg');
assert.equal(joinBasePath('/oie-webadmin', ''), '/oie-webadmin');

assert.equal(stripBasePath('/dashboard', ''), '/dashboard');
assert.equal(stripBasePath('/oie-webadmin', '/oie-webadmin'), '/');
assert.equal(stripBasePath('/oie-webadmin/channels/1', '/oie-webadmin'), '/channels/1');
assert.equal(stripBasePath('/other/channels', '/oie-webadmin'), '/other/channels');

console.log('deployment tests passed');
