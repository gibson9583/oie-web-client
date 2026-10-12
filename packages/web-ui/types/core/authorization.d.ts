/** What an RBAC plugin registers. `checkTask` returns false to HIDE the item. */
export interface AuthorizationController {
    /** Optional, called once on register. */
    initialize?(): void;
    checkTask(taskGroup: string, taskName: string): boolean;
}
/** Plugin discovery must settle before an authorization provider can allow tasks. */
export declare function blockAuthorization(value: boolean): void;
/** Receipt used to verify that an authorization plugin installed its controller. */
export declare function authorizationRegistration(): {
    revision: number;
    registered: boolean;
};
/** Register the RBAC controller (or clear it by passing null). */
export declare function setAuthorizationController(ctrl: AuthorizationController | null | undefined): void;
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
export declare function checkTask(taskGroup: string | null | undefined, taskName: string | null | undefined): boolean;
