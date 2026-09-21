// Runs against a started deployment; never starts/stops shared services.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';

const base = process.argv[2];
assert(base, 'Pass the owned deployment URL');
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const commit = process.env.BUILD_COMMIT || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const request = async path => {
    const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(3000) });
    assert(response.ok, `${path}: HTTP ${response.status}`);
    return response;
};
let config;
for (let attempt = 0; attempt < 60; attempt++) {
    try { config = await (await request('/webadmin/config.json')).json(); break; }
    catch (error) { if (attempt === 59) throw error; await setTimeout(500); }
}
assert.equal(config.version, version);
assert.equal(config.build.commit, commit);
assert.equal(config.build.dirty, false);
const html = await (await request('/')).text();
assert.match(html, /oie-webadmin-api-base/);
const script = html.match(/<script[^>]*src="([^"]+)"/);
assert(script, 'The shell must reference its built JavaScript');
for (const asset of [script[1], '/core/api.js', '/vendor/monaco/editor.main.js']) {
    assert.match((await request(asset)).headers.get('content-type') || '', /javascript/,
        `${asset} must serve JavaScript, not the SPA fallback`);
}
const plugins = await (await request('/webadmin/plugins.json')).json();
assert(Array.isArray(plugins) && plugins.length > 0, 'Bundled plugins must be discoverable');
for (const plugin of plugins.filter(plugin => plugin.entry)) {
    assert.match((await request(plugin.entry)).headers.get('content-type') || '', /javascript/);
}
console.log(`Runtime smoke passed: ${version} ${commit}`);
