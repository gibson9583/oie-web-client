/*
 * Enforces the engine's "Administrator Auto Logout Interval" (Settings → Server:
 * administratorAutoLogoutIntervalEnabled / administratorAutoLogoutIntervalField).
 *
 * The engine only PUBLISHES the policy (GET /server/publicSettings); enforcement is
 * per-client against real user input — exactly like the Swing client, whose
 * InactivityListener watches AWT events and logs out after the configured minutes.
 * Here activity is any pointer/key/wheel/touch event, recorded as a timestamp (cheap
 * on high-frequency events), and a 30-second local check fires the logout once the
 * idle window elapses. The check loop makes no network calls, so it can never reset
 * the engine's own session inactivity timeout.
 */

import { get } from './api.js';

const EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];

let lastActivity = 0;
let checkTimer = null;
let listening = false;

const touch = () => { lastActivity = Date.now(); };

/**
 * Reads the policy and, when enabled with a positive interval, starts watching.
 * `onIdle` runs once when the idle window elapses. Safe to call again (re-login);
 * a missing/older engine endpoint just means no policy to enforce.
 */
export async function startIdleLogout(onIdle) {
    stopIdleLogout();
    let minutes = 0;
    try {
        const pub = await get('/server/publicSettings');
        const enabled = pub && (pub.administratorAutoLogoutIntervalEnabled === true
            || pub.administratorAutoLogoutIntervalEnabled === 'true');
        minutes = enabled ? (parseInt(pub.administratorAutoLogoutIntervalField, 10) || 0) : 0;
    } catch {
        return; // endpoint unavailable — no policy
    }
    if (minutes <= 0) return;

    lastActivity = Date.now();
    if (!listening) {
        for (const ev of EVENTS) window.addEventListener(ev, touch, { passive: true, capture: true });
        listening = true;
    }
    checkTimer = setInterval(() => {
        if (Date.now() - lastActivity >= minutes * 60000) {
            stopIdleLogout();
            onIdle();
        }
    }, 30000);
}

export function stopIdleLogout() {
    if (checkTimer) { clearInterval(checkTimer); checkTimer = null; }
    if (listening) {
        for (const ev of EVENTS) window.removeEventListener(ev, touch, { capture: true });
        listening = false;
    }
}
