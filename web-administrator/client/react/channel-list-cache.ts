import api from '@oie/web-api';
import { QueryObserver } from '@tanstack/react-query';
import { queryClient } from './queries.js';

export interface ChannelListData {
    channels: any[];
    groups: any[];
    tags: any[];
    statusById: Record<string, any>;
    hasChannels: boolean;
}

const key = ['channels', 'listDisplay'];

export function emptyChannelList(): ChannelListData {
    return { channels: [], groups: [], tags: [], statusById: {}, hasChannels: false };
}

export function readChannelListDisplay(): ChannelListData {
    const cached = queryClient.getQueryData<ChannelListData>(key);
    return cached ? structuredClone(cached) : emptyChannelList();
}

/** Keep displayed rows alive while Channels is mounted. A disabled observer
 * retains the query without fetching; releasing it starts the shared client's
 * inactive expiry period. Session teardown still clears the cache immediately. */
export function retainChannelListDisplay(): () => void {
    const observer = new QueryObserver<ChannelListData>(queryClient, { queryKey: key, enabled: false });
    return observer.subscribe(() => {});
}

/** Display fields only: never retain connector credentials, scripts or message
 * templates in a navigation cache. These rows cannot be used as channel models.
 * The shared query client expires inactive entries and is cleared on session
 * teardown. API reads and action-time validation remain uncached. */
export function cacheChannelListDisplay(data: ChannelListData): void {
    const snapshot: ChannelListData = {
        hasChannels: data.hasChannels,
        channels: data.channels.map(channel => ({
            id: channel.id, name: channel.name, description: channel.description,
            '@class': channel['@class'],
            sourceConnector: { transformer: { inboundDataType: channel.sourceConnector?.transformer?.inboundDataType } },
            exportData: { metadata: {
                enabled: channel.exportData?.metadata?.enabled,
                lastModified: channel.exportData?.metadata?.lastModified
            } }
        })),
        groups: data.groups.map(group => ({
            id: group.id, name: group.name, description: group.description,
            channels: { channel: api.asList(group.channels, 'channel').filter(c => c?.id).map(c => ({ id: c.id })) }
        })),
        tags: data.tags.map(tag => ({
            name: tag.name, backgroundColor: tag.backgroundColor, channelIds: tag.channelIds
        })),
        statusById: Object.fromEntries(Object.entries(data.statusById).map(([id, status]) => [id, {
            deployedRevisionDelta: status.deployedRevisionDelta,
            codeTemplatesChanged: status.codeTemplatesChanged,
            deployedDate: status.deployedDate
        }]))
    };
    queryClient.setQueryData(key, structuredClone(snapshot));
}
