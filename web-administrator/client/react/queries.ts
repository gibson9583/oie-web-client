/*
 * Server-state layer — TanStack Query hooks wrapping the
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
import { getPref, DASHBOARD_REFRESH_SECONDS } from '../core/prefs.js';

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
        queryFn: async () => (await api.users.list()).filter((u: any) => u && u.id !== undefined)
    });
}

/**
 * Alerts list — auto-polls on the dashboard's refresh interval while mounted
 * (Swing parity: the alerts panel refreshes like the dashboard). refetchInterval
 * replaces the view's hand-rolled setTimeout loop; background poll failures are
 * silent (Query keeps the last data), matching the old "quiet background" rule.
 */
export function useAlerts() {
    return useQuery({
        queryKey: ['alerts'],
        queryFn: async () => (await api.alerts.list()).filter((a: any) => a && a.id),
        refetchInterval: () => Math.max(1, Number(getPref('dashboardRefreshSeconds')) || DASHBOARD_REFRESH_SECONDS) * 1000
    });
}

/** The dashboard auto-refresh interval preference, in ms (min clamp per caller). */
const dashIntervalMs = (min = 1) => Math.max(min, Number(getPref('dashboardRefreshSeconds')) || DASHBOARD_REFRESH_SECONDS) * 1000;

/** Deployed channel statuses (the card/dashboard grid). Polls on the dashboard
 *  interval while `live`; pass live=false to pause. Undeployed channels excluded. */
export function useDeployedStatuses(live = true) {
    return useQuery({
        queryKey: ['statuses', 'deployed'],
        queryFn: async () => (await api.status.list(undefined, undefined, false)).filter((s: any) => s.state !== 'UNDEPLOYED'),
        refetchInterval: () => (live ? dashIntervalMs(2) : false)
    });
}

/** Full dashboard statuses (all deployed channels, connector children included).
 *  Polls on the dashboard interval. Errors keep the last data (background polls
 *  self-heal on the next tick, matching the classic silent-poll behavior). */
export function useDashboardStatuses() {
    return useQuery({
        queryKey: ['statuses', 'dashboard'],
        queryFn: () => api.status.list(),
        refetchInterval: () => dashIntervalMs(1)
    });
}

/** Channel groups. Pass { poll: true } to refresh on the dashboard interval
 *  (the status board keeps grouping current); default is load-once. */
export function useChannelGroups({ poll = false }: any = {}) {
    return useQuery({
        queryKey: ['channelGroups'],
        queryFn: () => api.channelGroups.list(),
        refetchInterval: poll ? () => dashIntervalMs(1) : undefined
    });
}

/** Channel tags. Pass { poll: true } to refresh on the dashboard interval. */
export function useChannelTags({ poll = false }: any = {}) {
    return useQuery({
        queryKey: ['channelTags'],
        queryFn: () => api.server.channelTags(),
        refetchInterval: poll ? () => dashIntervalMs(1) : undefined
    });
}

/** channelId → Map(metaDataId → transportName), for the dashboard's Type column.
 *  Channel definitions change rarely: ~60s cadence, keep-last on failure. */
export function useConnectorTypes() {
    return useQuery({
        queryKey: ['connectorTypes'],
        queryFn: async () => {
            const channels = await api.channels.list();
            const map = new Map();
            for (const ch of channels) {
                if (!ch || !ch.id) continue;
                const types = new Map();
                if (ch.sourceConnector?.transportName) types.set(0, ch.sourceConnector.transportName);
                for (const dest of api.asList(ch.destinationConnectors, 'connector')) {
                    if (dest?.transportName && dest.metaDataId !== undefined) types.set(Number(dest.metaDataId), dest.transportName);
                }
                map.set(ch.id, types);
            }
            return map;
        },
        refetchInterval: 60_000,
        staleTime: 60_000
    });
}

/** channelId → source listener port string, for the dashboard's Port column. */
export function useSourcePorts() {
    return useQuery({
        queryKey: ['sourcePorts'],
        queryFn: async () => {
            const ports = await api.channels.portsInUse();
            const map = new Map();
            for (let row of ports) {
                if (row && row.ports) row = row.ports;   // singleton lists stay wrapped
                if (row && row.id && row.port) map.set(row.id, String(row.port));
            }
            return map;
        },
        refetchInterval: 60_000,
        staleTime: 60_000
    });
}

/** Returns an invalidator; call after a mutation to refetch the given key(s). */
export function useInvalidate() {
    const qc = useQueryClient();
    return (key: any) => qc.invalidateQueries({ queryKey: Array.isArray(key) ? key : [key] });
}
