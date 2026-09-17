import api from './api.js';
import type { ChannelGroup } from './wire-types.js';

/** Swing's guarded save and explicit overwrite choice, applied to a fresh set.
 * Even an approved overwrite must preserve groups added while the prompt was open. */
export async function mutateChannelGroups(
    change: (groups: ChannelGroup[]) => ChannelGroup[], removedIds: string[] = [],
    options: { expectedGroup?: ChannelGroup; confirmOverwrite?: () => Promise<boolean> } = {}
): Promise<boolean> {
    const read = async () => {
        const groups = await api.channelGroups.list();
        if (options.expectedGroup && !groups.some(group => group.id === options.expectedGroup!.id)) {
            throw new Error('This group was removed. Refresh the channel list before saving.');
        }
        return groups;
    };
    const confirm = async () => {
        if (!options.confirmOverwrite) throw new Error('Groups were not saved. Refresh and review the current groups before retrying; another administrator may have changed them.');
        return options.confirmOverwrite();
    };
    let current = await read();
    let override = false;
    if (options.expectedGroup && current.find(group => group.id === options.expectedGroup!.id)?.revision !== options.expectedGroup.revision) {
        if (!await confirm()) return false;
        override = true;
        current = await read();
    }
    let result = await api.channelGroups.bulkUpdate(change(structuredClone(current)), removedIds, override);
    if ((result === false || result === 'false') && !override) {
        if (!await confirm()) return false;
        result = await api.channelGroups.bulkUpdate(change(structuredClone(await read())), removedIds, true);
    }
    if (result !== true && result !== 'true') throw new Error('The engine did not confirm the group save. Your changes are still unsaved.');
    return true;
}
