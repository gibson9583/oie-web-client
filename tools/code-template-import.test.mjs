import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Compile the real pure merge helper. UI/API dependencies belong to the XML
// helper's module but are not used by the merge operation being tested here.
const bundle = await build({
    stdin: {
        contents: "export { prepareLibraryImport, prepareTemplateImport } from './web-administrator/client/react/views/code-template-import.ts';",
        resolveDir: fileURLToPath(new URL('..', import.meta.url)),
        sourcefile: 'code-template-import-test.ts', loader: 'ts'
    },
    bundle: true, write: false, format: 'esm', platform: 'node',
    plugins: [{
        name: 'unused-browser-dependencies',
        setup(builder) {
            builder.onResolve({ filter: /^@oie\/web-(api|ui)$/ }, args => ({ path: args.path, external: true, sideEffects: false }));
        }
    }]
});
const { prepareLibraryImport, prepareTemplateImport } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

const version = '4.5.2';
const template = (id, name, revision = 7, code = 'return 1;') => ({
    id, name, revision, description: 'template description',
    contextSet: { delegate: { contextType: ['CHANNEL_PREPROCESSOR'] } },
    properties: { '@class': 'com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties', code }
});
const library = (id, name, children = [], extras = {}) => ({
    id, name, revision: 9, description: 'library description', includeNewChannels: false,
    enabledChannelIds: null, disabledChannelIds: null,
    codeTemplates: children.length ? { codeTemplate: children } : null, ...extras
});
const refs = lib => (lib.codeTemplates?.codeTemplate || []).map(t => t.id);
const find = (result, id) => result.libraries.find(lib => lib.id === id);
function callbacks(choices = [], names = []) {
    const conflicts = [], renames = [], ids = new Map();
    return {
        conflicts, renames, ids,
        async resolveConflict(kind, name) {
            conflicts.push([kind, name]);
            assert.ok(choices.length, `Unexpected ${kind} conflict for ${name}`);
            return choices.shift();
        },
        async rename(kind, name) {
            renames.push([kind, name]);
            assert.ok(names.length, `Unexpected ${kind} rename for ${name}`);
            return names.shift();
        },
        newId(key) {
            if (!ids.has(key)) ids.set(key, `generated-${ids.size + 1}`);
            return ids.get(key);
        }
    };
}
function freeze(value) {
    if (value && typeof value === 'object') {
        for (const child of Object.values(value)) freeze(child);
        Object.freeze(value);
    }
    return value;
}

test('second library is added alongside every current library; full templates only become updates', async () => {
    const current = freeze([
        library('a', 'Library A', [template('a1', 'A1')], { pluginMetadata: { untouched: true } }),
        library('b', 'Library B', [template('b1', 'B1')])
    ]);
    const imports = freeze([library('c', 'Library C', [template('c1', 'C1', 101, '001')])]);
    const before = JSON.stringify({ current, imports });
    const result = await prepareLibraryImport(current, imports, version, callbacks());
    assert.deepEqual(result.libraries.map(lib => lib.id), ['a', 'b', 'c']);
    assert.deepEqual(refs(find(result, 'a')), ['a1']);
    assert.deepEqual(refs(find(result, 'b')), ['b1']);
    assert.deepEqual(find(result, 'a').pluginMetadata, { untouched: true });
    assert.equal(find(result, 'a').revision, 9);
    assert.equal(find(result, 'c').revision, 0);
    assert.equal(find(result, 'c').enabledChannelIds, '');
    assert.equal(find(result, 'c').disabledChannelIds, '');
    assert.deepEqual(result.templates.map(t => t.id), ['c1']);
    assert.equal(result.templates[0].revision, 0);
    assert.equal(result.templates[0].properties.code, '001');
    assert.equal(result.templates[0].properties['@version'], version);
    assert.deepEqual(find(result, 'a').codeTemplates.codeTemplate[0], { '@version': version, id: 'a1' });
    assert.equal(JSON.stringify({ current, imports }), before);
});

