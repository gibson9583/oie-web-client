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
 *
 * The two flushSync calls below are the only ones in the client, and both are
 * load-bearing contracts rather than migration leftovers — don't fold either into
 * a plain root.render(). Caveat: React 19 DEFERS a flushSync render issued while
 * it is already processing effects, so mountReact called from inside an effect
 * does NOT render synchronously; islands that depend on the settled DOM in that
 * case must guard for it in-tree (see StepEditorPanel in filter-transformer.jsx).
 */

import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './queries.js';
import { ErrorBoundary } from './error-boundary.jsx';

// The rail element React views portal their task panes into. Set by the shell
// on mount, read when each view mounts.
let reactTasksHostEl: any = null;
export function setReactTasksHost(el: any) { reactTasksHostEl = el; }

const TasksHostContext = createContext(null);

// Wrap a React component as a core/router.js view handler. The boundary is inside
// the providers so the fallback keeps the Query client (its Retry remounts the
// view, which will refetch), and outside <Component> so a throw during the view's
// own first render is caught rather than escaping to an empty outlet.
export function reactView(Component: any) {
    return ({ params, query }: any) => {
        const el = document.createElement('div');
        el.style.display = 'contents';   // transparent wrapper: the view's .view is the flex child
        const root = createRoot(el);
        flushSync(() => root.render(
            <QueryClientProvider client={queryClient}>
                <TasksHostContext.Provider value={reactTasksHostEl}>
                    <ErrorBoundary label="This view failed to render">
                        <Component params={params} query={query} />
                    </ErrorBoundary>
                </TasksHostContext.Provider>
            </QueryClientProvider>
        ));
        return { el, teardown: () => root.unmount() };
    };
}

// Mount a React element into an existing (imperatively built) host element and
// return a teardown. Used by the heavy imperative DOM islands (channel-editor
// connector/properties panels, filter-transformer step/rule editors, settings
// plugin tabs, message attachment viewers) to host a plugin's React component.
// flushSync makes the first render synchronous so the DOM exists before the
// caller measures/returns. Call the returned teardown when rebuilding/clearing
// the host so the React root doesn't leak.
// `label` names the island in the fallback and in the console line — pass the
// panel/tab it hosts when the caller knows it, since these roots are usually
// plugin code and the report is what identifies whose.
export function mountReact(hostEl: any, element: any, { label = 'This panel failed to render' }: any = {}) {
    const root = createRoot(hostEl);
    flushSync(() => root.render(
        <QueryClientProvider client={queryClient}>
            <ErrorBoundary label={label} compact>{element}</ErrorBoundary>
        </QueryClientProvider>
    ));
    return () => root.unmount();
}

// Render task panes into the rail. Children should be <RailPane> nodes (one per
// task group), matching the classic stacked task-pane look.
export function ViewTasks({ children }: any) {
    const host = useContext(TasksHostContext);
    if (!host) return null;
    return createPortal(children, host);
}
