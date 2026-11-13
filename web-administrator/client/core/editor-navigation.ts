/**
 * Deep-link query parameter resolution for the channel editor and its
 * filter/transformer/response sub-editors.
 */

export const BUILTIN_CHANNEL_TABS = ['Summary', 'Source', 'Destinations', 'Scripts'] as const;

const CHANNEL_SCRIPT_ALIASES: Record<string, string> = {
    deploy: 'deployScript',
    deployscript: 'deployScript',
    undeploy: 'undeployScript',
    undeployscript: 'undeployScript',
    preprocessor: 'preprocessingScript',
    preprocessingscript: 'preprocessingScript',
    postprocessor: 'postprocessingScript',
    postprocessingscript: 'postprocessingScript',
};

function normalizeId(value: unknown): string {
    return String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * Resolves the active channel-editor tab label from URL query params
 * (`?tab=`, or implied by `?script=` / `?metaDataId=`), falling back to
 * `'Summary'` on unknown or absent values.
 */
export function resolveChannelEditorTab(
    query: Record<string, string | undefined> | null | undefined,
    pluginTabs: Array<{ id?: string; label: string }> = []
): string {
    const rawTab = query?.tab;
    if (rawTab != null && String(rawTab).trim() !== '') {
        const want = normalizeId(rawTab);
        const builtin = BUILTIN_CHANNEL_TABS.find(label => normalizeId(label) === want);
        if (builtin) return builtin;
        const plugin = pluginTabs.find(tab =>
            (tab.id != null && normalizeId(tab.id) === want) || normalizeId(tab.label) === want
        );
        if (plugin) return plugin.label;
        return 'Summary';
    }
    if (query?.script != null && String(query.script).trim() !== '') return 'Scripts';
    if (query?.metaDataId != null && String(query.metaDataId).trim() !== '') {
        return String(query.metaDataId).trim() === '0' ? 'Source' : 'Destinations';
    }
    return 'Summary';
}

/**
 * Resolves a `?script=` query parameter (e.g. `'deploy'` or `'deployScript'`)
 * to a channel script property key, defaulting to `'deployScript'`.
 */
export function resolveChannelScriptKey(rawScript: unknown): string {
    const want = normalizeId(rawScript);
    return CHANNEL_SCRIPT_ALIASES[want] || 'deployScript';
}

/**
 * Resolves a `?metaDataId=` query parameter against the channel's destination
 * list, falling back to the first destination (or `null` if none).
 */
export function resolveDestinationId<T extends number | string>(
    destinations: Array<{ metaDataId?: T | null }>,
    rawMetaDataId: unknown
): T | null {
    const first = destinations[0]?.metaDataId ?? null;
    if (!destinations.length) return null;
    if (rawMetaDataId == null) return first;
    const want = String(rawMetaDataId).trim();
    if (!want) return first;
    const match = destinations.find(d => {
        if (d.metaDataId == null) return false;
        if (String(d.metaDataId) === want) return true;
        return /^\d+$/.test(want) && Number(d.metaDataId) === Number(want);
    });
    return match?.metaDataId ?? first;
}

/**
 * Parses a `?step=` query parameter (0-based index or dot-separated iterator
 * path such as `'1.0'`) into an index path, or `null` if invalid.
 */
export function parseStepPath(rawStep: unknown): number[] | null {
    if (rawStep == null) return null;
    const trimmed = String(rawStep).trim();
    if (!trimmed) return null;
    const parts = trimmed.split('.');
    if (!parts.every(part => /^\d+$/.test(part))) return null;
    return parts.map(Number);
}

function defaultElementExists(elements: any[], path: number[]): boolean {
    let list: any[] | undefined = elements;
    for (let i = 0; i < path.length; i++) {
        if (!Array.isArray(list)) return false;
        const el: any = list[path[i]];
        if (!el) return false;
        if (i < path.length - 1) list = el.__children;
    }
    return true;
}

/**
 * Resolves a `?step=` query parameter against a hydrated element tree,
 * falling back to `[0]` when absent/invalid/out-of-bounds, or `null` when
 * the element list is empty.
 */
export function resolveStepPath(
    elements: any[],
    rawStep: unknown,
    exists?: (elements: any[], path: number[]) => boolean
): number[] | null {
    if (!elements || !elements.length) return null;
    const path = parseStepPath(rawStep);
    if (!path) return [0];
    const valid = exists ? exists(elements, path) : defaultElementExists(elements, path);
    return valid ? path : [0];
}
