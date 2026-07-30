/*
 * User-configurable navigation rail: the merge and the edits, as pure functions.
 *
 * The stored preference is a SPARSE OVERLAY, never a copy of the menu. Nav items
 * come from `platform.navItems()`, which changes underneath us all the time — a
 * plugin installs or is removed, RBAC hides a view per user, an app update ships a
 * new one. A stored snapshot would break on every one of those: new views would
 * never appear and removed ones would linger as dead rows. So the preference
 * records only the user's deltas, and anything it has never heard of falls back to
 * the group and order the item itself declares.
 *
 *   {
 *     version: 1,
 *     groups: [{ id, label?, custom? }],        // order + renames + custom groups
 *     items: { <itemId>: { group?, order?, hidden?, label? } }
 *   }
 *
 * A built-in group keeps its DECLARED id ('Monitor'), and a rename only writes a
 * `label` override — renaming by mutating the name would orphan every item whose
 * source declares `section: 'Monitor'`, including plugin items from other repos.
 *
 * Every edit takes a layout and returns a NEW one, so React state updates are a
 * plain assignment and nothing mutates a preference in place.
 */

export const NAV_LAYOUT_VERSION = 1;

/** The neutral layout: no customization, rail exactly as the app declares it. */
export function emptyLayout() {
    return { version: NAV_LAYOUT_VERSION, groups: [], items: {} };
}

/** Has the user actually changed anything? (Drives "Reset" and whether to store.) */
export function isCustomized(layout) {
    if (!layout) return false;
    return (layout.groups || []).length > 0 || Object.keys(layout.items || {}).length > 0;
}

/** Tolerate anything the store hands back — an old shape, a hand-edited blob. */
export function normalizeLayout(raw) {
    if (!raw || typeof raw !== 'object') return emptyLayout();
    const groups = Array.isArray(raw.groups)
        ? raw.groups.filter((g) => g && typeof g.id === 'string').map((g) => {
            const out = { id: g.id };
            if (typeof g.label === 'string' && g.label) out.label = g.label;
            if (g.custom) out.custom = true;
            return out;
        })
        : [];
    const items = {};
    const src = raw.items && typeof raw.items === 'object' ? raw.items : {};
    for (const [id, v] of Object.entries(src)) {
        if (!v || typeof v !== 'object') continue;
        const out = {};
        if (typeof v.group === 'string' && v.group) out.group = v.group;
        if (Number.isFinite(v.order)) out.order = v.order;
        if (v.hidden) out.hidden = true;
        if (typeof v.label === 'string' && v.label) out.label = v.label;
        if (Object.keys(out).length) items[id] = out;
    }
    return { version: NAV_LAYOUT_VERSION, groups, items };
}

const clone = (l) => JSON.parse(JSON.stringify(l || emptyLayout()));

/**
 * Merge the live registry with the stored preference.
 *
 * `items` is what platform.navItems() gives us, already RBAC-filtered by the
 * caller — a preference can reorder and hide, but must never be able to reveal a
 * view the user's permissions deny.
 *
 * Returns [{ id, label, custom, renamed, items: [{ …item, label, declaredLabel,
 * renamed, hidden }] }] in the order the rail should render.
 */
export function mergeNav(items, layout, { sectionOrder = [], sectionRank = {}, legacySections = {} } = {}) {
    const l = normalizeLayout(layout);
    const list = Array.isArray(items) ? items.filter(Boolean) : [];
    const sectionOf = (it) => legacySections[it.section] || it.section || 'Plugins';

    // Sections the registry declares, ranked the way the shell ranks them, so a
    // section a plugin invents can't jump ahead of the app's own groups.
    const declared = [];
    for (const it of list) {
        const s = sectionOf(it);
        if (!declared.includes(s)) declared.push(s);
    }
    const rank = (s) => {
        const i = sectionOrder.indexOf(s);
        return i >= 0 ? i : (Number.isFinite(sectionRank[s]) ? sectionRank[s] : 500);
    };
    declared.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

    // Stored order first, then anything new appended in declared order.
    const ids = l.groups.map((g) => g.id);
    for (const s of declared) if (!ids.includes(s)) ids.push(s);

    const groups = ids.map((id) => {
        const stored = l.groups.find((g) => g.id === id) || {};
        return {
            id,
            label: stored.label || id,
            custom: !!stored.custom,
            renamed: !!stored.label,
            items: []
        };
    });
    const byId = new Map(groups.map((g) => [g.id, g]));

    for (const it of list) {
        const pref = l.items[it.id] || {};
        // A group the preference names may no longer exist (a deleted custom group,
        // or a stale blob): fall back to what the item declares.
        const gid = pref.group && byId.has(pref.group) ? pref.group : sectionOf(it);
        const group = byId.get(gid) || byId.get(sectionOf(it)) || groups[0];
        if (!group) continue;
        group.items.push({
            ...it,
            label: pref.label || it.label,
            declaredLabel: it.label,
            renamed: !!pref.label,
            hidden: !!pref.hidden,
            // Pinned items sort by their stored order; everything else after them,
            // by what it declares — so a new item lands at the end of its group.
            order: Number.isFinite(pref.order) ? pref.order : 1000 + (Number.isFinite(it.order) ? it.order : 0)
        });
    }
    for (const g of groups) g.items.sort((a, b) => a.order - b.order || String(a.label).localeCompare(String(b.label)));
    return groups;
}