test('explicit library overwrite unions template membership and channel sets, preserving fresh revisions', async () => {
    const existing = library('a', 'Original', [template('keep', 'Keep'), template('replace', 'Replace', 22)], {
        revision: 45, includeNewChannels: true,
        enabledChannelIds: { string: ['existing-enabled', 'existing-wins'] },
        disabledChannelIds: { string: ['existing-disabled', 'imported-wins'] }
    });
    const imported = library('a', 'Imported metadata', [template('replace', 'Replace', 2, 'new code'), template('add', 'Add')], {
        revision: 1, description: 'Imported description', includeNewChannels: false,
        enabledChannelIds: { string: ['imported-wins'] },
        disabledChannelIds: { string: ['existing-wins', 'new-disabled'] }
    });
    const prompts = callbacks(['overwrite', 'overwrite']);
    const result = await prepareLibraryImport([existing], [imported], version, prompts);
    const merged = find(result, 'a');
    assert.equal(merged.revision, 45);
    assert.equal(merged.name, 'Imported metadata');
    assert.equal(merged.description, 'Imported description');
    assert.equal(merged.includeNewChannels, false);
    assert.deepEqual(refs(merged), ['keep', 'replace', 'add']);
    assert.deepEqual(new Set(merged.enabledChannelIds.string), new Set(['existing-enabled', 'existing-wins', 'imported-wins']));
    assert.deepEqual(new Set(merged.disabledChannelIds.string), new Set(['existing-disabled', 'new-disabled']));
    assert.equal(result.templates.find(t => t.id === 'replace').revision, 22);
    assert.equal(result.templates.find(t => t.id === 'replace').properties.code, 'new code');
    assert.equal(result.templates.find(t => t.id === 'add').revision, 0);
    assert.deepEqual(prompts.conflicts, [['library', 'Imported metadata'], ['template', 'Replace']]);
});

test('distinct library IDs with case-insensitive matching names require rename, never ID overwrite', async () => {
    const prompts = callbacks([], ['LIBRARY', 'Imported library']);
    const result = await prepareLibraryImport([library('a', 'Library')], [library('b', 'library')], version, prompts);
    assert.deepEqual(result.libraries.map(lib => [lib.id, lib.name]), [['a', 'Library'], ['b', 'Imported library']]);
    assert.equal(prompts.conflicts.length, 0);
    assert.equal(prompts.renames.length, 2);
});

test('primitive-looking engine names still participate in library and template conflicts', async () => {
    const libraryNames = callbacks([], ['New zero']);
    const result = await prepareLibraryImport([library('a', 0)], [library('b', '0')], version, libraryNames);
    assert.equal(find(result, 'b').name, 'New zero');
    assert.deepEqual(libraryNames.renames, [['library', '0']]);

    const templateNames = callbacks(['overwrite'], ['New false']);
    const merged = await prepareLibraryImport(
        [library('a', 'A', [template('existing', false)])],
        [library('a', 'A', [template('new', 'false')])], version, templateNames
    );
    assert.equal(merged.templates[0].name, 'New false');
    assert.deepEqual(refs(find(merged, 'a')), ['existing', 'new']);
});

test('same-ID library copy receives fresh IDs without borrowing original membership', async () => {
    const original = library('a', 'Original', [template('keep', 'Keep'), template('shared', 'Shared')]);
    const imported = library('a', 'Original', [template('shared', 'Shared', 99, 'copied')]);
    const prompts = callbacks(['copy'], ['Copy']);
    const result = await prepareLibraryImport([original], [imported], version, prompts);
    const copy = find(result, 'generated-1');
    assert.deepEqual(refs(find(result, 'a')), ['keep', 'shared']);
    assert.deepEqual(refs(copy), ['generated-2']);
    assert.equal(copy.name, 'Copy');
    assert.equal(copy.revision, 0);
    assert.equal(result.templates[0].id, 'generated-2');
    assert.equal(result.templates[0].revision, 0);
    assert.deepEqual(prompts.conflicts, [['library', 'Original']]);
});

