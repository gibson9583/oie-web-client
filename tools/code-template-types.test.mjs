import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transform } from 'esbuild';

const root = new URL('../web-administrator/client/react/views/', import.meta.url);
const { code: modelCode } = await transform(await readFile(new URL('code-template-types.ts', root), 'utf8'), { loader: 'ts', format: 'cjs' });
const model = { exports: {} };
new Function('module', 'exports', modelCode)(model, model.exports);
const { BASIC_PROPERTIES_CLASS, codeTemplateType, switchCodeTemplateType, codeTemplateTypeError, codeTemplateSaveError } = model.exports;
const propertiesClass = 'com.example.templates.SampleCodeTemplateProperties';
const sampleSource = 'command invoke(value)\n    emit "001"\n';
const sample = {
    label: 'Sample Function', propertiesClass,
    contexts: ['SOURCE_FILTER_TRANSFORMER', 'DESTINATION_FILTER_TRANSFORMER', 'DESTINATION_RESPONSE_TRANSFORMER'],
    create: ({ version }) => ({ '@version': version, type: 'FUNCTION', source: sampleSource,
        functionName: 'sample_function', environmentId: 'env-1', options: { keep: '002' } }),
    component: function SampleEditor() {},
    validate: async () => null
};
const providers = new Map([['sample-function', sample]]);
const jsTemplate = () => ({ id: 't1', name: 'Template', revision: 7,
    contextSet: { delegate: { contextType: ['SOURCE_FILTER_TRANSFORMER', 'CHANNEL_DEPLOY'] } },
    properties: { '@class': BASIC_PROPERTIES_CLASS, '@version': '4.6.0', type: 'FUNCTION', code: 'function original() {}' } });
const sampleTemplate = () => ({ ...jsTemplate(), contextSet: { delegate: { contextType: 'SOURCE_FILTER_TRANSFORMER' } },
    properties: { ...sample.create({ version: '4.6.0' }), '@class': propertiesClass } });

test('serialized class selects the plugin even when its engine behavior is FUNCTION', () => {
    assert.equal(codeTemplateType(sampleTemplate(), providers).id, 'sample-function');
    assert.equal(codeTemplateType(jsTemplate(), providers).id, 'FUNCTION');
    assert.equal(codeTemplateType(sampleTemplate(), new Map()).missing, true);
    const unknown = sampleTemplate(), before = structuredClone(unknown);
    assert.equal(switchCodeTemplateType(unknown, 'FUNCTION', new Map(), '4.6.0', new Map()), false);
    assert.deepEqual(unknown, before, 'missing plugins cannot be converted to empty JavaScript');
});

test('built-in and plugin type switching preserve separate source drafts and class-specific fields', () => {
    const template = jsTemplate(), original = structuredClone(template), drafts = new Map();
    assert.equal(switchCodeTemplateType(template, 'COMPILED_CODE', providers, '4.6.0', drafts), true);
    assert.equal(template.properties.code, original.properties.code);
    switchCodeTemplateType(template, 'sample-function', providers, '4.6.0', drafts);
    assert.equal(template.properties['@class'], propertiesClass);
    assert.equal(template.properties.source, sampleSource);
    assert.equal(template.properties.code, undefined);
    assert.deepEqual(template.contextSet.delegate.contextType, ['SOURCE_FILTER_TRANSFORMER']);
    template.properties.source += '# unsaved edit\n';
    const sampleProperties = structuredClone(template.properties);
    switchCodeTemplateType(template, 'FUNCTION', providers, '4.6.0', drafts);
    assert.equal(template.properties['@class'], BASIC_PROPERTIES_CLASS);
    assert.equal(template.properties.code, original.properties.code);
    assert.equal(template.properties.source, undefined);
    switchCodeTemplateType(template, 'sample-function', providers, '4.6.0', drafts);
    assert.deepEqual(template.properties, sampleProperties);
    assert.equal(template.revision, 7);
});

