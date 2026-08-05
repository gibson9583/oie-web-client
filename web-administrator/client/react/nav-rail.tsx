/*
 * The navigation rail, and its per-user customization.
 *
 * Groups come from merging `platform.navItems()` with the user's `navLayout`
 * preference (core/nav-layout.js owns that merge and every edit as pure
 * functions). The rail renders ONE list of groups, so an item can be dragged
 * anywhere — including between the app's own groups, a plugin's section, the
 * "Other" actions, and groups the user invents.
 *
 * Rules that hold no matter what the preference says:
 *  - RBAC wins. A layout can reorder and hide; it can never reveal a view the
 *    user's permissions deny — the filter runs before the merge.
 *  - Hiding is a NAV decision, not a routing one. A hidden item keeps its route:
 *    deep links, bookmarks and in-app navigation to it still work.
 *  - The customize control is chrome, not an entry. It lives in a footer strip
 *    outside the layout, because the one control that must never be hideable is
 *    the one that turns customizing on.
 *
 * Edits apply immediately (direct manipulation has nothing to commit) and persist
 * through core/prefs.js, which is already scoped per engine AND per user.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { contextMenu } from '@oie/web-ui';
import * as router from '../core/router.js';
import * as store from '../core/store.js';
import { getPref, setPrefs } from '../core/prefs.js';
import { platform } from '@oie/web-shell';
import {
    emptyLayout, normalizeLayout, isCustomized, mergeNav,
    withMovedItem, withMovedGroup, withHidden, withGroupLabel, withItemLabel,
    withNewGroup, withoutGroup
} from '../core/nav-layout.js';
import { Icon, useRouteChange, useStoreKey } from './bridges.jsx';
import { RailPane } from './ui.jsx';

/* 'Engine' was the single catch-all group before Monitor/Design/Manage, and
   plugins built against that convention still declare it. */
export const LEGACY_SECTIONS = { Engine: 'Manage' };
export const SECTION_ORDER = ['Monitor', 'Design', 'Manage'];
/* Other holds the app's own actions and sits last; a section a plugin invents
   lands between Manage and it, with the catch-all 'Plugins' behind both. */
export const SECTION_RANK = { Other: 800, Plugins: 900 };
const MERGE_OPTS = { sectionOrder: SECTION_ORDER, sectionRank: SECTION_RANK, legacySections: LEGACY_SECTIONS };

