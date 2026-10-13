import assert from 'node:assert/strict';
import { channelPaletteEntries, contextSuggestions, entryAllowed, templatePaletteEntries } from './command-suggestions.js';

const allowAll = () => true;
const idsOf = entries => entries.map(entry => entry.id);
const channels = [
    { id: 'orders', name: 'Orders', state: 'STARTED' },
    { id: 'results', name: 'Results', state: 'STOPPED' },
    { id: 'excluded', name: 'Excluded' }
];
const library = (id, extra = {}) => ({
    id, name: id, includeNewChannels: false,
    codeTemplates: { codeTemplate: { id: `${id}-template`, name: `${id} function` } },
    ...extra
});
const relatedLibrary = library('linked', { enabledChannelIds: { string: 'orders' } });
const channelContext = (surface, extra = {}) => ({ kind: 'channel', surface, channelIds: ['orders'], ...extra });

// Every view uses the same destinations, but should never reload its own content.
const surfaceMatrix = [
    ['messages', ['chan:orders']],
    ['editor', ['chanmsg:orders']],
    ['connector', ['chan:orders', 'chanmsg:orders']],
    ['dashboard', ['chan:orders', 'chanmsg:orders']],
    ['channels', ['chan:orders', 'chanmsg:orders']]
];
for (const [surface, expected] of surfaceMatrix) {
    const suggested = contextSuggestions(channelContext(surface), channels, [relatedLibrary], allowAll);
    assert.deepEqual(idsOf(suggested), [...expected, 'library:linked', 'template:linked-template'], surface);
    assert.ok(suggested.every(entry => entry.group === 'Suggested'), `${surface} has a separate Suggested group`);
    assert.deepEqual(contextSuggestions(channelContext(surface, { channelIds: [] }), channels, [relatedLibrary], allowAll), [],
        `${surface}: a cleared selection or unsaved channel cannot suggest unrelated content`);
}
assert.deepEqual(contextSuggestions(null, channels, [relatedLibrary], allowAll), []);
assert.deepEqual(contextSuggestions(channelContext('messages', { channelIds: ['missing'] }), channels, [], allowAll), []);
console.log('command-suggestions: messages, editors, connector editors, dashboard and channels context passed');

// Match the engine's explicit/default/excluded membership rules, including
// singleton XStream wrappers and explicit inclusion overriding a default exclusion.
const associationLibraries = [
    relatedLibrary,
    library('default', { includeNewChannels: true, disabledChannelIds: { string: 'excluded' } }),
    library('excluded-by-default', { includeNewChannels: true, disabledChannelIds: { string: 'orders' } }),
    library('explicit-wins', {
        includeNewChannels: true,
        enabledChannelIds: { string: 'orders' },
        disabledChannelIds: { string: 'orders' }
    }),
    library('other-channel', { enabledChannelIds: { string: 'results' } }),
    library('unassigned'),
    null
];
const associationsBefore = structuredClone(associationLibraries);
const relatedIds = context => idsOf(contextSuggestions(context, channels, associationLibraries, allowAll))
    .filter(id => id.startsWith('library:'));
assert.deepEqual(relatedIds(channelContext('messages')), ['library:linked', 'library:default', 'library:explicit-wins']);
assert.deepEqual(relatedIds(channelContext('messages', { channelIds: ['results'] })),
    ['library:default', 'library:excluded-by-default', 'library:explicit-wins', 'library:other-channel']);
assert.deepEqual(relatedIds(channelContext('channels', { channelIds: ['orders', 'results', 'orders'] })),
    ['library:linked', 'library:default', 'library:excluded-by-default', 'library:explicit-wins', 'library:other-channel'],
    'multi-selection unions related libraries without duplicating shared destinations');
assert.deepEqual(associationLibraries, associationsBefore, 'suggestion reads must preserve library payloads');

const pending = new Map([['linked', false], ['unassigned', true], ['default', false], ['removed-library', true]]);
const pendingBefore = [...pending];
assert.deepEqual(relatedIds(channelContext('editor', { librarySelection: pending })),
    ['library:explicit-wins', 'library:unassigned'], 'pending checkbox intent takes precedence over server membership');
assert.deepEqual([...pending], pendingBefore, 'reading suggestions must not checkpoint or change pending work');
pending.set('linked', true);
pending.set('unassigned', false);
assert.deepEqual(relatedIds(channelContext('editor', { librarySelection: pending })),
    ['library:linked', 'library:explicit-wins'], 'in-place checkbox changes are read on the next calculation');
