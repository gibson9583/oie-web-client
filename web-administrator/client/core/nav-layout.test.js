/* Unit tests for the nav-rail merge + edits (core/nav-layout.js). Pure functions,
   so the interesting cases are the ones a changing registry produces. */
import {
    emptyLayout, isCustomized, normalizeLayout, mergeNav,
    withMovedItem, withMovedGroup, withHidden, withGroupLabel, withItemLabel,
    withNewGroup, withoutGroup
} from './nav-layout.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.error('  FAIL -', label); } };
const eq = (a, b, label) => ok(JSON.stringify(a) === JSON.stringify(b), `${label} (got ${JSON.stringify(a)})`);

const OPTS = { sectionOrder: ['Monitor', 'Design', 'Manage'], sectionRank: { Other: 800, Plugins: 900 } };
const REG = [
    { id: 'dashboard', label: 'Dashboard', section: 'Monitor', order: 0 },
    { id: 'alerts', label: 'Alerts', section: 'Monitor', order: 1 },
    { id: 'events', label: 'Events', section: 'Monitor', order: 2 },
    { id: 'channels', label: 'Channels', section: 'Design', order: 0 },
    { id: 'users', label: 'Users', section: 'Manage', order: 0 },
    { id: 'logout', label: 'Sign out', section: 'Other', order: 0, action: true }
];
const names = (groups) => groups.map((g) => g.label);
const idsIn = (groups, gid) => (groups.find((g) => g.id === gid) || { items: [] }).items.map((i) => i.id);

/* ---- the default: declared order, nothing stored ---- */
let g = mergeNav(REG, emptyLayout(), OPTS);
eq(names(g), ['Monitor', 'Design', 'Manage', 'Other'], 'declared section order, Other ranked last');
eq(idsIn(g, 'Monitor'), ['dashboard', 'alerts', 'events'], 'items in declared order');
ok(!isCustomized(emptyLayout()), 'an empty layout is not customized');

/* ---- renaming a group is a label override on a stable id ---- */
let l = withGroupLabel(emptyLayout(), 'Monitor', 'Watch');
eq(l.groups, [{ id: 'Monitor', label: 'Watch' }], 'rename writes only {id,label}');
eq(l.items, {}, 'rename does not touch any item');
g = mergeNav(REG, l, OPTS);
eq(names(g), ['Watch', 'Design', 'Manage', 'Other'], 'the renamed group shows its label');
eq(idsIn(g, 'Monitor'), ['dashboard', 'alerts', 'events'], 'items still resolve by the declared id');
ok(g[0].renamed === true, 'a renamed group is flagged for the reset affordance');
eq(withGroupLabel(l, 'Monitor', '').groups, [], 'an empty name clears the override');
eq(withGroupLabel(l, 'Monitor', 'Monitor').groups, [], 'renaming back to the id clears it too');

/* ---- moving items ---- */
g = mergeNav(REG, emptyLayout(), OPTS);
l = withMovedItem(emptyLayout(), g, 'alerts', 'Design', 0);
g = mergeNav(REG, l, OPTS);
eq(idsIn(g, 'Design'), ['alerts', 'channels'], 'the item lands at the requested index');
eq(idsIn(g, 'Monitor'), ['dashboard', 'events'], 'and leaves its old group');
ok(l.items.alerts.group === 'Design', 'the move records the target group');

// `index` is post-removal, so the keyboard cases are plain arithmetic: down one is
// cur+1, up one is cur-1, and anything past the end appends.
g = mergeNav(REG, emptyLayout(), OPTS);
eq(idsIn(mergeNav(REG, withMovedItem(emptyLayout(), g, 'dashboard', 'Monitor', 1), OPTS), 'Monitor'),
    ['alerts', 'dashboard', 'events'], 'move down one (cur 0 -> index 1)');
eq(idsIn(mergeNav(REG, withMovedItem(emptyLayout(), g, 'events', 'Monitor', 1), OPTS), 'Monitor'),
    ['dashboard', 'events', 'alerts'], 'move up one (cur 2 -> index 1)');
eq(idsIn(mergeNav(REG, withMovedItem(emptyLayout(), g, 'dashboard', 'Monitor', 99), OPTS), 'Monitor'),
    ['alerts', 'events', 'dashboard'], 'an index past the end appends');

/* ---- hide / show ---- */
l = withHidden(emptyLayout(), 'events', true);
ok(mergeNav(REG, l, OPTS)[0].items.find((i) => i.id === 'events').hidden === true, 'hidden is exposed on the item');
eq(withHidden(l, 'events', false).items, {}, 'un-hiding drops the entry entirely');

