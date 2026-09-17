import api from './api.js';
import { captureEngineSession } from './engine-fetch.js';

type Edge = { dependentId: string; dependencyId: string };
const ids = (value: any): string[] => api.asList(value, 'string').map(String);
const key = (edge: Edge): string => JSON.stringify([edge.dependentId, edge.dependencyId]);
const copyEdges = (edges: Array<{ dependentId?: string; dependencyId?: string }>): Edge[] => edges.map(d => ({ dependentId: String(d.dependentId), dependencyId: String(d.dependencyId) }));

type PendingDependencies = { libraries: { current: any }; dependencies: { current: any } };
const pending = new WeakMap<object, PendingDependencies>();

/** Related writes belong to the working channel, not a particular editor mount. */
export function channelDependencyState(channel: object): PendingDependencies {
    let state = pending.get(channel);
    if (!state) {
        state = { libraries: { current: null }, dependencies: { current: null } };
        pending.set(channel, state);
    }
    return state;
}

/** Dialog-local copy: Cancel must leave a wizard's earlier pending work intact. */
export function copyLibrarySelection(state: any) {
    return { libraries: JSON.parse(JSON.stringify(state.libraries)), checked: new Map(state.checked), initial: new Map(state.initial) };
}

export function copyDependencySelection(state: any) {
    return { all: copyEdges(state.all), initial: copyEdges(state.initial), changed: state.changed };
}

export function libraryEnabledFor(library: any, channelId: string): boolean {
    return ids(library.enabledChannelIds).includes(channelId)
        || (library.includeNewChannels === true && !ids(library.disabledChannelIds).includes(channelId));
}

export function librarySelection(libraries: any[], channelId: string) {
    const checked = new Map(libraries.map(library => [library.id, libraryEnabledFor(library, channelId)]));
    return { libraries, checked, initial: new Map(checked) };
}

export function refreshLibraryChoices(state: any, libraries: any[], channelId: string): void {
    const current = new Map(libraries.map(library => [library.id, library]));
    for (const library of libraries) {
        if (state.checked.get(library.id) === state.initial.get(library.id)) {
            const enabled = libraryEnabledFor(library, channelId);
            state.checked.set(library.id, enabled);
            state.initial.set(library.id, enabled);
        }
    }
    // Retain a removed library with a pending intent so it remains visible and
    // can be reviewed after the guarded save reports its removal.
    for (const library of state.libraries) {
        if (!current.has(library.id) && state.checked.get(library.id) !== state.initial.get(library.id)) current.set(library.id, library);
    }
    state.libraries = [...current.values()];
}

export function dependencySelection(edges: Edge[]) {
    return { all: copyEdges(edges), initial: copyEdges(edges), changed: false };
}

/** Refresh the displayed graph while retaining only explicit local edge intents.
 * Classic calls this on its dialog-local copy so Cancel cannot alter the draft. */
export function refreshDependencyChoices(state: any, edges: Edge[]): void {
    const before = new Set(state.initial.map(key));
    const after = new Set(state.all.map(key));
    const merged = new Map(copyEdges(edges).map(edge => [key(edge), edge]));
    for (const edge of state.initial) if (!after.has(key(edge))) merged.delete(key(edge));
    for (const edge of state.all) if (!before.has(key(edge))) merged.set(key(edge), { ...edge });
    state.initial = copyEdges(edges);
    state.all = [...merged.values()];
    state.changed = hasDependencyChanges(state);
}

export function hasLibraryChanges(state: any): boolean {
    return !!state && [...state.checked.keys()].some(id => state.checked.get(id) !== state.initial.get(id));
}

export function hasDependencyChanges(state: any): boolean {
    if (!state) return false;
    const before = new Set(state.initial.map(key));
    const after = new Set(state.all.map(key));
    return before.size !== after.size || [...after].some(k => !before.has(k));
}

/** Merge only this channel's membership intents into a fresh, guarded library set.
 * Swing's dependency dialog uses the same bulk endpoint, with empty removal sets.
 * Never send the libraries captured when an editor/dialog originally opened. */
