import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

// Exercise the shared transport fixture without launching Playwright or a server.
const bundle = await build({ entryPoints: ['e2e/mock.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { mockEngine, fixtureXml } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('XML persistence assertions retain fields, attributes, text and list order', () => {
    const expected = { '@version': '4.6.0', timeout: '1000', empty: '', enabled: 'false', entries: { string: ['first', 'second'] } };
    const decoded = { ...expected, timeout: 1000, empty: null, enabled: false };
    assert.equal(fixtureXml('properties', decoded), fixtureXml('properties', expected));
    for (const changed of [{ ...decoded, timeout: 1001 }, { ...decoded, empty: undefined, extra: '' },
        { ...decoded, '@version': '4.7.0' }, { ...decoded, entries: { string: ['second', 'first'] } }]) {
        assert.notEqual(fixtureXml('properties', changed), fixtureXml('properties', expected));
    }
    const missing = { ...decoded }; delete missing.empty;
    assert.notEqual(fixtureXml('properties', missing), fixtureXml('properties', expected));
    assert.equal(fixtureXml('text', '001'), '<text>001</text>');
    assert.equal(fixtureXml('text', 'null'), '<text>null</text>');
    assert.equal(fixtureXml('text', { '@class': 'string', $: '<&"\r\n' }), '<text class="string">&lt;&amp;&quot;&#xd;\n</text>');
    assert.equal(fixtureXml('connector', [{ id: 'one' }]), fixtureXml('connector', { id: 'one' }));
});

for (const channel of [null, { id: 'fixture', revision: 1, sourceConnector: { name: 'Source' } }]) {
    test(`single-channel XML mock returns ${channel ? 'the complete channel' : 'the engine null root'}`, async () => {
        let handler;
        await mockEngine({ route: async (_pattern, callback) => { handler = callback; } }, { 'GET /channels/fixture': { channel } });
        let response;
        await handler({ request: () => ({ url: () => 'http://fixture/api/channels/fixture', method: () => 'GET', headers: () => ({ accept: 'application/xml' }) }),
            fulfill: async value => { response = value; } });
        assert.equal(response.contentType, 'application/xml');
        assert.equal(response.body, channel ? '<channel><id>fixture</id><revision>1</revision><sourceConnector><name>Source</name></sourceConnector></channel>' : '<null/>');
    });
}