/* ---- item rename ---- */
l = withItemLabel(emptyLayout(), 'users', 'People', 'Users');
ok(mergeNav(REG, l, OPTS).find((x) => x.id === 'Manage').items[0].label === 'People', 'the item shows its override');
ok(mergeNav(REG, l, OPTS).find((x) => x.id === 'Manage').items[0].declaredLabel === 'Users', 'the declared label is kept for reset');
eq(withItemLabel(l, 'users', 'Users', 'Users').items, {}, 'renaming back to the declared label clears it');

/* ---- custom groups ---- */
g = mergeNav(REG, emptyLayout(), OPTS);
const made = withNewGroup(emptyLayout(), g, 'Daily');
ok(made.id === 'u1', 'the first custom group is u1');
l = made.layout;
ok(l.groups.length === 5, 'adding a group pins the order of the existing ones');
g = mergeNav(REG, l, OPTS);
ok(g[g.length - 1].id === 'u1' && g[g.length - 1].custom === true, 'the custom group is appended and flagged');

l = withMovedItem(l, g, 'events', 'u1', 0);
g = mergeNav(REG, l, OPTS);
eq(idsIn(g, 'u1'), ['events'], 'an item can live in a custom group');

// Deleting it must not take the item with it.
l = withoutGroup(l, 'u1');
g = mergeNav(REG, l, OPTS);
ok(!g.some((x) => x.id === 'u1'), 'the group is gone');
ok(idsIn(g, 'Monitor').includes('events'), 'its item fell back to the group it declares');

// A layout naming a group that no longer exists still resolves.
g = mergeNav(REG, { version: 1, groups: [], items: { events: { group: 'ghost', order: 0 } } }, OPTS);
ok(idsIn(g, 'Monitor').includes('events'), 'an item pointing at a missing group falls back');

/* ---- group reordering ---- */
g = mergeNav(REG, emptyLayout(), OPTS);
l = withMovedGroup(emptyLayout(), g, 'Manage', 0);
eq(names(mergeNav(REG, l, OPTS)), ['Manage', 'Monitor', 'Design', 'Other'], 'a group can be moved to the front');

/* ---- a registry that changes underneath a customized layout ---- */
g = mergeNav(REG, emptyLayout(), OPTS);
l = withMovedItem(withGroupLabel(emptyLayout(), 'Monitor', 'Watch'), g, 'alerts', 'Design', 0);
const before = JSON.stringify(l);

// A plugin installs: it appears at the end of the group it declares, and the
// preference is not rewritten.
const WITH_PLUGIN = REG.concat([{ id: 'store', label: 'Community Store', section: 'Manage', order: 9 }]);
g = mergeNav(WITH_PLUGIN, l, OPTS);
eq(idsIn(g, 'Manage'), ['users', 'store'], 'a new plugin item lands at the end of its declared group');
ok(JSON.stringify(l) === before, 'merging does not mutate the layout');

// An app update ships a new view in a group the user renamed.
const WITH_NEW = REG.concat([{ id: 'insights', label: 'Insights', section: 'Monitor', order: 3 }]);
eq(idsIn(mergeNav(WITH_NEW, l, OPTS), 'Monitor'), ['dashboard', 'events', 'insights'],
    'a new view appears in its declared group with no migration');

// RBAC removes an item (the caller filters): it vanishes, its entry survives.
const DENIED = REG.filter((r) => r.id !== 'users');
ok(!idsIn(mergeNav(DENIED, l, OPTS), 'Manage').includes('users'), 'a filtered-out item does not render');
g = mergeNav(REG, l, OPTS);
ok(idsIn(g, 'Manage').includes('users'), 'and comes back in place when permitted again');

// The plugin is uninstalled after being placed: no ghost row.
let placed = withMovedItem(l, mergeNav(WITH_PLUGIN, l, OPTS), 'store', 'Monitor', 0);
ok(placed.items.store, 'the stored entry for the plugin exists');
ok(!mergeNav(REG, placed, OPTS).some((x) => x.items.some((i) => i.id === 'store')), 'an uninstalled item leaves no row');

/* ---- normalize tolerates junk ---- */
eq(normalizeLayout(null), emptyLayout(), 'null normalizes to empty');
eq(normalizeLayout({ groups: [{ nope: 1 }, { id: 'A', label: '' }], items: { x: { order: 'no' }, y: 3 } }),
    { version: 1, groups: [{ id: 'A' }], items: {} }, 'junk entries are dropped');

console.log(`nav-layout: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
