/** What an RBAC plugin registers. `checkTask` returns false to HIDE the item. */
export interface AuthorizationController {
    /** Optional, called once on register. */
    initialize?(): void;
    checkTask(taskGroup: string, taskName: string): boolean;
}
/** Register the RBAC controller (or clear it by passing null). */
export declare function setAuthorizationController(ctrl: AuthorizationController | null | undefined): void;
/**
 * True if the user may see/use the task. Untagged items (no task name) are
 * always allowed, and a throwing controller fails OPEN (visible) — matching
 * Swing's DefaultAuthorizationController, which permits everything.
 *
 * A task WITHOUT a group is still checked (group passed as ''): tagging a task
 * signals gating intent, and RBAC controllers resolve bare Swing task names
 * without the group — so a missing group tag must not silently fail open.
 */
export declare function checkTask(taskGroup: string | null | undefined, taskName: string | null | undefined): boolean;
