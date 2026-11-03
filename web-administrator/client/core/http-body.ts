/* HTTP Sender request body selection, as HttpDispatcher.buildHttpRequest applies it. */

export type HttpBodyMode = 'none' | 'multipart' | 'form' | 'content';

const method = (p: any) => String(p?.method ?? '').toUpperCase();

/** Only POST, PUT and PATCH send a request body. */
export const httpHasBody = (p: any): boolean => ['POST', 'PUT', 'PATCH'].includes(method(p));

/** A form-urlencoded body is built from the parameters; the Content field is not sent. */
export const httpFormUrlEncoded = (p: any): boolean => String(p?.contentType || '').toLowerCase().startsWith('application/x-www-form-urlencoded');

/** POST multipart takes precedence over a form content type; PUT and PATCH are never multipart. */
export function httpBodyMode(p: any): HttpBodyMode {
    if (!httpHasBody(p)) return 'none';
    if (method(p) === 'POST' && (p.multipart === true || p.multipart === 'true')) return 'multipart';
    return httpFormUrlEncoded(p) ? 'form' : 'content';
}