test('bad defaults cannot partially replace or mutate the current template', () => {
    const template = jsTemplate(), before = structuredClone(template);
    const bad = new Map([['bad', { ...sample, create: ({ template: snapshot }) => {
        snapshot.properties.code = 'changed'; return { type: 'CUSTOM_ENGINE_TYPE' };
    } }]]);
    assert.throws(() => switchCodeTemplateType(template, 'bad', bad, '4.6.0', new Map()), /supported engine template type/);
    assert.deepEqual(template, before);
});

test('unsupported imported contexts are preserved and reported, including a singleton wire shape', () => {
    const template = sampleTemplate();
    assert.equal(codeTemplateTypeError(template, providers), null);
    template.contextSet.delegate.contextType = 'GLOBAL_DEPLOY';
    const before = structuredClone(template);
    assert.match(codeTemplateTypeError(template, providers), /GLOBAL_DEPLOY/);
    assert.deepEqual(template, before);
    template.properties.type = 'CUSTOM_ENGINE_TYPE';
    assert.match(codeTemplateTypeError(template, providers), /existing engine template type/);
});

// Exercise the actual editor and its event callbacks with virtual JSX. Only UI,
// network and React lifecycle boundaries are replaced; the view and model are
// the shipped sources. This catches class routing, permission changes and
// asynchronous validation without manufacturing engine behavior.
const { code: viewCode } = await transform(
    await readFile(new URL('code-templates.tsx', root), 'utf8') + '\nexport { TemplateEditor, ContextPanel };',
    { loader: 'tsx', format: 'cjs', jsx: 'automatic' });
