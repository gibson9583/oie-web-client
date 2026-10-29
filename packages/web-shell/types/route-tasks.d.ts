/** Shared prerequisites for routed views and the commands that enter them. */
export type RouteTask = readonly [group: string, task: string];
export type RouteTasks = readonly RouteTask[];
export declare const NEW_CHANNEL_TASKS: RouteTasks;
export declare const EDIT_CHANNEL_TASKS: RouteTasks;
export declare const INSPECT_CHANNEL_TASKS: RouteTasks;
export declare const NEW_ALERT_TASKS: RouteTasks;
export declare const EDIT_ALERT_TASKS: RouteTasks;
export declare const CODE_TEMPLATE_TASKS: RouteTasks;
