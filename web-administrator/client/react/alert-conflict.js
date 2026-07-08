/*
 * Alerts have NO engine-side conflict detection (no revision field, no override
 * check in AlertController — unlike channels and code templates), so the Swing-
 * parity "modified since you opened it" warning is emulated client-side: snapshot
 * the server's copy when editing begins, re-fetch just before saving, and prompt
 * when they differ. The small fetch-to-save race is accepted — it is strictly
 * better than the silent last-write-wins it replaces.
 */

import api from '@oie/web-api';
import { confirmDialog } from '@oie/web-ui';

/** Fetches the alert's current server copy as a comparison baseline (null if unavailable). */
export async function alertBaseline(alertId) {
    try {
        return JSON.stringify(await api.alerts.get(alertId));
    } catch {
        return null;
    }
}

/**
 * True when it is OK to save: the alert is unchanged on the server, or the user
 * explicitly chose to overwrite. With no baseline (fetch failed at open), the
 * check is skipped rather than blocking the save.
 */
export async function confirmIfAlertChanged(alertId, baseline) {
    if (!baseline) return true;
    let current = null;
    try {
        current = JSON.stringify(await api.alerts.get(alertId));
    } catch {
        return true;   // engine unreachable: let the save itself surface the real error
    }
    if (current === baseline) return true;
    return confirmDialog('Alert Modified',
        'This alert has been modified since you first opened it. Are you sure you want to overwrite it?',
        { danger: true, okLabel: 'Overwrite' });
}