test('cross-owner template IDs are copied, preserving the old owner and template', async () => {
    const prompts = callbacks();
    const result = await prepareLibraryImport(
        [library('a', 'A', [template('shared', 'Same name', 12, 'original')])],
        [library('b', 'B', [template('shared', 'Same name', 99, 'new')])], version, prompts
    );
    assert.deepEqual(refs(find(result, 'a')), ['shared']);
    assert.deepEqual(refs(find(result, 'b')), ['generated-1']);
    assert.deepEqual(result.templates.map(t => [t.id, t.name, t.revision, t.properties.code]), [['generated-1', 'Same name', 0, 'new']]);
    assert.equal(prompts.conflicts.length, 0);
    assert.equal(prompts.renames.length, 0);
});

test('same-owner template copy requires a unique name and preserves original ID', async () => {
    const prompts = callbacks(['overwrite', 'copy'], ['same', 'A copy']);
    const result = await prepareLibraryImport(
        [library('a', 'A', [template('a1', 'Same')])],
        [library('a', 'A', [template('a1', 'Same')])], version, prompts
    );
    assert.deepEqual(refs(find(result, 'a')), ['a1', 'generated-1']);
    assert.equal(result.templates[0].name, 'A copy');
    assert.equal(prompts.renames.length, 2);
});

test('template name conflicts apply within the destination only and never imply overwrite', async () => {
    const prompts = callbacks(['overwrite'], ['Unique']);
    const result = await prepareLibraryImport(
        [library('a', 'A', [template('a1', 'Function')]), library('b', 'B', [template('b1', 'Elsewhere')])],
        [library('a', 'A', [template('new1', 'function'), template('new2', 'Elsewhere')])], version, prompts
    );
    assert.deepEqual(refs(find(result, 'a')), ['a1', 'new1', 'new2']);
    assert.deepEqual(result.templates.map(t => t.name), ['Unique', 'Elsewhere']);
    assert.deepEqual(prompts.conflicts, [['library', 'A']]);
    assert.deepEqual(prompts.renames, [['template', 'function']]);
});

test('names introduced earlier in a multi-library import participate in conflict detection', async () => {
    const prompts = callbacks([], ['Other library', 'Other template']);
    const result = await prepareLibraryImport([], [
        library('a', 'Name'), library('b', 'name', [template('1', 'Function'), template('2', 'function')])
    ], version, prompts);
    assert.equal(find(result, 'b').name, 'Other library');
    assert.deepEqual(result.templates.map(t => t.name), ['Function', 'Other template']);
});

test('cancelling any conflict discards the prepared operation without mutating either input', async () => {
    for (const [choices, names] of [[['overwrite', null], []], [[null], []], [['copy'], [null]], [['overwrite', 'copy'], [null]]]) {
        const current = freeze([library('a', 'A', [template('a1', 'A1')])]);
        const imports = freeze([library('b', 'B'), library('a', 'A', [template('a1', 'A1')])]);
        const before = JSON.stringify({ current, imports });
        assert.equal(await prepareLibraryImport(current, imports, version, callbacks([...choices], [...names])), null);
        assert.equal(JSON.stringify({ current, imports }), before);
    }
});

test('skeleton references are ignored even when they include names or revision metadata', async () => {
    const result = await prepareLibraryImport([], [library('a', 'A', [
        { id: 'unknown' }, { id: 'also-unknown', name: 'Skeleton', revision: 10 }, template('real', 'Real')
    ])], version, callbacks());
    assert.deepEqual(refs(find(result, 'a')), ['real']);
    assert.deepEqual(result.templates.map(t => t.id), ['real']);
});

test('duplicate source IDs are rejected before presenting prompts', async () => {
    for (const [imports, error] of [
        [[library('a', 'A'), library('a', 'B')], /Duplicate library ID/],
        [[library('a', 'A', [template('t', 'One'), template('t', 'Two')])], /Duplicate code template ID/],
        [[library('a', 'A', [template('t', 'One')]), library('b', 'B', [template('t', 'Two')])], /Duplicate code template ID/]
    ]) {
        await assert.rejects(prepareLibraryImport([], imports, version, callbacks()), error);
    }
});