assert.deepEqual(relatedIds(channelContext('editor', { librarySelection: new Map() })),
    ['library:linked', 'library:default', 'library:explicit-wins'], 'missing draft choices fall back to engine membership');
assert.deepEqual(contextSuggestions(channelContext('editor', { channelIds: [], librarySelection: pending }),
    channels, associationLibraries, allowAll), [], 'pending library choices do not make a new unsaved channel navigable');
console.log('command-suggestions: singleton memberships, default exclusions, unions and pending checkbox precedence passed');

// Template/library selection resolves back to channels using the working model,
// even when a stale fetched copy disagrees with an unsaved membership change.
const draftLibrary = library('draft', {
    includeNewChannels: true,
    disabledChannelIds: { string: 'results' },
    codeTemplates: { codeTemplate: { id: 'chosen-template', name: 'Chosen' } }
});
const reverseContext = selected => ({ kind: 'templates', libraries: [draftLibrary], selected });
const staleLibraries = [library('draft', { enabledChannelIds: { string: 'results' } })];
for (const selected of [{ kind: 'library', id: 'draft' }, { kind: 'template', id: 'chosen-template' }]) {
    assert.deepEqual(idsOf(contextSuggestions(reverseContext(selected), channels, staleLibraries, allowAll)),
        ['chan:orders', 'chanmsg:orders', 'chan:excluded', 'chanmsg:excluded'], selected.kind);
}
draftLibrary.includeNewChannels = false;
draftLibrary.enabledChannelIds = { string: 'results' };
assert.deepEqual(idsOf(contextSuggestions(reverseContext({ kind: 'template', id: 'chosen-template' }), channels, staleLibraries, allowAll)),
    ['chan:results', 'chanmsg:results'], 'reverse suggestions use the latest pending membership');
for (const selected of [null, { kind: 'library', id: 'removed' }, { kind: 'template', id: 'removed' }]) {
    assert.deepEqual(contextSuggestions(reverseContext(selected), channels, staleLibraries, allowAll), [], 'no fallback for a missing selection');
}
assert.deepEqual(contextSuggestions(reverseContext({ kind: 'library', id: 'draft' }), [], staleLibraries, allowAll), [],
    'unavailable channel data cannot create speculative reverse links');
console.log('command-suggestions: reverse library/template selection and pending membership changes passed');

// Server-provided names must remain renderable, malformed IDs are ignored, and
// identifiers are encoded for their route/query position without changing recents IDs.
const unusualId = 'orders /?&%#雪';
const channelInputs = [null, {}, { id: '' }, { id: ' \t' }, { id: 9 },
    { id: unusualId, name: { unexpected: 'object' } },
    { id: unusualId, name: 'Duplicate channel' },
    { id: 'empty-name', name: '' }, { id: 'number-name', name: 0 }, { id: 'bool-name', name: false }];
const channelEntries = channelPaletteEntries(channelInputs, allowAll);
assert.deepEqual(idsOf(channelEntries), [
    `chan:${unusualId}`, `chanmsg:${unusualId}`,
    'chan:empty-name', 'chanmsg:empty-name', 'chan:number-name', 'chanmsg:number-name', 'chan:bool-name', 'chanmsg:bool-name'
]);
assert.equal(channelEntries[0].label, unusualId);
assert.equal(channelEntries[0].path, '/channels/orders%20%2F%3F%26%25%23%E9%9B%AA/edit');
assert.equal(channelEntries[1].path, '/messages/orders%20%2F%3F%26%25%23%E9%9B%AA');
assert.equal(channelEntries[2].label, 'empty-name');
assert.equal(channelEntries[4].label, '0');
assert.equal(channelEntries[6].label, 'false');

const oddLibraryId = 'lib /?&%#雪';
const oddTemplateId = 'fn /?&%#雪';
const libraryInputs = [null, { id: '' }, { id: ' ' }, { id: 7 }, {
    id: oddLibraryId, name: { unexpected: 'object' },
    codeTemplates: { codeTemplate: [null, {}, { id: '' }, { id: 7 }, { id: oddTemplateId, name: [] }, { id: oddTemplateId, name: 'Duplicate' }] }
}, {
    id: oddLibraryId, name: 'Duplicate library', codeTemplates: { codeTemplate: { id: oddTemplateId } }
}, library('empty-library', { name: '', codeTemplates: null }), library('scalar-names', {
    name: 0, codeTemplates: { codeTemplate: { id: 'bool-template', name: false } }
})];
const templateEntries = templatePaletteEntries(libraryInputs, allowAll);
assert.deepEqual(idsOf(templateEntries), [`library:${oddLibraryId}`, `template:${oddTemplateId}`,
    'library:empty-library', 'library:scalar-names', 'template:bool-template']);
