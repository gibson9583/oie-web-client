import { isNewChannelDraft } from './channel-save.js';

// Alert creation has no channel-style save session. Track draft identity so a
// query string or a stale handoff flag cannot turn a persisted alert into a new
// one. Both builders use the same factory and retain the object's identity.
const newAlerts = new WeakSet<object>();

export function markNewAlertDraft<T extends object>(model: T): T {
    newAlerts.add(model);
    return model;
}

export function isNewAlertDraft(model: object): boolean {
    return newAlerts.has(model);
}

export function markAlertPersisted(model: object): void {
    newAlerts.delete(model);
}

function routeIsNew(routeId: string | undefined, model: any, wizard: boolean, fresh: boolean,
    valid: (model: any) => boolean, isDraft: (model: object) => boolean): boolean {
    // Router params have already been decoded: /%6eew/guided is also the new
    // wizard. Its loader may resume a valid stored model, including a channel
    // whose creation succeeded before a later dependency stage failed.
    const newWizard = wizard && (!routeId || routeId === 'new');
    // Explicit New commands start a fresh model after the router accepts leave.
    // Builder handoffs omit this flag so an existing draft remains resumable.
    if (newWizard && fresh) return true;
    if (model?.id && valid(model) && (newWizard || String(model.id) === routeId)) {
        return isDraft(model);
    }
    // A classic editor without its matching in-memory draft must load an
    // existing object. ?new=1 is only a lost-draft hint, never authorization.
    return newWizard;
}

export function isNewChannelRoute(routeId: string | undefined, model: any, wizard = false, fresh = false): boolean {
    return routeIsNew(routeId, model, wizard, fresh, c => !!c.sourceConnector, isNewChannelDraft);
}

export function isNewAlertRoute(routeId: string | undefined, model: any, wizard = false, fresh = false): boolean {
    return routeIsNew(routeId, model, wizard, fresh, a => !!a.trigger, isNewAlertDraft);
}
