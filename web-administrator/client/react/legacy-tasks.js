/*
 * Legacy taskbar relocation (ported verbatim from app.js). During the React
 * migration, not-yet-ported views still return DOM and emit `.taskbar` nodes;
 * the shell physically MOVES those into contextual rail panes on every route
 * change — exactly as the vanilla shell did. React views will instead use a
 * TasksPortal (added in a later phase); both paths coexist meanwhile.
 *
 * paneCollapsed is shared with the React <RailPane> so collapse state is
 * consistent across nav panes (React) and task panes (DOM).
 */

import { h, clear } from '@oie/web-ui';

export const paneCollapsed = new Map();

// DOM collapsible pane — used only for relocated (DOM) taskbars. Nav panes use
// the React <RailPane>; both read/write the same paneCollapsed Map.
export function domRailPane(title, body, key) {
    const k = key || title;
    const pane = h('div.rail-pane', { class: paneCollapsed.get(k) ? 'collapsed' : null },
        h('div.rail-pane-header', {
            onClick: () => {
                pane.classList.toggle('collapsed');
                paneCollapsed.set(k, pane.classList.contains('collapsed'));
            }
        }, h('span.pane-title', title), h('span.pane-chevron', '▲')),
        h('div.rail-pane-body', body));
    return pane;
}

export function relocateTaskbars(outlet, tasksHost, viewTitle) {
    if (!outlet || !tasksHost) return;
    clear(tasksHost);
    const view = outlet.querySelector(':scope > .view');
    if (!view) return;
    const taskbars = [...view.children].filter(el => el.classList.contains('taskbar'));
    taskbars.forEach((taskbar) => {
        const title = taskbar.dataset.paneTitle || `${viewTitle || 'View'} Tasks`;
        // Selection-dependent groups that declare their own pane title break out
        // into separate panes that show/hide with the selection.
        const ctxGroups = [...taskbar.querySelectorAll(':scope > .ctx-tasks')]
            .filter(ctx => ctx.dataset.paneTitle);
        tasksHost.appendChild(domRailPane(title, taskbar, `tasks:${title}`));
        for (const ctx of ctxGroups) {
            const pane = domRailPane(ctx.dataset.paneTitle,
                h('div.taskbar', ctx), `tasks:${ctx.dataset.paneTitle}`);
            pane.classList.add('ctx-pane');
            tasksHost.appendChild(pane);
        }
    });
}