export async function persistLibraryAssociations(channel: any, ref: any, version: string, confirmOverwrite?: () => Promise<boolean>): Promise<boolean> {
    const assertSession = captureEngineSession();
    assertSession();
    const state = ref?.current;
    if (!hasLibraryChanges(state)) return true;
    const intents = [...state.checked.keys()].filter(id => state.checked.get(id) !== state.initial.get(id));
    async function attempt(override: boolean): Promise<boolean> {
        const current = await api.codeTemplates.libraries(true);
        assertSession();
        const byId = new Map(current.map(library => [library.id, library]));
        for (const id of intents) {
            if (!byId.has(id)) throw new Error('A selected code template library was removed. Review the pending selections before saving.');
        }
        let needsWrite = false;
        const payload = current.map(library => {
            if (!library.id || !Number.isFinite(Number(library.revision))) throw new Error('The engine returned an invalid code template library. Save was stopped.');
            const copy = JSON.parse(JSON.stringify(library));
            if (intents.includes(library.id) && libraryEnabledFor(library, channel.id) !== state.checked.get(library.id)) {
                needsWrite = true;
                const enabled = new Set(ids(library.enabledChannelIds));
                const disabled = new Set(ids(library.disabledChannelIds));
                if (state.checked.get(library.id)) { enabled.add(channel.id); disabled.delete(channel.id); }
                else { enabled.delete(channel.id); disabled.add(channel.id); }
                copy.enabledChannelIds = enabled.size ? { string: [...enabled] } : '';
                copy.disabledChannelIds = disabled.size ? { string: [...disabled] } : '';
            }
            copy.codeTemplates = api.asList(library.codeTemplates, 'codeTemplate').map(template => ({ '@version': template['@version'] || version, id: template.id }));
            copy.codeTemplates = copy.codeTemplates.length ? { codeTemplate: copy.codeTemplates } : null;
            return { '@version': copy['@version'] || version, ...copy };
        });
        if (needsWrite) {
            const result = await api.codeTemplates.bulkUpdate(payload, [], [], [], override);
            assertSession();
            if (String(result?.overrideNeeded) === 'true') {
                if (override || !confirmOverwrite) throw new Error('Code template libraries changed while saving. Your selections are retained; retry to merge them with the current libraries.');
                const overwriteAccepted = await confirmOverwrite();
                assertSession();
                if (!overwriteAccepted) return false;
                // Match Swing's overwrite choice, rereading first to preserve unrelated
                // libraries and memberships that changed while its prompt was open.
                return attempt(true);
            }
            if (String(result?.librariesSuccess) !== 'true') throw new Error('Code template library changes were not confirmed. Your selections are retained for retry.');
        }
        // Includes a lost-response retry whose membership already matches. Checkpoint
        // only after the server confirms this stage, independently of later stages.
        state.libraries = payload;
        for (const id of intents) state.initial.set(id, state.checked.get(id));
        return true;
    }
    return attempt(false);
}

/** Use Swing's core GET/PUT contract. Refresh before merging only the user's
 * edge intents; this reduces stale overwrites but the legacy API is not atomic. */
export async function saveDependencyChanges(add: Edge[], remove: Edge[]): Promise<Edge[]> {
    const assertSession = captureEngineSession();
    assertSession();
    const current = copyEdges(await api.server.channelDependencies());
    assertSession();
    const merged = new Map(current.map(edge => [key(edge), edge]));
    for (const edge of remove) merged.delete(key(edge));
    for (const edge of add) merged.set(key(edge), edge);
    if (merged.size === current.length && current.every(edge => merged.has(key(edge)))) return current;
    await api.server.setChannelDependencies([...merged.values()]);
    assertSession();
    // The core setter returns no result and silently rejects cycles. Read back
    // before checkpointing; a failed/unknown outcome keeps the original intents
    // so retry can reconcile an accepted write without submitting it twice.
    const persisted = copyEdges(await api.server.channelDependencies());
    assertSession();
    const keys = new Set(persisted.map(key));
    if (add.some(edge => !keys.has(key(edge))) || remove.some(edge => keys.has(key(edge)))) {
        throw new Error('The engine did not persist the selected dependency changes. Check for circular dependencies or concurrent edits. Your selections are retained.');
    }
    return persisted;
}

export async function persistChannelDependencies(ref: any): Promise<void> {
    const assertSession = captureEngineSession();
    assertSession();
    const state = ref?.current;
    if (!hasDependencyChanges(state)) return;
    const before = new Set(state.initial.map(key));
    const after = new Set(state.all.map(key));
    const add = state.all.filter((edge: Edge) => !before.has(key(edge)));
    const remove = state.initial.filter((edge: Edge) => !after.has(key(edge)));
    const persisted = await saveDependencyChanges(add, remove);
    assertSession();
    state.all = copyEdges(persisted);
    state.initial = copyEdges(persisted);
    state.changed = false;
}