/* ---- edits: layout in, new layout out ---------------------------------------- */

function groupEntry(l, id) {
    let e = l.groups.find((g) => g.id === id);
    if (!e) { e = { id }; l.groups.push(e); }
    return e;
}
function itemEntry(l, id) {
    if (!l.items[id]) l.items[id] = {};
    return l.items[id];
}
function dropEmpty(l) {
    for (const id of Object.keys(l.items)) {
        if (!Object.keys(l.items[id]).length) delete l.items[id];
    }
    l.groups = l.groups.filter((g) => g.custom || g.label || l.groups.length > 1);
    return l;
}

/** Every group listed, so a reordering of them is meaningful and stable. */
function pinGroupOrder(l, groups) {
    for (const g of groups) groupEntry(l, g.id);
    const want = groups.map((g) => g.id);
    l.groups.sort((a, b) => want.indexOf(a.id) - want.indexOf(b.id));
    return l;
}

/**
 * Move an item to `index` within `toGroupId`. `groups` is the current merge.
 *
 * `index` is the position in the target list AFTER the item has been taken out of
 * wherever it was — so "move down one" is `cur + 1`, "move up one" is `cur - 1`,
 * and "append" is any index >= length. A drop handler working from rendered
 * positions has to subtract one when an item moves DOWN within its own group,
 * because everything below it has shifted up; that compensation belongs at the
 * drop site, where the rendered index came from.
 */
export function withMovedItem(layout, groups, itemId, toGroupId, index) {
    const l = clone(layout);
    const from = groups.find((g) => g.items.some((i) => i.id === itemId));
    const to = groups.find((g) => g.id === toGroupId);
    if (!from || !to) return l;

    // Work on shallow copies of the two affected orders, then write them out.
    const moving = from.items.find((i) => i.id === itemId);
    const fromIds = from.items.filter((i) => i.id !== itemId).map((i) => i.id);
    const toIds = from === to ? fromIds : to.items.map((i) => i.id);
    const at = Math.max(0, Math.min(index, toIds.length));
    toIds.splice(at, 0, itemId);

    if (from !== to) {
        itemEntry(l, itemId).group = to.id;
        fromIds.forEach((id, i) => { itemEntry(l, id).order = i; });
    }
    toIds.forEach((id, i) => { itemEntry(l, id).order = i; });
    void moving;
    return dropEmpty(l);
}

/** Move a group to `index` in the rail. */
export function withMovedGroup(layout, groups, groupId, index) {
    const l = pinGroupOrder(clone(layout), groups);
    const cur = l.groups.findIndex((g) => g.id === groupId);
    if (cur < 0) return l;
    const [e] = l.groups.splice(cur, 1);
    l.groups.splice(Math.max(0, Math.min(index, l.groups.length)), 0, e);
    return l;
}

/** Hide or show an item in the rail. Hiding never touches its route. */
export function withHidden(layout, itemId, hidden) {
    const l = clone(layout);
    const e = itemEntry(l, itemId);
    if (hidden) e.hidden = true; else delete e.hidden;
    return dropEmpty(l);
}

/** Rename a group. An empty name (or the declared id) clears the override. */
export function withGroupLabel(layout, groupId, label) {
    const l = clone(layout);
    const e = groupEntry(l, groupId);
    const clean = String(label || '').trim();
    if (!clean || clean === groupId) delete e.label; else e.label = clean;
    return dropEmpty(l);
}

/** Rename an item. An empty name (or the declared label) clears the override. */
export function withItemLabel(layout, itemId, label, declaredLabel) {
    const l = clone(layout);
    const e = itemEntry(l, itemId);
    const clean = String(label || '').trim();
    if (!clean || clean === declaredLabel) delete e.label; else e.label = clean;
    return dropEmpty(l);
}

/**
 * Add a user group. Ids are generated (`u1`, `u2`…) and never derived from the
 * name, so renaming one later doesn't orphan the items assigned to it.
 * Returns { layout, id }.
 */
export function withNewGroup(layout, groups, label) {
    const l = pinGroupOrder(clone(layout), groups);
    let n = 1;
    const taken = new Set(l.groups.map((g) => g.id));
    while (taken.has('u' + n)) n++;
    const id = 'u' + n;
    l.groups.push({ id, label: String(label || '').trim() || 'New group', custom: true });
    return { layout: l, id };
}

/**
 * Delete a group. Its items fall back to the group they declare rather than
 * leaving with it — a delete must not be able to lose a view.
 */
export function withoutGroup(layout, groupId) {
    const l = clone(layout);
    l.groups = l.groups.filter((g) => g.id !== groupId);
    for (const id of Object.keys(l.items)) {
        if (l.items[id].group === groupId) {
            delete l.items[id].group;
            delete l.items[id].order;
        }
    }
    return dropEmpty(l);
}
