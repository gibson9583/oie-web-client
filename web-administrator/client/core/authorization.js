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

const ALLOW_ALL = { checkTask: () => true };
let controller = ALLOW_ALL;

/** Register the RBAC controller (or clear it by passing null). */
export function setAuthorizationController(ctrl) {
    controller = (ctrl && typeof ctrl.checkTask === 'function') ? ctrl : ALLOW_ALL;
    if (controller.initialize) {
        try { controller.initialize(); } catch (e) { console.warn('[auth] controller.initialize failed:', e); }
    }
}

/**
 * True if the user may see/use the task. Untagged items (no task name) are
 * always allowed, and a throwing controller fails OPEN (visible) — matching
 * Swing's DefaultAuthorizationController, which permits everything.
 *
 * A task WITHOUT a group is still checked (group passed as ''): tagging a task
 * signals gating intent, and RBAC controllers resolve bare Swing task names
 * without the group — so a missing group tag must not silently fail open.
 */
export function checkTask(taskGroup, taskName) {
    if (!taskName) return true;
    try { return controller.checkTask(taskGroup || '', taskName) !== false; }
    catch { return true; }
}