const nodes = value => {
    if (!value) return [];
    if (Array.isArray(value)) return value.flatMap(nodes);
    if (typeof value !== 'object') return [];
    return [value, ...nodes(value.props?.children)];
};
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function harness(template = sampleTemplate(), registry = new Map(providers), imports = null) {
    const state = [], refs = [], effects = [], cleanups = [], calls = { changed: 0, validateJs: 0, toasts: [], writes: [], exports: [] };
    let stateIndex = 0, refIndex = 0, first = true, allowed = true, sessionActive = true, navigation = 0;
    const library = { id: 'lib1', name: 'Library', codeTemplates: { codeTemplate: [template] } };
    const store = { getState: () => '4.6.0', setState() {}, subscribe: () => () => {} };
    const ui = { toast: (...args) => calls.toasts.push(args), confirmDialog: async () => true,
        saveFile: async (_name, _mime, content) => calls.exports.push(await content()),
        pickFile: async () => imports && { name: 'templates.xml', content: '<list/>' }, contextMenu() {}, fmtDate: String };
    const api = { asList: (value, key) => {
        const items = key ? value?.[key] : value;
        return Array.isArray(items) ? items : items == null || items === '' ? [] : [items];
    }, codeTemplates: { libraries: async () => [library], bulkUpdate: async (...args) => { calls.writes.push(structuredClone(args)); return { librariesSuccess: true }; } },
    getXml: async () => '<codeTemplate><properties class="' + propertiesClass + '"><source>' + sampleSource + '</source></properties></codeTemplate>' };
    const platform = { codeTemplateTypes: () => registry, codeTemplateActions: () => [], checkTask: () => allowed,
        events: { on: () => () => {} }, store, api };
    const jsx = (type, props, key) => ({ type, props, key });
    const modules = {
        'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
        react: { useRef: value => refs[refIndex++] ||= { current: value },
            useState: initial => { const index = stateIndex++; if (first) state[index] = typeof initial === 'function' ? initial() : initial;
                return [state[index], next => { state[index] = typeof next === 'function' ? next(state[index]) : next; }]; },
            useEffect: effect => { if (first) effects.push(effect); }, useLayoutEffect() {}, useMemo: callback => callback() },
        '@oie/web-ui': ui, '@oie/web-shell': { platform }, '@oie/web-api': { __esModule: true, default: api, uuid: () => 'new-id' },
        '../../core/store.js': store,
        '../../core/router.js': { navigationToken: () => navigation },
        '../../core/engine-fetch.js': { captureEngineSession: () => () => { if (!sessionActive) throw new Error('Expired session'); } },
        '../../core/serialize.js': { validateScript: async () => { calls.validateJs++; return { ok: true }; } },
        '../../core/script-completions.js': { invalidate() {} }, '../../core/unsaved.js': { registerUnsavedCheck: () => () => {} },
        '../save-lock.js': { withEditorSave: callback => callback() }, '../tree-table.jsx': { TreeTable: 'TreeTable', TreeLabel: 'TreeLabel' },
        '../mount.jsx': { ViewTasks: 'ViewTasks' }, '../ui.jsx': { RailPane: 'RailPane', TaskButton: 'TaskButton', CodeEditor: 'CodeEditor' },
        '../bridges.jsx': { Icon: 'Icon' }, '../error-boundary.jsx': { ErrorBoundary: 'ErrorBoundary' },
        '../palette-context.js': { usePaletteContext() {} },
        './code-template-import.js': {
            parseTemplateImport: () => imports, parseLibraryImport: () => [library],
            prepareTemplateImport: async () => ({ libraries: [library], templates: imports }),
            prepareLibraryImport: async () => ({ libraries: [library], templates: imports })
        }, './code-template-import-dialogs.js': { libraryImportCallbacks: () => ({}) },
        './code-template-types.js': model.exports
    };
    const module = { exports: {} };
    new Function('require', 'module', 'exports', viewCode)(name => {
        assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name];
    }, module, module.exports);
    const render = (fn, props) => { stateIndex = 0; refIndex = 0; const tree = fn(props); first = false; return tree; };
    const editorProps = { template, entry: { library, templates: [template] }, entries: [],
        markDirty: () => calls.changed++, onFocusConsumed() {}, onMoveTemplate() {}, onToggleMax() {} };
    return { calls, template, registry, platform, renderEditor: () => render(module.exports.TemplateEditor, editorProps),
        renderContexts: props => render(module.exports.ContextPanel, { template, markDirty: () => calls.changed++, ...props }),
        renderView: () => render(module.exports.CodeTemplatesView, { query: { templateId: template.id } }),
        async mountView() { this.renderView(); effects.forEach(effect => cleanups.push(effect())); await new Promise(resolve => setImmediate(resolve)); return this.renderView(); },
        deny: () => { allowed = false; }, expire: () => { sessionActive = false; },
        navigateAwayAndBack: () => { navigation += 2; }, unmount: () => cleanups.forEach(cleanup => cleanup?.()),
        treeNodes: nodes };
}

test('actual editor routes custom source to the plugin and unknown classes to a nonmutating fallback', () => {
    const h = harness(), tree = h.renderEditor();
    const component = nodes(tree).find(node => node.type === sample.component);
    assert.ok(component);
    assert.equal(component.props.properties.source, sampleSource);
    assert.equal(component.props.readOnly, false);
    assert.equal(nodes(tree).some(node => node.type === 'CodeEditor'), false);
    h.deny();
    component.props.onChange();
    assert.equal(h.calls.changed, 0, 'old callbacks recheck save permission');
    const locked = nodes(h.renderEditor()).find(node => node.type === sample.component);
    assert.equal(locked.props.readOnly, true);
    const unknown = harness(sampleTemplate(), new Map()), before = structuredClone(unknown.template);
    const missing = nodes(unknown.renderEditor());
    assert.equal(missing.some(node => node.type === 'CodeEditor' || node.type === sample.component), false);
    assert.ok(missing.find(node => node.props?.role === 'status'));
    assert.deepEqual(unknown.template, before);
});

