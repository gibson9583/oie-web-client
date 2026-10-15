/** Shared prerequisites for routed views and the commands that enter them. */
export type RouteTask = readonly [group: string, task: string];
export type RouteTasks = readonly RouteTask[];

export const NEW_CHANNEL_TASKS: RouteTasks = [['view', 'doShowChannel'], ['channel', 'doNewChannel']];
export const EDIT_CHANNEL_TASKS: RouteTasks = [['view', 'doShowChannel'], ['channel', 'doEditChannel']];
export const NEW_ALERT_TASKS: RouteTasks = [['view', 'doShowAlerts'], ['alert', 'doNewAlert']];
export const EDIT_ALERT_TASKS: RouteTasks = [['view', 'doShowAlerts'], ['alert', 'doEditAlert']];
export const CODE_TEMPLATE_TASKS: RouteTasks = [['channel', 'doEditCodeTemplates']];
