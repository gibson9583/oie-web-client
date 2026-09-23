import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: ['web-administrator/client/react/views/channel-import.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { consolidateBundledLibraries, resolveGroupImport, applyGroupImports, bundledLibrarySaveError } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const template = id => ({ id, name: id, properties: { code: id } });
const library = (id, templates, enabled = [], disabled = []) => ({ id, name: id, codeTemplates: { codeTemplate: templates }, enabledChannelIds: { string: enabled }, disabledChannelIds: { string: disabled } });
const group = (id, name, members = [], revision = 3) => ({ id, name, revision, channels: { channel: members.map(id => ({ id })) } });

test('shared templates and duplicate libraries consolidate once with enabled channels winning', () => {
    const bundles = [
        { channelId: 'c-a', libraries: [library('lib', [template('a'), template('a')], ['x'], ['c-b'])] },
        { channelId: 'c-b', libraries: [library('lib', [template('a'), template('b')], ['y'], ['c-a'])] },
        { channelId: 'c-c', libraries: [library('other', [template('a'), template('z')])] }
    ];
    const before = structuredClone(bundles);
    const merged = consolidateBundledLibraries(bundles);
    assert.deepEqual(merged[0].codeTemplates.codeTemplate.map(t => t.id), ['a', 'b']);
    assert.deepEqual(merged[1].codeTemplates.codeTemplate.map(t => t.id), ['z']);
    assert.deepEqual(new Set(merged[0].enabledChannelIds.string), new Set(['x', 'y', 'c-a', 'c-b']));
    assert.equal(merged[0].disabledChannelIds, '');
    assert.deepEqual(bundles, before);
});

test('same ID with a different name gets a fresh group without a conflict prompt', async () => {
    const resolved = await resolveGroupImport([group('g', 'Existing')], group('g', 'Imported'), {
        newId: () => 'new', overwrite: () => assert.fail('no name conflict'), rename: () => assert.fail('no name conflict')
    });
    assert.equal(resolved.group.id, 'new');
    assert.equal(resolved.group.revision, 0);
});

test('group name comparisons are case-sensitive like Swing', async () => {
    const resolved = await resolveGroupImport([group('g', 'Existing')], group('new', 'existing'), {
        newId: () => 'unused', overwrite: () => assert.fail('not a conflict'), rename: () => assert.fail('not a conflict')
    });
    assert.equal(resolved.group.id, 'new');
});

test('named-group overwrite retains import identity and removes old named group', async () => {
    const baseline = [group('old', 'Same', ['old-channel']), group('other', 'Other', ['move', 'keep'])];
    const resolved = await resolveGroupImport(baseline, group('incoming', 'Same', ['move', 'new']), {
        newId: () => 'unused', overwrite: async () => true, rename: () => assert.fail('overwrite')
    });
    const result = applyGroupImports(baseline, baseline, [resolved]);
    assert.deepEqual(result.removedIds, ['old']);
    assert.deepEqual(result.groups.map(g => [g.id, g.channels?.channel.map(c => c.id)]), [['other', ['keep']], ['incoming', ['move', 'new']]]);
    assert.equal(result.groups[1].revision, 0);
    assert.deepEqual(baseline[1].channels.channel.map(c => c.id), ['move', 'keep']);
});

test('same-name same-ID overwrite reuses the current revision', async () => {
    const result = await resolveGroupImport([group('g', 'Same', [], 12)], group('g', 'Same', [], 1), {
        newId: () => 'unused', overwrite: async () => true, rename: () => assert.fail('overwrite')
    });
    assert.equal(result.group.revision, 12);
});

test('create-new prompts until name is free and cancellation stops the group save', async () => {
    const names = ['Same', 'Other', 'New'];
    const result = await resolveGroupImport([group('g', 'Same'), group('o', 'Other')], group('g', 'Same'), {
        newId: () => 'copy', overwrite: async () => false, rename: async () => names.shift()
    });
    assert.equal(result.group.id, 'copy');
    assert.equal(result.group.name, 'New');
    assert.equal(await resolveGroupImport([group('g', 'Same')], group('g', 'Same'), {
        newId: () => 'unused', overwrite: async () => false, rename: async () => null
    }), null);
});

for (const mutation of [
    baseline => [...baseline, group('new', 'New')],
    baseline => [],
    baseline => [{ ...baseline[0], revision: 4 }],
    baseline => [{ ...baseline[0], name: 'Edited' }]
]) test('a concurrent group change blocks a stale collection write', () => {
    const baseline = [group('g', 'Existing')];
    assert.throws(() => applyGroupImports(mutation(baseline), baseline, []), /changed during import/);
});

test('all library bulk result failures are detected, including nested per-template failures', () => {
    assert.match(bundledLibrarySaveError({ overrideNeeded: true }), /changed during import/);
    assert.equal(bundledLibrarySaveError({ librariesSuccess: false, librariesCause: { detailMessage: 'bad library' } }), 'bad library');
    assert.equal(bundledLibrarySaveError({ librariesSuccess: true, codeTemplateResults: { entry: [{ result: { success: true } }, { result: { success: 'false', cause: { detailMessage: 'bad template' } } }] } }), 'bad template');
    assert.equal(bundledLibrarySaveError({ librariesSuccess: true, codeTemplateResults: { entry: { success: true } } }), '');
});

test('a cached copied group ID already persisted on a partial attempt never overwrites it silently', async () => {
    const ids = ['already-persisted', 'fresh'];
    const result = await resolveGroupImport([group('original', 'Original'), group('already-persisted', 'Prior Copy')], group('original', 'Renamed Import'), {
        newId: () => ids.shift(), overwrite: () => assert.fail('no name conflict'), rename: () => assert.fail('no name conflict')
    });
    assert.equal(result.group.id, 'fresh');
});
