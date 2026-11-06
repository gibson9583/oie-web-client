import { parseBody } from '@oie/web-api';

// Jetty's sendError puts only the reason phrase in its message field (for
// example an engine permission denial is {"message":"Forbidden"}). The status
// line already says that, so it is not useful detail.
const REASON_PHRASES: Record<number, string[]> = {
    400: ['bad request'], 401: ['unauthorized'], 403: ['forbidden'], 404: ['not found'],
    405: ['method not allowed'], 406: ['not acceptable'], 409: ['conflict'],
    500: ['server error', 'internal server error'], 502: ['bad gateway'],
    503: ['service unavailable'], 504: ['gateway timeout']
};

/** Format a view's load diagnostic without changing the shared API error. */
export function loadErrorMessage(error: any, resource: string, permissionResource = resource): string {
    const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : null;
    const body = typeof error?.body === 'string' ? error.body.trim() : '';
    // Jetty/proxy error pages are generic documents, not useful engine detail.
    // Do not put their markup (or styles/scripts) in the error dialog.
    const isHtml = (text: string) => /^\s*<(?:!doctype\s+html|html|head|body)\b/i.test(text);
    const parsed = body && !isHtml(body) ? parseBody(body) : null;
    const candidates: unknown[] = parsed && typeof parsed === 'object'
        ? [parsed.message, parsed.detailedError, parsed.error]
        : [parsed];
    // ApiError.message may be the untouched raw body (including {} or HTML).
    // Once parsed, use its actual message fields rather than showing that wire.
    const originalMessage = typeof error?.message === 'string' ? error.message.trim() : '';
    const isStatusOnly = status !== null && (originalMessage === String(status) || originalMessage.startsWith(`${status} `));
    if (body ? originalMessage !== body : !isStatusOnly) candidates.push(originalMessage);
    const isReasonPhrase = (text: string) => status !== null
        && (REASON_PHRASES[status] || []).includes(text.replace(/\.$/, '').toLowerCase());
    const details = [...new Set(candidates.filter((value): value is string => typeof value === 'string')
        .map(value => value.trim())
        .filter(value => value && !isHtml(value) && !isReasonPhrase(value) && !/^request failed\.?$/i.test(value)))];
    let message = details.join('\n\n');
    if (!message) {
        if (status === 401) message = 'Session expired. Sign in again.';
        else if (status === 403) message = `Access denied. Check your permissions to view ${permissionResource}.`;
        else message = `The ${resource} could not be loaded.`;
        // A generic 5xx does not establish a serialization failure. The engine
        // log can identify that cause. Keep useful response instructions intact
        // (for example the Node proxy's web-administrator-log guidance).
        if (status !== null && status >= 500) message += '\n\nCheck the engine server log for details.';
    }
    return `${status === null ? '' : `HTTP ${status}. `}${message}`;
}

/** Await a prerequisite read. A failure carries the load diagnostic instead of the raw API message. */
export async function explainLoad<T>(read: Promise<T>, resource: string, permissionResource = resource): Promise<T> {
    try {
        return await read;
    } catch (error: any) {
        throw new Error(loadErrorMessage(error, resource, permissionResource));
    }
}
