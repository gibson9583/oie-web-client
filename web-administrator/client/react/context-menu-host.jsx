/*
 * Radix-backed renderer for core/ui.js's contextMenu(), registered the same way
 * as the dialog and toast ones (see dialog-host.jsx for why core/ui.js cannot
 * import React). All ~28 call sites — row menus, column menus, the nav rail's
 * customize menu, plugin menus — keep calling contextMenu(x, y, items) and get a
 * Radix menu without changing.
 *
 * A context menu opens at a POINT, not off a button, so the trigger here is a
 * zero-size element parked at the pointer. Radix then does the placement,
 * collision flipping, roving focus, type-ahead, Escape and outside-dismiss that
 * this module used to carry by hand.
 *
 * Kept from the DOM version: the class names (.ctx-surface, .ctx-item, .ctx-sep,
 * .ctx-head*), the item shape ({label, icon, onClick, danger, disabled, header,
 * sub} and '-' for a separator), and focus returning to whatever opened the menu.
 */

import { useSyncExternalStore } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { icon } from '@oie/web-ui';

let current = null;      // at most one context menu is ever open
let seq = 0;
const listeners = new Set();
const emit = () => listeners.forEach((f) => f());
const subscribe = (f) => { listeners.add(f); return () => listeners.delete(f); };
const snapshot = () => current;

/** contextMenu()'s renderer. Returns the handle core/ui.js closes it with. */
export function openRadixContextMenu({ x, y, items }) {
    const id = ++seq;
    // Where focus goes on dismiss (the row, the task button) — captured before
    // the menu mounts, because Radix would otherwise restore to its own trigger.
    const opener = document.activeElement;
    let closed = false;
    const close = ({ restore = true } = {}) => {
        if (closed) return;
        closed = true;
        if (current && current.id === id) { current = null; emit(); }
        if (restore && opener && opener.isConnected && opener.focus) opener.focus();
    };
    current = { id, x, y, items, close };
    emit();
    return { close };
}

/* core/ui.js's icon() returns a DOM node, so it mounts by ref. */
function IconSlot({ name }) {
    return <span ref={(el) => { if (el && !el.firstChild) el.appendChild(icon(name)); }} />;
}

function Menu({ entry }) {
    const { x, y, items, close } = entry;

    return (
        <DropdownMenu.Root
            open
            /* Not modal: the old menu let a click outside land on whatever it hit
               instead of being swallowed, and did not lock scrolling. */
            modal={false}
            onOpenChange={(open) => { if (!open) close(); }}>
            <DropdownMenu.Trigger asChild>
                <span aria-hidden="true"
                    style={{ position: 'fixed', left: x, top: y, width: 0, height: 0 }} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
                <DropdownMenu.Content className="ctx-surface"
                    side="bottom" align="start" sideOffset={0} collisionPadding={8}
                    onCloseAutoFocus={(e) => {
                        // close() already put focus back on the opener; letting
                        // Radix run would drop it on the zero-size trigger.
                        e.preventDefault();
                    }}>
                    {items.map((item, i) => {
                        if (item === '-') return <DropdownMenu.Separator key={i} className="ctx-sep" />;
                        if (item.header) {
                            return (
                                <DropdownMenu.Label key={i} className="ctx-head">
                                    <div className="ctx-head-name">{item.label}</div>
                                    {item.sub ? <div className="ctx-head-sub">{item.sub}</div> : null}
                                </DropdownMenu.Label>
                            );
                        }
                        return (
                            <DropdownMenu.Item key={i}
                                className={'ctx-item' + (item.danger ? ' danger' : '')}
                                disabled={item.disabled}
                                /* Given, not derived: Radix otherwise reads an item's
                                   type-ahead text out of the DOM in an effect, which
                                   races the first keypress after the menu opens. */
                                textValue={String(item.label)}
                                onSelect={() => { close({ restore: false }); item.onClick && item.onClick(); }}>
                                {item.icon ? <IconSlot name={item.icon} /> : null}
                                {item.label}
                            </DropdownMenu.Item>
                        );
                    })}
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
}

/** Mounted once by the app root; renders the open context menu, if any. */
export function ContextMenuHost() {
    const entry = useSyncExternalStore(subscribe, snapshot, snapshot);
    return entry ? <Menu key={entry.id} entry={entry} /> : null;
}
