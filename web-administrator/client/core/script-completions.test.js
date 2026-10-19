import assert from 'node:assert/strict';
import api from './api.js';
import { invalidate, registerTemplateCompletionSource, templateCompletionCode, templatesInScope, templateSourcesInScope } from './script-completions.js';

const context = 'SOURCE_FILTER_TRANSFORMER';
const pythonClass = 'com.mirth.connect.plugins.python.PythonCodeTemplateProperties';
const template = (id, properties, contexts = [context]) => ({ id, name: id,
    contextSet: { delegate: { contextType: contexts } }, properties });
const python = name => ({ '@class': pythonClass, type: 'FUNCTION', functionName: name, pythonScript: 'def call(ctx):\n    return "python-only-sentinel"\n' });
const library = (id, templates, channels = ['channel']) => ({ id, name: id, includeNewChannels: false,
    enabledChannelIds: { string: channels }, codeTemplates: { codeTemplate: templates } });
const inScope = [
    template('python', python('python_function')),
    template('js', { '@class': 'com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties', type: 'FUNCTION', code: 'function javascript_function(value) {}' }),
    template('legacy', { type: 'FUNCTION', code: 'function legacy_function() {}' }),
    template('other-context', python('wrong_context'), ['GLOBAL_DEPLOY']),
    template('compiled', { ...python('compiled_python'), type: 'COMPILED_CODE' }),
    template('drag', { ...python('drag_python'), type: 'DRAG_AND_DROP_CODE' }),
    template('unknown', { '@class': 'com.example.Missing', type: 'FUNCTION', code: 'function forbidden_fallback() {}', pythonScript: 'def call(ctx): pass' }),
    template('failure', { '@class': 'com.example.Throwing', type: 'FUNCTION' }),
    template('null', { '@class': 'com.example.Empty', type: 'FUNCTION' }),
    template('wrong-type', { '@class': 'com.example.Invalid', type: 'FUNCTION' }),
    template('oversized', { '@class': 'com.example.Huge', type: 'FUNCTION' })
];
const libraries = [library('Linked', inScope), library('Elsewhere', [template('outside', python('wrong_channel'))], ['other-channel'])];
const before = structuredClone(libraries);
const originalLoad = api.codeTemplates.libraries;
let loads = 0, calls = 0;
api.codeTemplates.libraries = async () => { loads++; return libraries; };
registerTemplateCompletionSource(pythonClass, snapshot => {
    calls++;
    const name = snapshot.properties.functionName;
    snapshot.properties.pythonScript = 'mutated snapshot';
    return `/** Callable Python function. */\nfunction ${name}(value) {}`;
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
    assert.deepEqual(functions.map(fn => fn.name), ['python_function', 'javascript_function', 'legacy_function']);
    assert.deepEqual(functions[0], { name: 'python_function', params: ['value'], doc: 'Callable Python function.', library: 'Linked' });
    const sources = await templateSourcesInScope('channel', [context]);
    assert.deepEqual(sources.map(source => source.id), ['python', 'js', 'legacy', 'compiled']);
    assert.ok(sources[0].code.includes('function python_function(value) {}'));
    assert.ok(sources.every(source => !source.code.includes('python-only-sentinel') && !source.code.includes('def call(')));
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
