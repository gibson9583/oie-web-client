/** What an RBAC plugin registers. `checkTask` returns false to HIDE the item. */
export interface AuthorizationController {
    /** Optional, called once on register. */
    initialize?(): void;
    checkTask(taskGroup: string, taskName: string): boolean;
}
/** A failed bootstrap or invalidated session cannot be released by a controller. */
export declare function blockAuthorization(value: boolean): void;
/** Keep unknown discovery from exposing the default unrestricted controller. */
export declare function beginAuthorizationDiscovery(): void;
/** Internal loader boundary. Views remain gated by shell readiness while plugins
 * query the installed controller and construct their permission-dependent UI. */
export declare function beginAuthorizationRegistration(required: boolean): void;
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
 * Unknown discovery, failed bootstrap and invalidated sessions deny all checks.
 * During registration the installed controller answers normally; a required
 * provider must install one before any task can be allowed. The shell separately
 * withholds views and commands until every required provider has succeeded.
 *
 * A task WITHOUT a group is still checked (group passed as ''): tagging a task
 * signals gating intent, and RBAC controllers resolve bare Swing task names
 * without the group — so a missing group tag must not silently fail open.
 */
export declare function checkTask(taskGroup: string | null | undefined, taskName: string | null | undefined): boolean;
