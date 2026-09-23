type Model = Record<string, any>;

function list(value: any, key: string): any[] {
    const items = Array.isArray(value) ? value : value?.[key];
    return items == null || items === '' ? [] : Array.isArray(items) ? items : [items];
}

/** Swing consolidates channel exports before presenting the library import dialog.
 * Its Set.add returns whether an ID was new; JavaScript's Set.add does not. */
export function consolidateBundledLibraries(bundles: { libraries: Model[]; channelId: string }[]): Model[] {
    const libraries = new Map<string, Model>();
    const seenTemplates = new Set<string>();
    for (const { libraries: imported, channelId } of bundles) {
        for (const source of imported) {
            if (!source?.id) continue;
            const previous = libraries.get(source.id);
            const library = previous || { ...structuredClone(source), codeTemplates: null };
            const templates = list(library.codeTemplates, 'codeTemplate');
            for (const template of list(source.codeTemplates, 'codeTemplate')) {
                if (!template?.id || seenTemplates.has(template.id)) continue;
                seenTemplates.add(template.id);
                templates.push(structuredClone(template));
            }
            library.codeTemplates = templates.length ? { codeTemplate: templates } : null;
            const enabled = new Set([...list(library.enabledChannelIds, 'string'), ...list(source.enabledChannelIds, 'string'), channelId].filter(Boolean).map(String));
            const disabled = new Set([...list(library.disabledChannelIds, 'string'), ...list(source.disabledChannelIds, 'string')].map(String));
            for (const id of enabled) disabled.delete(id);
            library.enabledChannelIds = enabled.size ? { string: [...enabled] } : '';
            library.disabledChannelIds = disabled.size ? { string: [...disabled] } : '';
            libraries.set(source.id, library);
        }
    }
    return [...libraries.values()];
}

export interface GroupImportCallbacks {
    overwrite(name: string): Promise<boolean>;
    rename(name: string): Promise<string | null>;
    newId(): string;
}

/** Group names are case-sensitive in Swing (unlike channel names). */
export async function resolveGroupImport(current: Model[], imported: Model, callbacks: GroupImportCallbacks): Promise<{ group: Model; replacedId?: string } | null> {
    const group = structuredClone(imported);
    const freshId = () => {
        for (let attempt = 0; attempt < 100; attempt++) {
            const id = callbacks.newId();
            if (id && id !== 'Default Group' && !current.some(candidate => candidate.id === id)) return id;
        }
        throw new Error('Could not allocate an unused channel group ID.');
    };
    const match = current.find(candidate => candidate.name === group.name);
    if (match) {
        if (await callbacks.overwrite(group.name)) {
            // Keep the imported identity, like ChannelPanel, replacing the named
            // group. A second unrelated ID collision needs a new identity.
            if (current.some(candidate => candidate.id === group.id && candidate.id !== match.id)) group.id = freshId();
            group.revision = group.id === match.id ? match.revision : 0;
            return { group, replacedId: match.id };
        }
        let name = group.name;
        do {
            name = await callbacks.rename(name);
            if (name == null) return null;
        } while (!name.trim() || name === '[Default Group]' || current.some(candidate => candidate.name === name));
        group.name = name;
        group.id = freshId();
    } else if (!group.id || current.some(candidate => candidate.id === group.id)) {
        group.id = freshId();
    }
    group.revision = 0;
    return { group };
}

/** Apply already-reviewed imports to exactly the group collection that was read.
 * Requiring matching revisions prevents a later read from silently approving an
 * intervening change to a group the user chose to overwrite. */
export function applyGroupImports(current: Model[], baseline: Model[], imports: { group: Model; replacedId?: string }[]): { groups: Model[]; removedIds: string[] } {
    if (current.length !== baseline.length || baseline.some(group => {
        const latest = current.find(candidate => candidate.id === group.id);
        return !latest || latest.revision !== group.revision || JSON.stringify(latest) !== JSON.stringify(group);
    })) throw new Error('Channel groups changed during import. Import again to review the latest groups. Channels already imported have been kept.');
    let groups = structuredClone(current);
    const removedIds = new Set<string>();
    for (const { group, replacedId } of imports) {
        if (replacedId && replacedId !== group.id) removedIds.add(replacedId);
        const members = new Set(list(group.channels, 'channel').map(channel => channel.id));
        groups = groups.filter(candidate => candidate.id !== group.id && candidate.id !== replacedId).map(candidate => {
            const channels = list(candidate.channels, 'channel').filter(channel => !members.has(channel.id));
            return { ...candidate, channels: channels.length ? { channel: channels } : null };
        });
        groups.push(structuredClone(group));
    }
    for (const group of groups) removedIds.delete(group.id);
    return { groups, removedIds: [...removedIds] };
}

export function bundledLibrarySaveError(result: any): string {
    if (String(result?.overrideNeeded) === 'true') return 'Libraries or code templates changed during import. Import again to review the latest server versions.';
    if (String(result?.librariesSuccess) !== 'true') return result?.librariesCause?.detailMessage || 'The library set could not be saved';
    const scan = (value: any): string => {
        if (!value || typeof value !== 'object') return '';
        if (String(value.success) === 'false') return value.cause?.detailMessage || 'A code template could not be saved';
        return Object.values(value).map(scan).find(Boolean) || '';
    };
    return scan(result.codeTemplateResults);
}
