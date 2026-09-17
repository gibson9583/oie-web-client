/*
 * Alerts have NO engine-side conflict detection (no revision field, no override
 * check in AlertController — unlike channels and code templates). This web
 * safety check goes beyond Swing: snapshot
 * the server's copy when editing begins, re-fetch just before saving, and prompt
 * when they differ. The small fetch-to-save race is accepted — it is strictly
 * better than the silent last-write-wins it replaces.
 */

import api from '@oie/web-api';
import { confirmDialog } from '@oie/web-ui';

// The baseline follows the working object's identity across classic/wizard
// handoffs. Never fetch a second copy after editing has already begun.
const baselines = new WeakMap<object, string>();
export async function loadAlertForEdit(alertId: string) {
    const model = await api.alerts.get(alertId);
    if (!model || model.id !== alertId) throw new Error('Alert not found');
    baselines.set(model, JSON.stringify(model));
    return model;
}

export function alertBaseline(model: object): string | null {
    return baselines.get(model) ?? null;
}

/**
 * True when it is OK to save: the alert is unchanged on the server, or the user
 * explicitly chose to overwrite. An unavailable baseline or current read must
 * not silently disable conflict checking.
 */
export async function confirmIfAlertChanged(alertId: any, baseline: any) {
    if (!baseline) throw new Error('Cannot verify the original alert. Reopen it before saving.');
    const model = await api.alerts.get(alertId);
    if (!model || model.id !== alertId) throw new Error('The alert was removed. Reopen the alert list before saving.');
    const current = JSON.stringify(model);
    if (current === baseline) return true;
    return confirmDialog('Alert Modified',
        'This alert has been modified since you first opened it. Are you sure you want to overwrite it?',
        { danger: true, okLabel: 'Overwrite' });
}