test('missing imported IDs receive stable generated IDs and revisions start at zero', async () => {
    const result = await prepareLibraryImport([], [library('', 'New', [template('', 'New template')])], version, callbacks());
    assert.equal(result.libraries[0].id, 'generated-1');
    assert.equal(result.templates[0].id, 'generated-2');
    assert.equal(result.libraries[0].revision, 0);
    assert.equal(result.templates[0].revision, 0);
});

test('retry after a partial copy save requires explicit overwrite and reuses fresh revisions, preserving additions', async () => {
    const original = library('a', 'A', [template('t', 'T')]);
    const imported = library('a', 'A', [template('t', 'T', 99, 'imported code')]);
    const prompts = callbacks(['copy', 'copy', 'overwrite', 'overwrite'], ['A copy', 'A copy']);
    const first = await prepareLibraryImport([original], [imported], version, prompts);
    const copiedTemplate = { ...first.templates[0], revision: 12, name: 'Edited template', properties: { code: 'External edit' } };
    const partial = library('generated-1', 'Edited library', [copiedTemplate, template('later', 'Added concurrently')], {
        revision: 21, enabledChannelIds: { string: 'later-channel' }
    });
    const retry = await prepareLibraryImport([original, partial], [imported], version, prompts);
    assert.equal(retry.libraries.length, 2);
    assert.equal(prompts.ids.size, 2);
    assert.equal(find(retry, 'generated-1').revision, 21);
    assert.deepEqual(refs(find(retry, 'generated-1')), ['generated-2', 'later']);
    assert.deepEqual(find(retry, 'generated-1').enabledChannelIds, { string: ['later-channel'] });
    assert.deepEqual(retry.templates.map(t => [t.id, t.revision]), [['generated-2', 12]]);
    assert.deepEqual(prompts.conflicts, [['library', 'A'], ['library', 'A'], ['library', 'Edited library'], ['template', 'Edited template']]);
});

test('skip library preserves its contents and still imports other libraries', async () => {
    const prompts = callbacks(['skip']);
    const current = library('a', 'A', [template('t', 'Keep')]);
    const result = await prepareLibraryImport([current], [
        library('a', 'A replaced', [template('t', 'Replace')]), library('b', 'B', [template('new', 'New')])
    ], version, prompts);
    assert.equal(find(result, 'a').name, 'A');
    assert.deepEqual(refs(find(result, 'a')), ['t']);
    assert.deepEqual(result.templates.map(t => t.id), ['new']);
    assert.equal(prompts.conflicts.length, 1);
});

test('keeping an existing template imports library settings without updating the skipped template', async () => {
    const result = await prepareLibraryImport([library('a', 'A', [template('t', 'Keep')])], [
        library('a', 'A updated', [template('t', 'Overwrite'), template('new', 'New')], { description: 'Updated' })
    ], version, callbacks(['overwrite', 'skip']));
    assert.equal(find(result, 'a').description, 'Updated');
    assert.deepEqual(refs(find(result, 'a')), ['t', 'new']);
    assert.deepEqual(result.templates.map(t => t.id), ['new']);
});

test('skipping every library returns no operation', async () => {
    const baseline = [library('a', 'A'), library('b', 'B')];
    assert.equal(await prepareLibraryImport(baseline, baseline, version, callbacks(['skip', 'skip'])), null);
});

test('persisted generated copies can be skipped without replacing external edits', async () => {
    const original = library('a', 'A', [template('t', 'T')]);
    const imported = library('a', 'A', [template('t', 'T')]);
    const prompts = callbacks(['copy', 'copy', 'skip'], ['A copy']);
    const first = await prepareLibraryImport([original], [imported], version, prompts);
    const savedCopy = library('generated-1', 'External library edit', first.templates);
    assert.equal(await prepareLibraryImport([original, savedCopy], [imported], version, prompts), null);
});

test('persisted generated templates can be skipped while the library import continues', async () => {
    const original = library('a', 'A', [template('t', 'T')]);
    const imported = library('b', 'B', [template('t', 'T')]);
    const prompts = callbacks(['overwrite', 'skip']);
    const first = await prepareLibraryImport([original], [imported], version, prompts);
    const savedCopy = library('b', 'B', [{ ...first.templates[0], name: 'External edit' }]);
    const retry = await prepareLibraryImport([original, savedCopy], [imported], version, prompts);
    assert.deepEqual(refs(find(retry, 'b')), ['generated-1']);
    assert.deepEqual(retry.templates, []);
    assert.deepEqual(prompts.conflicts, [['library', 'B'], ['template', 'External edit']]);
});

