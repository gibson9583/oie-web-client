/*
 * Client-side authorization hook — the web port of the Swing client's
 * AuthorizationController (com.mirth.connect.client.ui.AuthorizationController +
 * AuthorizationControllerFactory).
 *
 * A Role-Based Access Control plugin registers a controller in its register():
 *
 *   platform.setAuthorizationController({
 *       initialize() { ... },                  // optional, called once on register
 *       checkTask(taskGroup, taskName) { ... }  // return false to HIDE the item
 *   });
 *
 * checkTask returning false hides the matching left-menu task, its paired
 * right-click menu item, and (for the top-level nav) the nav entry — exactly the
 * way Swing's Frame.setVisibleTasks force-hides a task + its popup twin. With no
 * RBAC plugin installed the default controller allows everything, so the UI is
 * unchanged.
 *
 * taskGroup / taskName mirror Swing's TaskConstants verbatim: the group is the
 * task-pane key ("view", "channel", "channelGroup", "channelEdit", "dashboard",
 * "message", "event", "alert", "alertEdit", "user", "script", "codeTemplate",
 * "extensions", "settings_<tab>", "other") and the task is the action constant
 * ("doShowDashboard", "doNewChannel", "doDeleteChannel", ...). The SAME (group,
 * task) pair gates a task and its right-click twin, so an RBAC config maps 1:1 to
 * the Swing concept.
 */

/** What an RBAC plugin registers. `checkTask` returns false to HIDE the item. */
export interface AuthorizationController {
    /** Optional, called once on register. */
    initialize?(): void;
    checkTask(taskGroup: string, taskName: string): boolean;
}

const ALLOW_ALL: AuthorizationController = { checkTask: () => true };
const DENY_ALL: AuthorizationController = { checkTask: () => false };
let controller: AuthorizationController = ALLOW_ALL;
let blocked = false;
let revision = 0;
let registered = false;

/** Plugin discovery must settle before an authorization provider can allow tasks. */
export function blockAuthorization(value: boolean): void { blocked = value; }

/** Receipt used to verify that an authorization plugin installed its controller. */
export function authorizationRegistration(): { revision: number; registered: boolean } {
    return { revision, registered };
}

/** Register the RBAC controller (or clear it by passing null). */
export function setAuthorizationController(ctrl: AuthorizationController | null | undefined): void {
    revision++;
    registered = !!ctrl && typeof ctrl.checkTask === 'function';
    controller = registered ? ctrl! : ctrl == null ? ALLOW_ALL : DENY_ALL;
    if (controller.initialize) {
        try { controller.initialize(); } catch (e) {
            controller = DENY_ALL;
            registered = false;
            throw e;
        }
    }
}

/**
 * True if the user may see/use the task. Untagged items (no task name) are
 * allowed after discovery, while a throwing controller denies tagged tasks.
 * A failed or pending authorization bootstrap denies all task checks, even
 * if a plugin installed a permissive controller before failing registration.
 *
 * A task WITHOUT a group is still checked (group passed as ''): tagging a task
 * signals gating intent, and RBAC controllers resolve bare Swing task names
 * without the group — so a missing group tag must not silently fail open.
 */
export function checkTask(taskGroup: string | null | undefined, taskName: string | null | undefined): boolean {
    if (blocked) return false;
    if (!taskName) return true;
    try { return controller.checkTask(taskGroup || '', taskName) !== false; }
    catch { return false; }
}