export function NavRail({ collapsed, onPeek, onLogout }: any) {
    const [layout, setLayout] = useState(() => normalizeLayout(getPref('navLayout')));
    const [editing, setEditing] = useState(false);
    const [renamingGroup, setRenamingGroup] = useState<any>(null);
    const [renamingItem, setRenamingItem] = useState<any>(null);
    const [dropHint, setDropHint] = useState<any>(null);   // { kind, id, edge }
    const dragRef = useRef<any>(null);                     // { kind: 'item'|'group', id }
    const bodyRef = useRef<any>(null);

    // The command palette's "Customize navigation" entry dispatches this event
    // (react/shell.tsx); edit mode is component-local state, so the rail itself
    // must listen (#22 — the entry was a silent no-op). Open the rail too: edit
    // affordances are invisible on the collapsed icon rail.
    useEffect(() => {
        const start = () => { setEditing(true); store.setState('railCollapsed', false); };
        window.addEventListener('webadmin:customize-nav', start);
        return () => window.removeEventListener('webadmin:customize-nav', start);
    }, []);

    const apply = useCallback((next: any) => {
        setLayout(next);
        // Store nothing at all when the user is back to the defaults, so an
        // untouched account keeps an empty preference rather than a no-op blob.
        setPrefs({ navLayout: isCustomized(next) ? next : null });
    }, []);

    // The registry is not reactive. Re-read it on navigation (which also gives us
    // the active item) and when the plugin set lands — that is when plugin nav
    // items, and any RBAC controller that gates them, actually appear.
    const current = useRouteChange();
    useStoreKey('webPlugins');
    const allowed = platform.navItems()
        .filter((it: any) => !it.task || platform.checkTask(it.rbac || 'view', it.task));
    const groups = mergeNav(allowed, layout, MERGE_OPTS);

    /* Customizing needs the expanded rail. At 56px there are no labels and no group
       headings, and nowhere to put the grips, the eyes or a rename field — the icon
       rail just gets cramped and unreadable. So entering customize mode opens the
       rail, and leaving it gives the space back if we were the ones who took it (a
       user who collapses it again mid-edit has said what they want). */
    const borrowedWidthRef = useRef(false);
    useEffect(() => {
        if (editing) {
            if (collapsed) {
                borrowedWidthRef.current = true;
                store.setState('railCollapsed', false);
            }
            return;
        }
        setRenamingGroup(null);
        setRenamingItem(null);
        if (borrowedWidthRef.current) {
            borrowedWidthRef.current = false;
            store.setState('railCollapsed', true);
        }
    }, [editing, collapsed]);

    /* ---- edits ---- */
    const move = (itemId: any, toGroup: any, index: any) => apply(withMovedItem(layout, groups, itemId, toGroup, index));
    const toggleHidden = (item: any) => apply(withHidden(layout, item.id, !item.hidden));
    const renameGroup = (id: any, name: any) => { setRenamingGroup(null); apply(withGroupLabel(layout, id, name)); };
    const renameItem = (item: any, name: any) => { setRenamingItem(null); apply(withItemLabel(layout, item.id, name, item.declaredLabel)); };
    const addGroup = () => {
        const made = withNewGroup(layout, groups, 'New group');
        apply(made.layout);
        setRenamingGroup(made.id);       // straight into the name field
    };
    const reset = () => apply(emptyLayout());

    /* ---- drag and drop ---- */
    const onDragStart = (kind: any, id: any) => (e: any) => {
        if (!editing) return;
        dragRef.current = { kind, id };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
    };
    const onDragEnd = () => { dragRef.current = null; setDropHint(null); };

    const onItemDragOver = (item: any) => (e: any) => {
        const drag = dragRef.current;
        if (!editing || !drag || drag.kind !== 'item') return;
        e.preventDefault();
        e.stopPropagation();
        const box = e.currentTarget.getBoundingClientRect();
        setDropHint({ kind: 'item', id: item.id, edge: e.clientY < box.top + box.height / 2 ? 'before' : 'after' });
    };
    const onItemDrop = (group: any, item: any, index: any) => (e: any) => {
        const drag = dragRef.current;
        if (!editing || !drag || drag.kind !== 'item') return;
        e.preventDefault();
        e.stopPropagation();
        const box = e.currentTarget.getBoundingClientRect();
        const after = e.clientY >= box.top + box.height / 2;
        let at = index + (after ? 1 : 0);
        // withMovedItem's index is post-removal: inside the same group, everything
        // below the dragged row has already shifted up by one.
        const from = groups.find((g: any) => g.items.some((i: any) => i.id === drag.id));
        if (from && from.id === group.id) {
            const cur = from.items.findIndex((i: any) => i.id === drag.id);
            if (cur < at) at -= 1;
        }
        move(drag.id, group.id, at);
        onDragEnd();
    };
    const onGroupDragOver = (group: any) => (e: any) => {
        const drag = dragRef.current;
        if (!editing || !drag) return;
        e.preventDefault();
        setDropHint({ kind: 'group', id: group.id });
    };
    const onGroupDrop = (group: any, index: any) => (e: any) => {
        const drag = dragRef.current;
        if (!editing || !drag) return;
        e.preventDefault();
        if (drag.kind === 'item') move(drag.id, group.id, Number.MAX_SAFE_INTEGER);
        else if (drag.id !== group.id) apply(withMovedGroup(layout, groups, drag.id, index));
        onDragEnd();
    };

    /* ---- keyboard: Alt+Up/Down moves an item, hopping groups at the edges ---- */
    const onBodyKeyDown = (e: any) => {
        if (!editing || !e.altKey) return;
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        const el = e.target.closest('[data-nav-item]');
        if (!el) return;
        const id = el.dataset.navItem;
        let gi = -1, ii = -1;
        groups.forEach((g: any, x: any) => g.items.forEach((it: any, y: any) => { if (it.id === id) { gi = x; ii = y; } }));
        if (gi < 0) return;
        e.preventDefault();
        const g = groups[gi];
        if (e.key === 'ArrowUp') {
            if (ii > 0) move(id, g.id, ii - 1);
            else if (gi > 0) move(id, groups[gi - 1].id, Number.MAX_SAFE_INTEGER);
        } else if (ii < g.items.length - 1) move(id, g.id, ii + 1);
        else if (gi < groups.length - 1) move(id, groups[gi + 1].id, 0);
        /* Focus follows the row across the re-render — but must never STEAL it.
           An in-group reorder keeps the same DOM node (React re-keys in place), so
           focus is already correct and re-applying it would yank the caret back
           after the user has moved on. Only restore when the row was remounted
           into another group and focus was dropped to nothing. */
        requestAnimationFrame(() => {
            const root = bodyRef.current;
            if (!root) return;
            const active = document.activeElement;
            if (active && active.closest && active.closest('[data-nav-item]')) return;
            const again = root.querySelector(`[data-nav-item="${cssEscape(id)}"]`);
            if (again) again.focus();
        });
    };

    /* ---- right-click: the shortcut entry point ---- */
    const openMenu = (e: any, { item, group }: any = {}) => {
        e.preventDefault();
        e.stopPropagation();
        const entries: any[] = [];
        if (item) {
            entries.push({
                label: item.hidden ? `Show “${item.label}”` : `Hide “${item.label}”`,
                icon: item.hidden ? 'check' : 'x',
                onClick: () => toggleHidden(item)
            });
            entries.push({
                label: `Rename “${item.label}”…`,
                icon: 'edit',
                onClick: () => { setEditing(true); setRenamingItem(item.id); }
            });
        }
        if (group && !item) {
            entries.push({
                label: 'Rename this group…',
                icon: 'edit',
                onClick: () => { setEditing(true); setRenamingGroup(group.id); }
            });
        }
        if (entries.length) entries.push('-');
        entries.push({
            label: editing ? 'Done customizing' : 'Customize navigation…',
            icon: 'settings',
            onClick: () => setEditing((v: any) => !v)
        });
        entries.push('-');
        entries.push({
            label: 'Reset navigation to default',
            icon: 'undo',
            onClick: reset
        });
        contextMenu(e.clientX, e.clientY, entries);
    };

    /* ---- render ---- */
    const peek = (label: any) => (collapsed ? {
        title: label,
        'aria-label': label,
        onMouseEnter: (e: any) => onPeek({ el: e.currentTarget, label }),
        onMouseLeave: () => onPeek(null),
        onFocus: (e: any) => onPeek({ el: e.currentTarget, label }),
        onBlur: () => onPeek(null)
    } : {});

    const activate = (item: any) => {
        if (item.action) item.action();
        else if (item.path) router.navigate(item.path);
    };

    return (
        <div className={'rail-nav' + (editing ? ' rail-editing' : '')} ref={bodyRef}
            onKeyDown={onBodyKeyDown}
            onContextMenu={(e: any) => openMenu(e)}>
            {groups.map((group: any, gi: any) => {
                const shown = editing ? group.items : group.items.filter((i: any) => !i.hidden);
                // An empty group stays visible while customizing so it can be a drop
                // target; otherwise it would vanish the moment it was created.
                if (!shown.length && !editing) return null;
                return (
                    <RailPane key={group.id} title={group.label} paneKey={group.id}
                        group={group.id === 'Other' ? 'other' : undefined}
                        className={dropHint && dropHint.kind === 'group' && dropHint.id === group.id ? 'rail-drop-into' : undefined}
                        headerExtra={editing ? (
                            <span className="rail-pane-tools">
                                {group.custom ? (
                                    <button type="button" className="rail-tool" title="Delete group"
                                        aria-label={`Delete group ${group.label}`}
                                        onClick={(e: any) => { e.stopPropagation(); apply(withoutGroup(layout, group.id)); }}>✕</button>
                                ) : null}
                                {group.renamed ? (
                                    <button type="button" className="rail-tool" title="Reset name"
                                        aria-label={`Reset name of ${group.label}`}
                                        onClick={(e: any) => { e.stopPropagation(); apply(withGroupLabel(layout, group.id, '')); }}>↺</button>
                                ) : null}
                            </span>
                        ) : null}
                        headerTitle={renamingGroup === group.id ? (
                            <input className="rail-name-input" autoFocus defaultValue={group.label}
                                aria-label="Group name"
                                onClick={(e: any) => e.stopPropagation()}
                                onKeyDown={(e: any) => {
                                    e.stopPropagation();
                                    if (e.key === 'Enter') renameGroup(group.id, e.currentTarget.value);
                                    else if (e.key === 'Escape') setRenamingGroup(null);
                                }}
                                onBlur={(e: any) => renameGroup(group.id, e.currentTarget.value)} />
                        ) : undefined}
                        onHeaderClick={editing ? () => setRenamingGroup(group.id) : undefined}
                        headerDraggable={editing}
                        onHeaderDragStart={onDragStart('group', group.id)}
                        onHeaderDragEnd={onDragEnd}
                        onPaneDragOver={onGroupDragOver(group)}
                        onPaneDrop={onGroupDrop(group, gi)}
                        onHeaderContextMenu={(e: any) => openMenu(e, { group })}>
                        {shown.map((item: any, index: any) => {
                            const active = !item.action && item.path && (current === item.path ||
                                current.startsWith(item.path + '/') || (item.match && item.match(current)));
                            const hint = dropHint && dropHint.kind === 'item' && dropHint.id === item.id ? dropHint.edge : null;
                            if (renamingItem === item.id) {
                                return (
                                    <span key={item.id} className="rail-item">
                                        <Icon name={item.icon || 'puzzle'} size={15} />
                                        <input className="rail-name-input" autoFocus defaultValue={item.label}
                                            aria-label="Item name"
                                            onKeyDown={(e: any) => {
                                                e.stopPropagation();
                                                if (e.key === 'Enter') renameItem(item, e.currentTarget.value);
                                                else if (e.key === 'Escape') setRenamingItem(null);
                                            }}
                                            onBlur={(e: any) => renameItem(item, e.currentTarget.value)} />
                                    </span>
                                );
                            }
                            return (
                                <span key={item.id} className="rail-row">
                                    <button type="button"
                                        data-nav-item={item.id}
                                        className={'rail-item' + (active ? ' active' : '') +
                                            (item.hidden ? ' rail-hidden' : '') +
                                            (hint ? ' rail-drop-' + hint : '')}
                                        draggable={editing || undefined}
                                        onDragStart={onDragStart('item', item.id)}
                                        onDragEnd={onDragEnd}
                                        onDragOver={onItemDragOver(item)}
                                        onDrop={onItemDrop(group, item, index)}
                                        onContextMenu={(e: any) => openMenu(e, { item, group })}
                                        {...peek(item.label)}
                                        onClick={() => {
                                            if (!editing) { activate(item); return; }
                                            setRenamingItem(item.id);   // in customize mode a click renames
                                        }}>
                                        {editing ? <span className="rail-grip" aria-hidden="true">⠿</span> : null}
                                        <Icon name={item.icon || 'puzzle'} size={15} />
                                        <span className="rail-label">{item.label}</span>
                                    </button>
                                    {editing ? (
                                        <button type="button" className="rail-eye"
                                            title={`${item.hidden ? 'Show' : 'Hide'} ${item.label}`}
                                            aria-label={`${item.hidden ? 'Show' : 'Hide'} ${item.label}`}
                                            aria-pressed={String(!item.hidden) as any}
                                            onClick={(e: any) => { e.stopPropagation(); toggleHidden(item); }}>
                                            <Icon name={item.hidden ? 'eyeOff' : 'eye'} size={14} />
                                        </button>
                                    ) : null}
                                </span>
                            );
                        })}
                        {editing && !shown.length ? <div className="rail-empty-slot">drop items here</div> : null}
                    </RailPane>
                );
            })}

            {/* Chrome, deliberately outside the layout: New group and Reset only
                exist while customizing, and the gear itself can never be hidden. */}
            <div className="rail-customize">
                {editing ? (
                    <>
                        <button type="button" className="rail-item rail-chrome" id="rail-add-group"
                            onClick={addGroup} {...peek('New group')}>
                            <Icon name="plus" size={15} /><span className="rail-label">New group</span>
                        </button>
                        <button type="button" className="rail-item rail-chrome" id="rail-reset-nav"
                            onClick={reset} {...peek('Reset to default')}>
                            <Icon name="undo" size={15} /><span className="rail-label">Reset to default</span>
                        </button>
                    </>
                ) : null}
                <button type="button" className={'rail-item rail-chrome' + (editing ? ' on' : '')}
                    id="rail-customize" aria-pressed={String(editing) as any}
                    onClick={() => setEditing((v: any) => !v)}
                    {...peek(editing ? 'Done' : 'Customize')}>
                    <Icon name={editing ? 'check' : 'sliders'} size={15} />
                    <span className="rail-label">{editing ? 'Done' : 'Customize'}</span>
                </button>
                {/* Sign-out is chrome too, and last: it must be in the same place
                    every time, which is exactly what a configurable entry cannot
                    promise. Still RBAC-gated like every other "other" task. */}
                {platform.checkTask('other', 'doLogout') && (
                    <button type="button" className="rail-item rail-chrome" id="rail-logout"
                        onClick={() => onLogout && onLogout()} {...peek('Logout')}>
                        <Icon name="logout" size={15} />
                        <span className="rail-label">Logout</span>
                    </button>
                )}
            </div>
        </div>
    );
}

/* CSS.escape isn't universal in older embedded browsers; ids here are plugin-
   supplied, so quote defensively rather than trust them in a selector. */
function cssEscape(v: any) {
    return (window.CSS && CSS.escape) ? CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&');
}