assert.equal(templateEntries[0].label, oddLibraryId);
assert.equal(templateEntries[1].label, oddTemplateId);
assert.equal(templateEntries[1].hint, oddLibraryId);
assert.equal(templateEntries[0].path, '/code-templates?libraryId=lib%20%2F%3F%26%25%23%E9%9B%AA');
assert.equal(templateEntries[1].path, '/code-templates?libraryId=lib%20%2F%3F%26%25%23%E9%9B%AA&templateId=fn%20%2F%3F%26%25%23%E9%9B%AA');
assert.equal(templateEntries[2].label, 'empty-library');
assert.equal(templateEntries[3].label, '0');
assert.equal(templateEntries[4].label, 'false');
const duplicateSelection = contextSuggestions(channelContext('channels', { channelIds: ['orders', 'orders', '', null] }),
    [...channels, channels[0]], [relatedLibrary, relatedLibrary], allowAll);
assert.deepEqual(idsOf(duplicateSelection), ['chan:orders', 'chanmsg:orders', 'library:linked', 'template:linked-template']);
console.log('command-suggestions: invalid payloads, renderable labels, encoded destinations and deduplication passed');

// Each permission is independently necessary. Filtering a denied destination
// must not hide unrelated authorized destinations or weaken the activation guard.
const permissions = ['view:doShowChannel', 'channel:doEditChannel', 'view:doShowMessages', 'codeTemplate:doRefreshCodeTemplates'];
for (const denied of permissions) {
    const can = (group, task) => `${group}:${task}` !== denied;
    const expected = [
        ...(!['view:doShowChannel', 'channel:doEditChannel'].includes(denied) ? ['chan:orders'] : []),
        ...(denied !== 'view:doShowMessages' ? ['chanmsg:orders'] : []),
        ...(denied !== 'codeTemplate:doRefreshCodeTemplates' ? ['library:linked', 'template:linked-template'] : [])
    ];
    assert.deepEqual(idsOf(contextSuggestions(channelContext('dashboard'), channels, [relatedLibrary], can)), expected, denied);
}
assert.deepEqual(contextSuggestions(channelContext('dashboard'), channels, [relatedLibrary], () => false), []);
assert.deepEqual(templatePaletteEntries([relatedLibrary], () => false), []);
assert.deepEqual(channelPaletteEntries(channels, () => false), []);
for (const [surface, denied] of [['channels', 'channel:doViewMessages'], ['dashboard', 'dashboard:doShowMessages']]) {
    const can = (group, task) => `${group}:${task}` !== denied;
    const context = channelContext(surface);
    assert.ok(!contextSuggestions(context, channels, [], can).some(entry => entry.id === 'chanmsg:orders'));
    const renderedMessage = contextSuggestions(context, channels, [], allowAll).find(entry => entry.id === 'chanmsg:orders');
    assert.equal(entryAllowed(renderedMessage, can), false, 'surface permission is checked again on activation');
}
const grants = new Set([...permissions, 'dashboard:doShowMessages']);
const canNow = (group, task) => grants.has(`${group}:${task}`);
const rendered = contextSuggestions(channelContext('dashboard'), channels, [relatedLibrary], canNow);
assert.ok(rendered.every(entry => entryAllowed(entry, canNow)));
grants.delete('channel:doEditChannel');
assert.equal(entryAllowed(rendered.find(entry => entry.id === 'chan:orders'), canNow), false,
    'an entry rendered before revocation is denied when selected');
assert.equal(entryAllowed(rendered.find(entry => entry.id === 'chanmsg:orders'), canNow), true,
    'independent message permission remains usable');
grants.delete('codeTemplate:doRefreshCodeTemplates');
assert.equal(entryAllowed(rendered.find(entry => entry.id === 'library:linked'), canNow), false);
assert.equal(entryAllowed(rendered.find(entry => entry.id === 'template:linked-template'), canNow), false);
grants.add('channel:doEditChannel');
grants.delete('view:doShowChannel');
assert.equal(entryAllowed(rendered.find(entry => entry.id === 'chan:orders'), canNow), false,
    'activation rechecks channel view permission as well as edit permission');
assert.equal(entryAllowed({}, () => false), true, 'entries without task requirements remain accessible');
assert.equal(entryAllowed({ permissions: [] }, () => false), true);
assert.equal(entryAllowed({ permissions: [['one', 'first'], ['two', 'second']] }, group => group === 'one'), false,
    'all permission requirements must pass');
console.log('command-suggestions: permission filtering and action-time revocation checks passed');
