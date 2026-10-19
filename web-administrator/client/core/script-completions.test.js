import assert from 'node:assert/strict';
import api from './api.js';
import { invalidate, registerTemplateCompletionSource, templateCompletionCode, templatesInScope, templateSourcesInScope } from './script-completions.js';

const context = 'SOURCE_FILTER_TRANSFORMER';
const sampleClass = 'com.example.templates.SampleCodeTemplateProperties';
const template = (id, properties, contexts = [context]) => ({ id, name: id,
    contextSet: { delegate: { contextType: contexts } }, properties });
const sample = name => ({ '@class': sampleClass, type: 'FUNCTION', functionName: name, customSource: 'command invoke(value)\n    emit "sample-only-sentinel"\n' });
const library = (id, templates, channels = ['channel']) => ({ id, name: id, includeNewChannels: false,
    enabledChannelIds: { string: channels }, codeTemplates: { codeTemplate: templates } });
const inScope = [
    template('sample', sample('sample_function')),
    template('js', { '@class': 'com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties', type: 'FUNCTION', code: 'function javascript_function(value) {}' }),
    template('legacy', { type: 'FUNCTION', code: 'function legacy_function() {}' }),
    template('other-context', sample('wrong_context'), ['GLOBAL_DEPLOY']),
    template('compiled', { ...sample('compiled_sample'), type: 'COMPILED_CODE' }),
    template('drag', { ...sample('drag_sample'), type: 'DRAG_AND_DROP_CODE' }),
    template('unknown', { '@class': 'com.example.Missing', type: 'FUNCTION', code: 'function forbidden_fallback() {}', customSource: 'command invoke(value): emit value' }),
    template('failure', { '@class': 'com.example.Throwing', type: 'FUNCTION' }),
    template('null', { '@class': 'com.example.Empty', type: 'FUNCTION' }),
    template('wrong-type', { '@class': 'com.example.Invalid', type: 'FUNCTION' }),
    template('oversized', { '@class': 'com.example.Huge', type: 'FUNCTION' })
];
const libraries = [library('Linked', inScope), library('Elsewhere', [template('outside', sample('wrong_channel'))], ['other-channel'])];
const before = structuredClone(libraries);
const originalLoad = api.codeTemplates.libraries;
let loads = 0, calls = 0;
api.codeTemplates.libraries = async () => { loads++; return libraries; };
registerTemplateCompletionSource(sampleClass, snapshot => {
    calls++;
    const name = snapshot.properties.functionName;
    snapshot.properties.customSource = 'mutated snapshot';
    return `/** Callable Sample function. */\nfunction ${name}(value) {}`;
});
registerTemplateCompletionSource('com.example.Throwing', () => { throw new Error('Provider failure'); });
registerTemplateCompletionSource('com.example.Empty', () => null);
registerTemplateCompletionSource('com.example.Invalid', () => ({ code: 'function invalid() {}' }));
registerTemplateCompletionSource('com.example.Huge', () => 'function too_large() {}' + ' '.repeat(500_001));
const warn = console.warn, warnings = [];
console.warn = (...args) => warnings.push(args);
try {
    const largeBuiltin = 'function large_builtin() {}' + ' '.repeat(500_001);
    assert.equal(templateCompletionCode(template('large-basic', { type: 'FUNCTION', code: largeBuiltin })), largeBuiltin,
        'built-in References drag source keeps its existing behavior independently of the worker size limit');
    invalidate();
    const functions = await templatesInScope('channel', [context]);
    assert.deepEqual(functions.map(fn => fn.name), ['sample_function', 'javascript_function', 'legacy_function']);
    assert.deepEqual(functions[0], { name: 'sample_function', params: ['value'], doc: 'Callable Sample function.', library: 'Linked' });
    const sources = await templateSourcesInScope('channel', [context]);
    assert.deepEqual(sources.map(source => source.id), ['sample', 'js', 'legacy', 'compiled']);
    assert.ok(sources[0].code.includes('function sample_function(value) {}'));
    assert.ok(sources.every(source => !source.code.includes('sample-only-sentinel') && !source.code.includes('command invoke(')));
    assert.deepEqual(libraries, before, 'resolver mutation must not touch cached engine models');
    assert.equal(loads, 1, 'both completion consumers share the library read');
    assert.equal(calls, 3, 'out-of-scope and drag-and-drop templates never call the resolver');
    assert.equal(warnings.length, 2, 'one throwing provider cannot remove other completions');
    assert.deepEqual((await templatesInScope('other-channel', [context])).map(fn => fn.name), ['wrong_channel']);
    assert.deepEqual((await templatesInScope('channel', ['GLOBAL_DEPLOY'])).map(fn => fn.name), ['wrong_context']);
    assert.deepEqual(await templatesInScope('unlinked', [context]), []);
    assert.deepEqual(await templateSourcesInScope('unlinked', [context]), []);
} finally {
    api.codeTemplates.libraries = originalLoad;
    console.warn = warn;
    invalidate();
}
console.log('script-completions: custom JavaScript declarations, source isolation, snapshots, failures and channel/context gating passed');
