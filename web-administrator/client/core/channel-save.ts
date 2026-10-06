import api from './api.js';
import { encodeChannelTemplates } from './oie.js';
import { captureEngineSession } from './engine-fetch.js';
import { normalizeChannelDataTypeArrays } from './datatype-arrays.js';
import type { ChannelTag } from './wire-types.js';

type EditState = { isNew: boolean; baseline: string | null; workingBaseline: string | null; saving: boolean; creationAttempts?: any[] };
const sessions = new WeakMap<object, EditState>();
const clone = (value: any): any => JSON.parse(JSON.stringify(value));

/** Repair File settings left by older web clients without changing intentional
 * anonymous credentials (including a custom password with a blank username). */
function repairFileCredentials(channel: any): boolean {
    const destinations = channel?.destinationConnectors?.connector;
    const connectors = [channel?.sourceConnector,
        ...(Array.isArray(destinations) ? destinations : destinations ? [destinations] : [])];
    let changed = false;
    for (const connector of connectors) {
        const p = connector?.properties;
        const fileConnector = connector?.transportName === 'File Reader' || connector?.transportName === 'File Writer'
            || p?.['@class'] === 'com.mirth.connect.connectors.file.FileReceiverProperties'
            || p?.['@class'] === 'com.mirth.connect.connectors.file.FileDispatcherProperties';
        if (!fileConnector || !p) continue;
        const anonymous = p.anonymous === true || p.anonymous === 'true';
        if ((p.scheme === 'SFTP' || p.scheme === 'SMB') && anonymous) {
            p.anonymous = false;
            changed = true;
        } else if ((p.scheme === 'FTP' || p.scheme === 'WEBDAV') && anonymous
            && String(p.username ?? '').trim() === '' && String(p.password ?? '').trim() === '') {
            p.username = 'anonymous';
            p.password = 'anonymous';
            changed = true;
        }
    }
    return changed;
}

/** Send the engine's exact name for every tag it already knows by id. */
export async function restoreChannelTagNames(channel: any, originalTagIds?: Set<string>): Promise<void> {
    const tags = api.asList(channel?.exportData?.channelTags, 'channelTag');
    if (!tags.length) return;
    const assertSession = captureEngineSession();
    let known: ChannelTag[];
    try { known = await api.server.channelTags(); }
    catch {
        assertSession();
        // Channel View also exposes assigned tags; Tags View is not required.
        // Newly entered strings are already exact and are not in the saved export.
        const assigned = tags.filter(tag => !originalTagIds || originalTagIds.has(String(tag?.id))
            || typeof tag?.name !== 'string');
        known = assigned.length ? await api.channels.tags(channel.id) : [];
        if (assigned.some(tag => !known.some(existing => String(existing.id) === String(tag?.id)))) {
            throw new Error('Cannot verify channel tag names. Retry before saving.');
        }
    }
    assertSession();
    const names = new Map(known.map(tag => [String(tag.id), tag.name]));
    for (const tag of tags) {
        const name = names.get(String(tag?.id)) ?? tag?.name;
        if (typeof name !== 'string') throw new Error('Cannot verify channel tag names. Retry before saving.');
        tag.name = name;
    }
}

// External library/graph exports are not written by a channel save. Keep them
// out of its baseline; resources, tags and all channel metadata remain included.
function fingerprint(channel: any): string {
    const value = clone(channel);
    if (value.exportData) {
        delete value.exportData.codeTemplateLibraries;
        delete value.exportData.channelDependencies;
        delete value.exportData.dependencyIds;
        delete value.exportData.dependentIds;
    }
    return JSON.stringify(value, (_key, node) => node && typeof node === 'object' && !Array.isArray(node)
        ? Object.fromEntries(Object.keys(node).sort().map(key => [key, node[key]])) : node);
}

export async function loadChannelForEdit(id: string): Promise<any> {
    const channel = await api.channels.get(id);
    if (!channel || channel.id !== id) throw new Error(`Channel ${id} was not found.`);
    const baseline = fingerprint(channel);
    await restoreChannelTagNames(channel);
    sessions.set(channel, { isNew: false, baseline, workingBaseline: fingerprint(channel), saving: false });
    return channel;
}

/** Identity follows the working model through classic, wizard and subeditors.
 * Only a new draft may initialize without an authoritative read. */
export function channelEditState(channel: any, isNew = false): EditState {
    let state = sessions.get(channel);
    if (!state) {
        state = { isNew, baseline: null, workingBaseline: null, saving: false };
        sessions.set(channel, state);
    }
    return state;
}

function modifiedTime(channel: any): number {
    const modified = channel?.exportData?.metadata?.lastModified;
    return modified == null ? NaN : Number(modified.time ?? modified);
}

function savedByUser(channel: any, userId?: string | number): boolean {
    const saver = channel?.exportData?.metadata?.userId;
    return userId != null && saver != null && String(userId) === String(saver);
}

