import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectorHasNonDefaultProperties } from './connector-defaults.js';
import { defaultSourceConnector, defaultDestinationConnector } from './oie.js';

const version = '4.6.0';
const factories = { SOURCE: defaultSourceConnector, DESTINATION: defaultDestinationConnector };
const panelFor = mode => ({ defaults: () => {
    const properties = factories[mode](version).properties;
    if (mode === 'DESTINATION') properties.mapVariables = { '@class': 'java.util.ArrayList' };
    return properties;
} });
const changed = (connector, mode = 'SOURCE', panel = panelFor(mode), extensions = []) =>
    connectorHasNonDefaultProperties(connector, mode, version, panel, extensions);

for (const mode of Object.keys(factories)) {
    const commonKey = mode === 'SOURCE' ? 'sourceConnectorProperties' : 'destinationConnectorProperties';

    test(`${mode}: fresh and saved default wire forms do not prompt or mutate`, () => {
        const connector = factories[mode](version);
        assert.equal(changed(connector, mode), false);
        const properties = connector.properties;
        properties['@version'] = '4.5.2';
        properties.pluginProperties = { '@class': 'set' };
        const common = properties[commonKey];
        delete common['@version'];
        for (const key of Object.keys(common)) {
            if (['number', 'boolean'].includes(typeof common[key])) common[key] = String(common[key]);
        }
        common.queueBufferSize = '0';
        common.resourceIds = { entry: { string: ['Default Resource', '[Default Resource]'] } };
        if (mode === 'DESTINATION') delete properties.mapVariables;
        const before = structuredClone(connector);
        assert.equal(changed(connector, mode), false);
        assert.deepEqual(connector, before);
    });

    test(`${mode}: changes to shared settings, resources and unknown plugin data prompt`, () => {
        for (const edit of [
            p => { p[commonKey].queueBufferSize = 2000; },
            p => { p[commonKey].resourceIds = { entry: { string: ['custom', 'Custom Resource'] } }; },
            p => { p.pluginProperties = { 'plugin.CustomProperties': { token: 'keep' } }; },
            p => { p.pluginProperties = { 'plugin.EmptyProperties': { '@version': version } }; },
            p => { p.responseConnectorPluginProperties = { 'plugin.EmptyProperties': null }; },
            p => { p.futureSetting = 'keep'; },
            p => { p['@class'] = 'plugin.CustomConnectorProperties'; },
            p => { delete p[commonKey].queueBufferSize; }
        ]) {
            const connector = factories[mode](version);
            edit(connector.properties);
            const before = structuredClone(connector);
            assert.equal(changed(connector, mode), true);
            assert.deepEqual(connector, before);
        }
    });

    test(`${mode}: connector identity/filter/transformer changes and reverted edits do not prompt`, () => {
        const connector = factories[mode](version);
        connector.name = 'Renamed';
        connector.enabled = false;
        connector.waitForPrevious = false;
        connector.filter.elements = { rule: { script: 'return true;' } };
        connector.transformer.inboundTemplate = 'changed';
        connector.properties[commonKey].queueBufferSize = 5000;
        assert.equal(changed(connector, mode), true);
        connector.properties[commonKey].queueBufferSize = 1000;
        assert.equal(changed(connector, mode), false);
    });
}

test('default plugin entries can be implicit or explicit; other plugin settings are protected', () => {
    const key = 'httpauth.NoneProperties';
    const entry = { '@version': version, authType: 'NONE' };
    const extension = { isSupported: () => true, defaults: () => entry, propertiesClass: () => key };
    const connector = defaultSourceConnector(version);
    for (const pluginProperties of [null, {}, { [key]: entry }, { [key]: [entry] }]) {
        connector.properties.pluginProperties = pluginProperties;
        const before = structuredClone(connector);
        assert.equal(changed(connector, 'SOURCE', panelFor('SOURCE'), [extension]), false);
        assert.deepEqual(connector, before);
    }
    for (const pluginProperties of [
        { [key]: { ...entry, future: 'keep' } },
        { 'httpauth.BasicProperties': { authType: 'BASIC', realm: 'realm' } },
        { [key]: entry, 'other.Plugin': { secret: 'keep' } }
    ]) {
        connector.properties.pluginProperties = pluginProperties;
        assert.equal(changed(connector, 'SOURCE', panelFor('SOURCE'), [extension]), true);
    }
    connector.properties.pluginProperties = { [key]: entry };
    assert.equal(changed(connector), true, 'a plugin without known defaults still prompts');
});

test('object key order is irrelevant, list order and literal settings remain significant', () => {
    const defaults = { '@class': 'Connector', count: 1, enabled: false, text: '', list: { string: ['first', 'last'] } };
    const panel = { defaults: () => defaults };
    const connector = { properties: { list: { string: ['first', 'last'] }, text: null, enabled: 'false', count: '1', '@class': 'Connector' } };
    assert.equal(changed(connector, 'SOURCE', panel), false);
    for (const edit of [
        p => { p.list.string.reverse(); },
        p => { p.count = '01'; },
        p => { p.text = ' '; },
        p => { p.text = 'null'; },
        p => { p.enabled = true; }
    ]) {
        const modified = structuredClone(connector);
        edit(modified.properties);
        assert.equal(changed(modified, 'SOURCE', panel), true);
    }
    assert.deepEqual(defaults.list.string, ['first', 'last']);
});

test('unavailable, malformed or failing defaults conservatively prompt', () => {
    const connector = defaultSourceConnector(version);
    for (const panel of [null, {}, { defaults: () => null }, { defaults: () => [] }, { defaults: () => { throw Error('plugin failure'); } }]) {
        assert.equal(changed(connector, 'SOURCE', panel), true);
    }
    assert.equal(changed({ properties: null }), true);
    assert.equal(changed(connector, 'SOURCE', panelFor('SOURCE'), [{
        isSupported: () => true, propertiesClass: 'Plugin', defaults: () => { throw Error('extension failure'); }
    }]), true);
    assert.equal(changed(connector, 'SOURCE', panelFor('SOURCE'), [{
        isSupported: () => true, propertiesClass: 'Plugin', defaults: () => null
    }]), true);
});