test('context controls block unsupported additions and preserve existing unsupported values until cleared', () => {
    const h = harness();
    h.template.contextSet.delegate.contextType = ['SOURCE_FILTER_TRANSFORMER', 'GLOBAL_DEPLOY'];
    const all = nodes(h.renderContexts({ contexts: sample.contexts }));
    const checkboxes = all.filter(node => node.type === 'input' && node.props.type === 'checkbox');
    const selectedUnsupported = checkboxes[0];
    assert.equal(selectedUnsupported.props.checked, true);
    assert.equal(selectedUnsupported.props.disabled, false, 'existing invalid contexts can be cleared');
    const unselectedUnsupported = checkboxes[1];
    assert.equal(unselectedUnsupported.props.disabled, true);
    unselectedUnsupported.props.onChange({ target: { checked: true } });
    assert.equal(h.calls.changed, 0);
    h.deny();
    selectedUnsupported.props.onChange({ target: { checked: false } });
    assert.equal(h.calls.changed, 0, 'stale handlers also enforce permission');
});

for (const invalidate of ['edit', 'session', 'permission', 'navigation', 'unmount']) test(`plugin validation suppresses stale success after ${invalidate}`, async () => {
    const pending = deferred(), h = harness();
    h.registry.set('sample-function', { ...sample, validate: () => pending.promise });
    const tree = await h.mountView();
    const task = nodes(tree).find(node => node.type === 'TaskButton' && node.props.task === 'doValidateCodeTemplate');
    assert.ok(task);
    const running = task.props.onClick();
    if (invalidate === 'edit') h.template.properties.source += '# changed\n';
    if (invalidate === 'session') h.expire();
    if (invalidate === 'permission') h.deny();
    if (invalidate === 'navigation') h.navigateAwayAndBack();
    if (invalidate === 'unmount') h.unmount();
    pending.resolve(null);
    await running;
    assert.equal(h.calls.validateJs, 0, 'custom source never reaches the JavaScript validator');
    assert.deepEqual(h.calls.toasts, []);
});

test('plugin validation success, failures and unavailable validators report accurately without a JS fallback', async () => {
    for (const validator of [async () => null, async () => 'Syntax error', async () => { throw new Error('Offline'); }, undefined]) {
        const h = harness();
        h.registry.set('sample-function', { ...sample, validate: validator });
        const tree = await h.mountView();
        await nodes(tree).find(node => node.type === 'TaskButton' && node.props.task === 'doValidateCodeTemplate').props.onClick();
        assert.equal(h.calls.validateJs, 0);
        assert.equal(h.calls.toasts.length, 1);
        if (validator === undefined) assert.match(h.calls.toasts[0][0], /independent validation is unavailable/);
    }
});

test('Save preserves plugin fields and does not require an available language validator', async () => {
    const h = harness();
    h.registry.set('sample-function', { ...sample, validate: () => { throw new Error('Save must not validate runtime drafts'); } });
    let tree = await h.mountView();
    h.template.properties.source += '# draft\n';
    nodes(tree).find(node => node.type?.name === 'EditorPane').props.markDirty();
    tree = h.renderView();
    const expected = structuredClone(h.template.properties);
    await nodes(tree).find(node => node.type === 'TaskButton' && node.props.task === 'doSaveCodeTemplates').props.onClick();
    assert.equal(h.calls.writes.length, 1);
    assert.deepEqual(h.calls.writes[0][1][0].properties, expected);
    assert.equal(h.calls.validateJs, 0);
    assert.deepEqual(h.calls.toasts, [['Code templates saved']]);
});

test('Save rechecks permission even when invoked from a previously allowed task', async () => {
    const h = harness();
    let tree = await h.mountView();
    h.template.properties.source += '# draft\n';
    nodes(tree).find(node => node.type?.name === 'EditorPane').props.markDirty();
    tree = h.renderView();
    h.deny();
    await nodes(tree).find(node => node.type === 'TaskButton' && node.props.task === 'doSaveCodeTemplates').props.onClick();
    assert.equal(h.calls.writes.length, 0);
});