test('explicitly copying an already persisted generated template uses a new stable ID', async () => {
    const original = library('a', 'A', [template('t', 'T')]);
    const imported = library('b', 'B', [template('t', 'T')]);
    const prompts = callbacks(['overwrite', 'copy'], ['Second copy']);
    const first = await prepareLibraryImport([original], [imported], version, prompts);
    const savedCopy = library('b', 'B', first.templates);
    const retry = await prepareLibraryImport([original, savedCopy], [imported], version, prompts);
    assert.deepEqual(refs(find(retry, 'b')), ['generated-1', 'generated-2']);
    assert.deepEqual(retry.templates.map(t => [t.id, t.name, t.revision]), [['generated-2', 'Second copy', 0]]);
    assert.ok(prompts.ids.has('template:0:b:0:t:copy:1'));
});

test('explicitly copying an already persisted generated library also copies its templates into the new owner', async () => {
    const original = library('a', 'A', [template('t', 'T')]);
    const imported = library('a', 'A', [template('t', 'T')]);
    const prompts = callbacks(['copy', 'copy', 'copy'], ['First copy', 'Second copy']);
    const first = await prepareLibraryImport([original], [imported], version, prompts);
    const savedCopy = library('generated-1', 'First copy', first.templates);
    const retry = await prepareLibraryImport([original, savedCopy], [imported], version, prompts);
    assert.deepEqual(retry.libraries.map(lib => lib.id), ['a', 'generated-1', 'generated-3']);
    assert.deepEqual(refs(find(retry, 'generated-1')), ['generated-2']);
    assert.deepEqual(refs(find(retry, 'generated-3')), ['generated-4']);
    assert.deepEqual(retry.templates.map(t => t.id), ['generated-4']);
});

test('ambiguous current ownership fails closed', async () => {
    await assert.rejects(prepareLibraryImport([
        library('a', 'A', [template('t', 'T')]), library('b', 'B', [template('t', 'T')])
    ], [library('c', 'C')], version, callbacks()), /belongs to multiple libraries/);
});


test('individual imports retain library metadata and require a template overwrite decision', async () => {
    const current = library('a', 'Library A', [template('a1', 'A1')]);
    const prompts = callbacks(['overwrite']);
    const result = await prepareTemplateImport([current], [template('a1', 'A1', 99, 'new code')], 'a', version, prompts);
    assert.deepEqual(prompts.conflicts, [['template', 'A1']]);
    assert.equal(find(result, 'a').description, current.description);
    assert.equal(result.templates[0].revision, 7);
    assert.equal(result.templates[0].properties.code, 'new code');
});

test('individual cross-library template imports copy IDs without stealing ownership', async () => {
    const current = [library('a', 'Library A', [template('a1', 'A1')]), library('b', 'Library B')];
    const result = await prepareTemplateImport(current, [template('a1', 'A1')], 'b', version, callbacks());
    assert.deepEqual(refs(find(result, 'a')), ['a1']);
    assert.deepEqual(refs(find(result, 'b')), ['generated-1']);
    assert.equal(result.templates[0].revision, 0);
});

test('individual import into a deleted library fails instead of recreating it', async () => {
    await assert.rejects(prepareTemplateImport([], [template('a1', 'A1')], 'a', version, callbacks()), /no longer exists/);
});


test('individual imports preserve numeric and boolean library names without requesting a rename', async () => {
    for (const name of [123, 0, false, true]) {
        const current = library('a', name, [template('existing', 'Existing')]);
        const prompts = callbacks();
        const result = await prepareTemplateImport([current], [template('new', 'New')], 'a', version, prompts);
        assert.equal(find(result, 'a').name, String(name));
        assert.deepEqual(prompts.conflicts, []);
        assert.deepEqual(prompts.renames, []);
        assert.equal(current.name, name);
    }
});