/** Swing's conflict choice is shared by imports and editor saves. Retry only
 * the channel write, using the latest saver rather than a cached channel list. */
export async function updateChannelWithConflict(channelId: string, update: (override: boolean) => Promise<unknown>, options: {
    userId?: string | number;
    confirmConflict: () => Promise<boolean>;
    assertSession: () => void;
}): Promise<boolean> {
    const { assertSession } = options;
    assertSession();
    let accepted = await update(false);
    assertSession();
    if (String(accepted) === 'false') {
        const latest = await api.channels.get(channelId);
        assertSession();
        if (!latest || latest.id !== channelId) throw new Error('The channel was removed. Reopen the channel list before saving.');
        if (!savedByUser(latest, options.userId)) {
            const confirmed = await options.confirmConflict();
            assertSession();
            if (!confirmed) return false;
        }
        accepted = await update(true);
        assertSession();
    }
    if (String(accepted) !== 'true') throw new Error('The engine did not confirm the channel save. Your changes are still unsaved.');
    return true;
}

function channelContent(channel: any): string {
    // Compare templates in their wire form too: decoded template text must
    // not acquire the scalar coercion applied to ordinary XML element text.
    const content = encodeChannelTemplates(clone(channel));
    delete content.exportData;
    delete content.revision;
    delete content.lastModified;
    // Compare the XML represented by the engine's JSON bridge: arrays repeat
    // child elements, so [] emits no child and an empty wrapper returns null.
    // AutoPrimitiveTarget also converts exact JSON primitive text; attributes
    // are exempt. Preserve other text, null children and element order.
    const wireElements = (value: any): any => {
        if (value === '') return null;
        if (typeof value === 'string') {
            // XML normalizes ordinary text line endings; encoded templates
            // above and attributes below retain their original characters.
            value = value.replace(/\r\n?/g, '\n');
            const primitive = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)$/.exec(value);
            // Require the whole value: JS's $ can match before a final newline.
            if (primitive?.[0] === value) {
                const parsed = JSON.parse(value);
                // JSON cloning loses non-finite numbers as null. They cannot
                // provide reliable evidence that the submitted text matches.
                if (typeof parsed !== 'number' || Number.isFinite(parsed)) return parsed;
            }
        }
        if (Array.isArray(value)) return value.length === 1
            ? wireElements(value[0]) : value.map(wireElements);
        if (value && typeof value === 'object') {
            const entries = Object.entries(value)
                .filter(([key, node]) => key.startsWith('@') || !Array.isArray(node) || node.length > 0)
                .map(([key, node]) => [key, key.startsWith('@') ? node : wireElements(node)]);
            return entries.length ? Object.fromEntries(entries) : null;
        }
        return value;
    };
    const normalized = wireElements(content);
    // AttachmentHandlerProperties.properties defaults to Java HashMap. Its
    // entry order is not retained by persistence (unlike an explicit ordered
    // map or the channel's connector/rule lists).
    const attachmentMap = normalized.properties?.attachmentProperties?.properties;
    if (attachmentMap && (!attachmentMap['@class'] || attachmentMap['@class'] === 'hash-map')
        && Array.isArray(attachmentMap.entry)) {
        attachmentMap.entry.sort((left: any, right: any) => {
            const a = fingerprint(left), b = fingerprint(right);
            return a < b ? -1 : a > b ? 1 : 0;
        });
    }
    return fingerprint(normalized);
}

/** Shared legacy-engine contract. The preflight catches revision/metadata changes
 * inside the engine's second-resolution timestamp window. Conflict choices
 * follow Swing: same-user replacement proceeds; other users require confirmation.
 * The remaining read-to-write race is documented, not an atomic CAS. */
