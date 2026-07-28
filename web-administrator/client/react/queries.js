/*
 * Server-state layer (Workstream A) — TanStack Query hooks wrapping the
 * @oie/web-api client. Lives in the app bundle, NOT core/: core/*.js is served
 * external to plugins by URL and resolves bare specifiers through the page
 * import map, which has no '@tanstack/*' entry — so importing Query there would
 * fail at runtime. `platform.api` remains the stable plugin-facing surface;
 * these hooks are for the app's own React views.
 *
 * Convention: query keys are arrays namespaced by resource (['users'],
 * ['channel', id]); mutations invalidate the affected key(s) via useInvalidate().
 */

import { QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@oie/web-api';

// ONE shared client for the whole app. The strangler mounts each view in its own
// React root (react/mount.jsx), so every mount point must wrap with this same
// client for the cache (and invalidation) to be shared across views. staleTime
// avoids redundant refetches on quick nav; focus-refetch is off (admin tool, not
// a live dashboard — views opt into polling via refetchInterval).
export const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } }
});

/** Users list — filtered to real records (an id), matching the Users view. */
export function useUsers() {
    return useQuery({
        queryKey: ['users'],
        queryFn: async () => (await api.users.list()).filter((u) => u && u.id !== undefined)
    });
}

/** Returns an invalidator; call after a mutation to refetch the given key(s). */
export function useInvalidate() {
    const qc = useQueryClient();
    return (key) => qc.invalidateQueries({ queryKey: Array.isArray(key) ? key : [key] });
}
