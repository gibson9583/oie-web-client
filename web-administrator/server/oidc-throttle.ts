/*
 * Rate limiting for the two OIDC routes.
 *
 * Split out of oidc.ts because it is the one part of that file with no OIDC in
 * it: it counts requests per client address and answers 429. Its subtleties are
 * about proxies and content negotiation, and reading them next to the token
 * exchange invited the assumption that they were about tokens.
 */

import type { Request, Response } from 'express';
import { isTrustedPeer } from './proxy';

/** Requests allowed per address per window, and the window itself. */
const LIMIT = 30;
const WINDOW_MS = 60000;
/** Sweep one-off addresses once the map grows past this. */
const SWEEP_AT = 1000;

// The address the throttle should count: behind the deployment's trusted front
// proxy every browser shares one socket address, so use the client the proxy
// reports (the RIGHTMOST X-Forwarded-For hop — appended by the trusted proxy,
// unforgeable by the client, unlike the client-suppliable leftmost entries).
export function throttleKey(remoteAddress: string | undefined, forwardedFor: unknown, trusted: Set<string>): string {
    if (isTrustedPeer(remoteAddress, trusted)) {
        const hops = String(forwardedFor || '').split(',').map((hop) => hop.trim()).filter(Boolean);
        if (hops.length) return hops[hops.length - 1];
    }
    return String(remoteAddress || 'unknown');
}

export function oidcThrottle(trusted: Set<string>) {
    const hits = new Map<string, number[]>();
    return (req: Request, res: Response, next: () => void) => {
        const key = throttleKey(req.socket.remoteAddress, req.headers['x-forwarded-for'], trusted);
        const now = Date.now();
        // Drop buckets whose window has fully passed so one-off addresses
        // don't accumulate forever.
        if (hits.size > SWEEP_AT) for (const [stale, times] of hits) { if (now - (times[times.length - 1] || 0) >= WINDOW_MS) hits.delete(stale); }
        const recent = (hits.get(key) || []).filter((time) => now - time < WINDOW_MS);
        if (recent.length >= LIMIT) {
            // Say WHEN, not just no. The throttle keys on client IP, so the two
            // populations that hit it are an attacker and a shared egress —
            // an office NAT, or a CI run driving many sign-ins — and for the
            // latter a bare 429 reads as a functional failure. Retry-After lets a
            // caller distinguish "throttled" from "broken" without guessing.
            const oldest = recent[0] || now;
            res.set('Retry-After', String(Math.max(1, Math.ceil((WINDOW_MS - (now - oldest)) / 1000))));
            const text = 'Too many OIDC requests. Try again shortly.';
            // Content-negotiated rather than always JSON. Both routes here are
            // reached ONLY by top-level browser navigation — location.assign to
            // /oidc/start, and the IdP's 302 to /oidc/callback — so an
            // unconditional JSON body would put a raw object in the user's
            // window. JSON is right for the app's fetch endpoints; these two are
            // not that, so answer whatever the caller actually asked for.
            // text/plain is listed FIRST and explicitly. Offering only `json` plus
            // a default does not work: a browser's Accept ends with `*/*;q=0.8`,
            // which matches application/json, so res.format picks JSON and the
            // user reads a raw object. Naming both lets the browser's q=1
            // text/html preference beat the wildcard while an XHR still gets JSON.
            res.status(429).format({
                'text/plain': () => { res.type('text/plain').send(text); },
                'application/json': () => { res.json({ error: 'TOO_MANY_REQUESTS', message: text }); },
                default: () => { res.type('text/plain').send(text); }
            });
            return;
        }
        recent.push(now); hits.set(key, recent); next();
    };
}
