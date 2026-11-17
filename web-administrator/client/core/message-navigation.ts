/**
 * Deep-link URL query parameter resolution for the message browser
 * (`/messages/:channelId`).
 */

export const MESSAGE_STATUS_VALUES = [
    'RECEIVED',
    'TRANSFORMED',
    'FILTERED',
    'QUEUED',
    'SENT',
    'ERROR',
    'PENDING',
] as const;

export type MessageStatus = (typeof MESSAGE_STATUS_VALUES)[number];

const VALID_STATUSES = new Set<string>(MESSAGE_STATUS_VALUES);

const NUMERIC_ADV_KEYS = [
    'minMessageId',
    'maxMessageId',
    'minOriginalId',
    'maxOriginalId',
    'minImportId',
    'maxImportId',
    'minSendAttempts',
    'maxSendAttempts',
] as const;

export type QueryInput =
    | URLSearchParams
    | string
    | Record<string, unknown>
    | null
    | undefined;

export interface MessageAdvancedUrlCriteria {
    minMessageId: string;
    maxMessageId: string;
    minOriginalId: string;
    maxOriginalId: string;
    minImportId: string;
    maxImportId: string;
    serverId: string;
    minSendAttempts: string;
    maxSendAttempts: string;
    error: boolean;
    attachment: boolean;
    includedMetaDataIds: number[] | null;
    excludedMetaDataIds: number[] | null;
}

export interface MessageUrlCriteria {
    startDate: string;
    endDate: string;
    statuses: MessageStatus[];
    textSearch: string;
    textRegex: boolean;
    connectorVal: string;
    advanced: MessageAdvancedUrlCriteria;
}

function getAllValues(input: QueryInput, key: string): string[] {
    if (!input) return [];
    if (typeof input === 'string') {
        const qs = input.startsWith('?') ? input.slice(1) : input;
        return new URLSearchParams(qs).getAll(key);
    }
    if (input instanceof URLSearchParams) {
        return input.getAll(key);
    }
    if (!Object.hasOwn(input, key)) return [];
    const raw = input[key];
    if (raw == null) return [];
    if (Array.isArray(raw)) return raw.filter(v => v != null).map(String);
    return [String(raw)];
}

function getLastValue(input: QueryInput, key: string): string | undefined {
    const all = getAllValues(input, key);
    return all.length ? all[all.length - 1] : undefined;
}

function splitTokens(values: string[]): string[] {
    const out: string[] = [];
    for (const value of values) {
        for (const part of String(value).split(',')) {
            const trimmed = part.trim();
            if (trimmed) out.push(trimmed);
        }
    }
    return out;
}

function parseMetaDataIds(values: string[]): number[] {
    const seen = new Set<number>();
    const out: number[] = [];
    for (const token of splitTokens(values)) {
        if (!/^\d+$/.test(token)) continue;
        const n = Number(token);
        if (!Number.isSafeInteger(n) || seen.has(n)) continue;
        seen.add(n);
        out.push(n);
    }
    return out;
}

function parseStatuses(values: string[]): MessageStatus[] {
    const seen = new Set<MessageStatus>();
    const out: MessageStatus[] = [];
    for (const token of splitTokens(values)) {
        const upper = token.toUpperCase();
        if (!VALID_STATUSES.has(upper)) continue;
        const status = upper as MessageStatus;
        if (seen.has(status)) continue;
        seen.add(status);
        out.push(status);
    }
    return out;
}

function parseDateTime(raw: string | undefined): string {
    if (!raw) return '';
    const trimmed = raw.trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
    if (!m) return '';
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const hour = Number(m[4]);
    const minute = Number(m[5]);
    const second = m[6] != null ? Number(m[6]) : 0;
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
        return '';
    }
    const date = new Date(year, month - 1, day, hour, minute, second);
    if (
        Number.isNaN(date.getTime()) ||
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
    ) {
        return '';
    }
    const base = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
    return m[6] != null && m[6] !== '00' ? `${base}:${m[6]}` : base;
}

function parseNonNegativeIntString(raw: string | undefined): string {
    if (!raw) return '';
    const trimmed = raw.trim();
    return /^\d+$/.test(trimmed) ? trimmed : '';
}

function parseBooleanFlag(raw: string | undefined): boolean {
    if (!raw) return false;
    const normalized = raw.trim().toLowerCase();
    return normalized === 'true' || normalized === '1';
}

/**
 * Resolves URL query parameters into initial main-bar and Advanced search
 * criteria for `/messages/:channelId`.
 *
 * When `hasTargetMessageId` is true (`?messageId=` positioning mode), search
 * criteria are left at their defaults so page-positioning navigation works
 * unchanged.
 */
export function resolveMessageUrlCriteria(
    input: QueryInput,
    { hasTargetMessageId = false }: { hasTargetMessageId?: boolean } = {}
): MessageUrlCriteria {
    const emptyAdvanced: MessageAdvancedUrlCriteria = {
        minMessageId: '',
        maxMessageId: '',
        minOriginalId: '',
        maxOriginalId: '',
        minImportId: '',
        maxImportId: '',
        serverId: '',
        minSendAttempts: '',
        maxSendAttempts: '',
        error: false,
        attachment: false,
        includedMetaDataIds: null,
        excludedMetaDataIds: null,
    };

    if (hasTargetMessageId || !input) {
        return {
            startDate: '',
            endDate: '',
            statuses: [],
            textSearch: '',
            textRegex: false,
            connectorVal: '',
            advanced: emptyAdvanced,
        };
    }

    const includedIds = parseMetaDataIds(getAllValues(input, 'metaDataId'));
    const excludedIds = parseMetaDataIds(getAllValues(input, 'excludedMetaDataId'));

    let connectorVal = '';
    let includedMetaDataIds: number[] | null = null;
    let excludedMetaDataIds: number[] | null = null;

    if (includedIds.length === 1) {
        connectorVal = String(includedIds[0]);
    } else if (includedIds.length > 1) {
        includedMetaDataIds = includedIds;
    } else if (excludedIds.length > 0) {
        excludedMetaDataIds = excludedIds;
    }

    const advanced: MessageAdvancedUrlCriteria = {
        ...emptyAdvanced,
        includedMetaDataIds,
        excludedMetaDataIds,
        serverId: (getLastValue(input, 'serverId') ?? '').trim(),
        error: parseBooleanFlag(getLastValue(input, 'error')),
        attachment: parseBooleanFlag(getLastValue(input, 'attachment')),
    };

    for (const key of NUMERIC_ADV_KEYS) {
        advanced[key] = parseNonNegativeIntString(getLastValue(input, key));
    }

    const textSearch = (getLastValue(input, 'textSearch') ?? '').trim();
    const textRegex = parseBooleanFlag(getLastValue(input, 'textSearchRegex'));

    return {
        startDate: parseDateTime(getLastValue(input, 'startDate')),
        endDate: parseDateTime(getLastValue(input, 'endDate')),
        statuses: parseStatuses(getAllValues(input, 'status')),
        textSearch,
        textRegex,
        connectorVal,
        advanced,
    };
}