test('schema validation sees snapshots and rejects invalid names before any save write', async () => {
    const h = harness();
    h.registry.set('sample-function', { ...sample, validateSave: ({ properties }) => {
        properties.functionName = 'snapshot_only';
        return 'Enter a valid function name';
    } });
    let tree = await h.mountView();
    h.template.properties.functionName = 'invalid-name';
    nodes(tree).find(node => node.type?.name === 'EditorPane').props.markDirty();
    tree = h.renderView();
    await nodes(tree).find(node => node.type === 'TaskButton' && node.props.task === 'doSaveCodeTemplates').props.onClick();
    assert.equal(h.calls.writes.length, 0);
    assert.match(h.calls.toasts[0][0], /Enter a valid function name/);
    assert.equal(h.template.properties.functionName, 'invalid-name');
    const bad = new Map([['sample-function', { ...sample, validateSave: async () => null }]]);
    assert.match(codeTemplateSaveError(sampleTemplate(), bad, h.platform), /synchronously/);
});

test('Export returns the engine XML unchanged, including custom source and class', async () => {
    const h = harness(), tree = await h.mountView();
    await nodes(tree).find(node => node.type === 'TaskButton' && node.props.task === 'doExportCodeTemplate').props.onClick();
    assert.deepEqual(h.calls.exports, [await h.platform.api.getXml()]);
});

for (const task of ['doImportCodeTemplates', 'doImportLibraries']) test(`${task} runs schema checks before its first write`, async () => {
    const invalid = sampleTemplate();
    invalid.properties.functionName = 'bad-name';
    const h = harness(sampleTemplate(), new Map([['sample-function', { ...sample,
        validateSave: ({ properties }) => properties.functionName === 'bad-name' ? 'Invalid function name' : null
    }]]), [invalid]);
    const tree = await h.mountView();
    await nodes(tree).find(node => node.type === 'TaskButton' && node.props.task === task).props.onClick();
    assert.equal(h.calls.writes.length, 0);
    assert.match(h.calls.toasts[0][0], /Invalid function name/);
});

test('ordinary JavaScript retains the Rhino validation path and a missing provider never enters it', async () => {
    const js = harness(jsTemplate()), jsTree = await js.mountView();
    await nodes(jsTree).find(node => node.type === 'TaskButton' && node.props.task === 'doValidateCodeTemplate').props.onClick();
    assert.equal(js.calls.validateJs, 1);
    const unknown = harness(sampleTemplate(), new Map()), unknownTree = await unknown.mountView();
    await nodes(unknownTree).find(node => node.type === 'TaskButton' && node.props.task === 'doValidateCodeTemplate').props.onClick();
    assert.equal(unknown.calls.validateJs, 0);
    assert.match(unknown.calls.toasts[0][0], /plugin.*unavailable/);
});

test('the real platform registry enforces unique custom classes and retains older API compatibility', async () => {
    const source = await readFile(new URL('../web-administrator/client/core/platform.ts', import.meta.url), 'utf8');
    const { code } = await transform(source, { loader: 'ts', format: 'cjs' });
    const exported = { exports: {} }, events = [];
    new Function('require', 'module', 'exports', code)(() => ({ emit: (...args) => events.push(args) }), exported, exported.exports);
    const { platform, OIE_API_VERSION, apiCompatible } = exported.exports;
    assert.equal(OIE_API_VERSION, '4.10.0');
    assert.equal(apiCompatible(OIE_API_VERSION, '4.9'), true);
    assert.equal(apiCompatible('4.9.0', '4.10'), false);
    platform.registerCodeTemplateType('sample', sample);
    assert.equal(platform.codeTemplateTypes().get('sample'), sample);
    assert.throws(() => platform.registerCodeTemplateType('sample', sample), /already registered/);
    assert.throws(() => platform.registerCodeTemplateType('second', sample), /already registered/);
    assert.throws(() => platform.registerCodeTemplateType('FUNCTION', sample), /unique id/);
    assert.throws(() => platform.registerCodeTemplateType('basic', { ...sample, propertiesClass: BASIC_PROPERTIES_CLASS }), /unique id/);
    platform.codeTemplateTypes().clear();
    assert.equal(platform.codeTemplateTypes().size, 1, 'the returned Map cannot mutate the registry');
    assert.deepEqual(events, [['codeTemplateTypes:changed']]);
});
