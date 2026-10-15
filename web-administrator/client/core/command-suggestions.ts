import { asList } from './api.js';
import { libraryEnabledFor } from './channel-dependencies.js';
import { CODE_TEMPLATE_TASKS, EDIT_CHANNEL_TASKS } from './route-tasks.js';
import type { RouteTasks } from './route-tasks.js';

export type PaletteContext = {
    kind: 'channel';
    surface: 'messages' | 'editor' | 'connector' | 'dashboard' | 'channels';
    channelIds: string[];
    channels?: any[];
    librarySelection?: Map<string, boolean>;
} | {
    kind: 'templates';
    libraries: any[];
    selected: { kind: 'library' | 'template'; id: string } | null;
} | null;

type PermissionCheck = (group: string, task: string) => boolean;
export interface PaletteEntry {
    kind: string;
    id: string;
    label: string;
    group: string;
    hint: string;
    path: string;
    icon?: string;
    state?: string;
    permissions: RouteTasks;
}

const validId = (id: any): id is string => typeof id === 'string' && !!id.trim();
const label = (name: any, id: string): string => name != null && ['string', 'number', 'boolean'].includes(typeof name)
    ? String(name) || id : id;
const templatesOf = (library: any): any[] => asList(library?.codeTemplates, 'codeTemplate').filter(t => t && validId(t.id));

export function entryAllowed(entry: { permissions?: RouteTasks }, can: PermissionCheck): boolean {
    return !entry.permissions || entry.permissions.every(([group, task]) => can(group, task));
}

const TEMPLATE_PALETTE_TASKS: RouteTasks = [...CODE_TEMPLATE_TASKS, ['codeTemplate', 'doRefreshCodeTemplates']];

/** Fetching palette libraries is useful only when their destination is allowed. */
export function canBrowseTemplates(can: PermissionCheck): boolean {
    return TEMPLATE_PALETTE_TASKS.every(([group, task]) => can(group, task));
}

/** The same entries back search, suggestions and recents, with stable IDs. */
export function channelPaletteEntries(channels: any[], can: PermissionCheck): PaletteEntry[] {
    const seen = new Set<string>();
    return channels.filter(c => {
        if (!c || !validId(c.id) || seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
    }).flatMap(c => {
        const base = { kind: 'channel', label: label(c.name, c.id), group: 'Channels', state: c.state };
        const id = encodeURIComponent(c.id);
        return [
            { ...base, id: 'chan:' + c.id, hint: 'edit', path: `/channels/${id}/edit`, permissions: EDIT_CHANNEL_TASKS },
            { ...base, id: 'chanmsg:' + c.id, hint: 'messages', path: `/messages/${id}`, permissions: [['view', 'doShowMessages']] }
        ] as PaletteEntry[];
    }).filter(e => entryAllowed(e, can));
}

export function templatePaletteEntries(libraries: any[], can: PermissionCheck): PaletteEntry[] {
    if (!canBrowseTemplates(can)) return [];
    const entries: PaletteEntry[] = [];
    for (const library of libraries) {
        if (!library || !validId(library.id)) continue;
        const libraryName = label(library.name, library.id);
        const path = '/code-templates?libraryId=' + encodeURIComponent(library.id);
        const base = { kind: 'template', group: 'Code Templates', permissions: TEMPLATE_PALETTE_TASKS };
        entries.push({ ...base, id: 'library:' + library.id, label: libraryName, hint: 'code template library', icon: 'folder', path });
        for (const template of templatesOf(library)) {
            entries.push({ ...base, id: 'template:' + template.id, label: label(template.name, template.id),
                hint: libraryName, icon: 'code', path: path + '&templateId=' + encodeURIComponent(template.id) });
        }
    }
    const seen = new Set<string>();
    return entries.filter(e => {
        if (seen.has(e.id) || !entryAllowed(e, can)) return false;
        seen.add(e.id);
        return true;
    });
}

/** Suggest navigation only: never run mutations merely because content is selected. */
export function contextSuggestions(context: PaletteContext, channels: any[], libraries: any[], can: PermissionCheck): PaletteEntry[] {
    if (!context) return [];
    const channelEntries = channelPaletteEntries(channels, can);
    let entries: PaletteEntry[] = [];
    if (context.kind === 'channel') {
        const ids = new Set(context.channelIds.filter(validId));
        // From an editor offer messages; from messages offer the editor. A list
        // or connector editor can use both. Never reload the current content.
        const destinations = new Set([...ids].flatMap(id => [
            ...(context.surface !== 'editor' ? ['chan:' + id] : []),
            ...(context.surface !== 'messages' ? ['chanmsg:' + id] : [])
        ]));
        entries = channelEntries.filter(e => destinations.has(e.id));
        const messagePermission: [string, string] | null = context.surface === 'channels'
            ? ['channel', 'doViewMessages'] : context.surface === 'dashboard' ? ['dashboard', 'doShowMessages'] : null;
        if (messagePermission) entries = entries.map(e => e.id.startsWith('chanmsg:')
            ? { ...e, permissions: [...e.permissions, messagePermission] } : e).filter(e => entryAllowed(e, can));
        const related = libraries.filter(library => library && [...ids].some(id =>
            context.librarySelection?.has(library.id)
                ? context.librarySelection.get(library.id)
                : libraryEnabledFor(library, id)));
        entries.push(...templatePaletteEntries(related, can));
    } else if (context.selected) {
        const selected = context.selected;
        const library = context.libraries.find(l => l && (selected.kind === 'library'
            ? l.id === selected.id : templatesOf(l).some(t => t.id === selected.id)));
        if (library) {
            const destinations = new Set(channels.filter(c => c && validId(c.id) && libraryEnabledFor(library, c.id))
                .flatMap(c => ['chan:' + c.id, 'chanmsg:' + c.id]));
            entries = channelEntries.filter(e => destinations.has(e.id));
        }
    }
    return entries.map(e => ({ ...e, group: 'Suggested' }));
}