export async function saveChannelModel(channel: any, options: {
    userId?: string | number;
    confirmConflict: () => Promise<boolean>;
    confirmCreationRetry?: () => Promise<boolean>;
    skipUnchanged?: boolean;
}): Promise<boolean> {
    const assertSession = captureEngineSession();
    assertSession();
    const confirm = async (answer: Promise<boolean>) => {
        const accepted = await answer;
        assertSession();
        return accepted;
    };
    const state = channelEditState(channel);
    if (state.saving) return false;
    state.saving = true;
    try {
        let current: any = null;
        if (state.isNew && state.creationAttempts?.length) {
            try { current = await api.channels.get(channel.id); }
            catch (e: any) { if (e.status !== 404) throw e; }
            assertSession();
            if (current) {
                const attempt = state.creationAttempts.find(candidate => current.id === channel.id
                    && modifiedTime(current) === modifiedTime(candidate) && channelContent(current) === channelContent(candidate));
                if (!attempt) throw new Error('A channel with this ID exists, but the interrupted creation could not be verified. Open it from Channels before saving again.');
                // The lost response belonged to our UUID and submitted model.
                // Keep any edits made since then, but never POST another create.
                state.isNew = false;
                state.baseline = fingerprint(current);
                const acknowledged = clone(attempt);
                acknowledged.revision = current.revision;
                state.workingBaseline = fingerprint(acknowledged);
                channel.revision = current.revision;
                const metadata = (channel.exportData = channel.exportData || {}).metadata || {};
                channel.exportData.metadata = { ...attempt.exportData.metadata, ...metadata,
                    lastModified: attempt.exportData.metadata.lastModified, userId: attempt.exportData.metadata.userId };
                state.creationAttempts = undefined;
            } else if (!options.confirmCreationRetry || !await confirm(options.confirmCreationRetry())) return false;
        }
        let conflict = false;
        if (!state.isNew) {
            if (!state.baseline) throw new Error('Cannot verify the original channel. Reopen it before saving.');
            current = current || await api.channels.get(channel.id);
            assertSession();
            if (!current || current.id !== channel.id) throw new Error('The channel was removed. Reopen the channel list before saving.');
            conflict = fingerprint(current) !== state.baseline;
            if (conflict && !savedByUser(current, options.userId) && !await confirm(options.confirmConflict())) return false;
        }
        const submitted = clone(channel);
        const workingAtSubmit = fingerprint(channel);
        const credentialRepair = repairFileCredentials(submitted);
        const normalizedAtSubmit = credentialRepair ? fingerprint(submitted) : workingAtSubmit;
        if (!state.isNew && !conflict && options.skipUnchanged
            && normalizedAtSubmit === state.workingBaseline) {
            // A recovered create may already have persisted this repair.
            if (credentialRepair) repairFileCredentials(channel);
            return true;
        }
        normalizeChannelDataTypeArrays(submitted);
        const original = state.baseline ? JSON.parse(state.baseline) : null;
        const originalTagIds = new Set<string>(api.asList(original?.exportData?.channelTags, 'channelTag')
            .map(tag => String(tag?.id)));
        await restoreChannelTagNames(submitted, originalTagIds);
        assertSession();
        const exportData = submitted.exportData = submitted.exportData || {};
        const metadata = exportData.metadata = exportData.metadata || { enabled: true };
        const previousTime = modifiedTime(current);
        // Swing stamps the actual save time; do not synthesize future metadata.
        const stamp = Date.now();
        metadata.lastModified = { time: stamp, timezone: metadata.lastModified?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' };
        if (options.userId !== undefined && options.userId !== null) metadata.userId = Number(options.userId);
        submitted.revision = state.isNew ? (Number(channel.revision) || 0) : (Number(current.revision) || 0) + 1;
        let accepted: any;
        if (state.isNew) {
            state.creationAttempts = [...(state.creationAttempts || []), submitted];
            accepted = await api.channels.create(submitted);
            assertSession();
            if (String(accepted) === 'false') state.creationAttempts = state.creationAttempts.filter(attempt => attempt !== submitted);
        }
        else {
            const startEdit = new Date(Math.ceil((Number.isFinite(previousTime) ? previousTime : Date.now()) / 1000) * 1000);
            accepted = await updateChannelWithConflict(channel.id,
                override => api.channels.update(channel.id, submitted, override, override ? undefined : startEdit),
                { ...options, assertSession });
            if (!accepted) return false;
        }
        if (String(accepted) !== 'true') throw new Error('The engine did not confirm the channel save. Your changes are still unsaved.');
        const unchangedDuringWrite = fingerprint(channel) === workingAtSubmit;
        // Creation is accepted independently of later dependency/deploy stages.
        state.isNew = false;
        state.creationAttempts = undefined;
        channel.revision = submitted.revision || 1;
        (channel.exportData = channel.exportData || {}).metadata = metadata;
        if (credentialRepair && unchangedDuringWrite) repairFileCredentials(channel);
        state.baseline = fingerprint({ ...submitted, revision: channel.revision });
        // The engine can retain the old revision for a metadata-only save and
        // normalize model fields. Rebase only a receipt carrying our save stamp;
        // a newer writer's model must never become this draft's clean baseline.
        try {
            const persisted = await api.channels.get(channel.id);
            assertSession();
            if (persisted?.id === channel.id && modifiedTime(persisted) === stamp
                && (persisted.revision === channel.revision || persisted.revision === current?.revision)) {
                channel.revision = persisted.revision;
                state.baseline = fingerprint(persisted);
            }
        } catch {
            // An ordinary readback failure does not undo the accepted write.
            // Session invalidation must still stop callers from starting later
            // library/dependency/deployment stages as a departed user.
            assertSession();
        }
        // A credential edit made during the request must remain unsaved. Force
        // the next Save to send it instead of treating the live draft as sent.
        state.workingBaseline = credentialRepair && !unchangedDuringWrite
            ? workingAtSubmit : fingerprint(channel);
        return true;
    } finally {
        state.saving = false;
    }
}
