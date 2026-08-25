/* Safety checks shared by the message browser and compare overlay. */

import api from '@oie/web-api';
import { strictWireList } from './wire-safety.js';

export async function readMetaDataColumnsStrict(channelId: any): Promise<any[]> {
    const raw = await api.get(`/channels/${encodeURIComponent(String(channelId))}/metaDataColumns`);
    const columns = strictWireList<any>(raw, 'metaDataColumn', 'channel metadata column list');
    for (const column of columns) {
        if (!column || typeof column !== 'object' || !String(column.name || '').trim()) {
            throw new Error('the engine returned an unusable channel metadata column list');
        }
    }
    return columns;
}

export function hasPatientIdColumn(columns: any[]): boolean {
    return columns.some(column => String(column.name || '').toUpperCase() === 'PATIENT_ID');
}

export function requireFreshMessage(message: any, expected: {
    channelId: any;
    messageId: any;
    metaDataId?: any;
}): any {
    if (!message || typeof message !== 'object'
        || String(message.messageId ?? '') !== String(expected.messageId)
        || String(message.channelId ?? '') !== String(expected.channelId)) {
        throw new Error(`the engine did not return message ${expected.messageId}`);
    }

    if (expected.metaDataId !== undefined) {
        const entries = message?.connectorMessages?.entry ?? message?.connectorMessages;
        const connectors = api.asList(entries)
            .map((entry: any) => entry?.connectorMessage ?? (entry?.metaDataId !== undefined ? entry : null))
            .filter(Boolean);
        if (!connectors.some((connector: any) =>
            Number(connector.metaDataId) === Number(expected.metaDataId))) {
            throw new Error(`connector ${expected.metaDataId} is no longer part of message ${expected.messageId}`);
        }
    }
    return message;
}
