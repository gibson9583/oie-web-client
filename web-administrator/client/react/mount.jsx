/*
 * React-view mounting bridge. Lets platform.registerView host a React component
 * inside the EXISTING core/router.js outlet during the migration: the handler
 * returns { el, teardown } like any vanilla view, but el is driven by a React
 * root. flushSync forces a synchronous first render so the view's DOM exists
 * before core/router.js fires route:changed (the shell reads it immediately).
 *
 * Task panes: React views render their task panes through <ViewTasks>, which
 * portals into the shell's React-tasks rail container (separate from the legacy
 * relocateTaskbars container, so the two task mechanisms never fight).
 */

import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { createContext, useContext } from 'react';
import { createPortal } from 'react-dom';

// The rail element React views portal their task panes into. Set by the shell
// on mount, read when each view mounts.
let reactTasksHostEl = null;
export function setReactTasksHost(el) { reactTasksHostEl = el; }

const TasksHostContext = createContext(null);

// Wrap a React component as a core/router.js view handler.
export function reactView(Component) {
    return ({ params, query }) => {
        const el = document.createElement('div');
        el.style.display = 'contents';   // transparent wrapper: the view's .view is the flex child
        const root = createRoot(el);
        flushSync(() => root.render(
            <TasksHostContext.Provider value={reactTasksHostEl}>
                <Component params={params} query={query} />
            </TasksHostContext.Provider>
        ));
        return { el, teardown: () => root.unmount() };
    };
}

// Render task panes into the rail. Children should be <RailPane> nodes (one per
// task group), matching the classic stacked task-pane look.
export function ViewTasks({ children }) {
    const host = useContext(TasksHostContext);
    if (!host) return null;
    return createPortal(children, host);
}
