export function onSessionExpired(fn: any): void;
export function resetSessionExpired(): void;
export function parseBody(text: any): any;
export function get(path: any, params: any, opts: any): Promise<any>;
export function post(path: any, body: any, { params, contentType, wrapKey, raw, noAuthHandler }?: {
    contentType?: string | undefined;
}): Promise<any>;
export function put(path: any, body: any, { params, contentType, wrapKey, raw }?: {
    contentType?: string | undefined;
}): Promise<any>;
export function getXml(path: any, params: any): Promise<any>;
export function postXml(path: any, xml: any, params: any): Promise<any>;
export function putXml(path: any, xml: any, params: any): Promise<any>;
export function del(path: any, params: any): Promise<any>;
export function asList(value: any, key: any): any[];
export class ApiError extends Error {
    constructor(status: any, message: any, body: any);
    status: any;
    body: any;
}
export namespace auth {
    function login(username: any, password: any): Promise<any>;
    function logout(): Promise<any>;
    function current(): Promise<any>;
}
export namespace users {
    function list(): Promise<any[]>;
    function get(idOrName: any): Promise<any>;
    function create(user: any): Promise<any>;
    function update(userId: any, user: any): Promise<any>;
    function remove(userId: any): Promise<any>;
    function updatePassword(userId: any, plainPassword: any): Promise<any>;
    function checkPassword(plainPassword: any): Promise<any>;
    function isLoggedIn(userId: any): Promise<any>;
    function getPreferences(userId: any): Promise<any>;
    function setPreferences(userId: any, props: any): Promise<any>;
}
export namespace channels {
    export function list_1(channelIds: any, pollingOnly: any): Promise<any[]>;
    export { list_1 as list };
    export function get_1(channelId: any): Promise<any>;
    export { get_1 as get };
    export function create_1(channel: any): Promise<any>;
    export { create_1 as create };
    export function update_1(channelId: any, channel: any, override?: boolean): Promise<any>;
    export { update_1 as update };
    export function remove_1(channelId: any): Promise<any>;
    export { remove_1 as remove };
    export function idsAndNames(): Promise<any>;
    export function connectorNames(channelId: any): Promise<any>;
    export function metaDataColumns(channelId: any): Promise<any[]>;
    export function portsInUse(): Promise<any[]>;
    export function setEnabled(channelId: any, enabled: any): Promise<any>;
    export function setInitialState(channelId: any, state: any): Promise<any>;
}
export namespace channelGroups {
    export function list_2(): Promise<any[]>;
    export { list_2 as list };
    export function bulkUpdate(groups: any, removedIds?: any[]): Promise<any>;
}
export namespace status {
    export function list_3(channelIds: any, filter: any, includeUndeployed: any): Promise<any[]>;
    export { list_3 as list };
    export function initial(fetchSize: number | undefined, filter: any): Promise<any>;
    export function one(channelId: any): Promise<any>;
    export function start(channelId: any): Promise<any>;
    export function stop(channelId: any): Promise<any>;
    export function halt(channelId: any): Promise<any>;
    export function pause(channelId: any): Promise<any>;
    export function resume(channelId: any): Promise<any>;
    export function startConnector(channelId: any, metaDataId: any): Promise<any>;
    export function stopConnector(channelId: any, metaDataId: any): Promise<any>;
}
export namespace statistics {
    export function list_4(channelIds: any, includeUndeployed: any): Promise<any[]>;
    export { list_4 as list };
    export function one_1(channelId: any): Promise<any>;
    export { one_1 as one };
    export function clear(channelIdsToConnectors: any, received?: boolean, filtered?: boolean, sent?: boolean, errored?: boolean): Promise<any>;
    export function clearAll(): Promise<any>;
}
export namespace engine {
    function deploy(channelId: any, returnErrors?: boolean): Promise<any>;
    function deployMany(channelIds: any, returnErrors?: boolean): Promise<any>;
    function undeploy(channelId: any, returnErrors?: boolean): Promise<any>;
    function undeployMany(channelIds: any, returnErrors?: boolean): Promise<any>;
    function redeployAll(returnErrors?: boolean): Promise<any>;
}
export namespace messages {
    export function search(channelId: any, params: any): Promise<any[]>;
    export function count(channelId: any, params: any): Promise<any>;
    export function get_2(channelId: any, messageId: any): Promise<any>;
    export { get_2 as get };
    export function maxMessageId(channelId: any): Promise<any>;
    export function attachments(channelId: any, messageId: any): Promise<any[]>;
    export function attachment(channelId: any, messageId: any, attachmentId: any): Promise<any>;
    export function processNew(channelId: any, rawData: any, destinationMetaDataIds: any, sourceMapEntries: any): Promise<any>;
    export function reprocess(channelId: any, messageId: any, replace?: boolean, filterDestinations?: boolean, metaDataIds?: any[]): Promise<any>;
    export function remove_2(channelId: any, messageId: any): Promise<any>;
    export { remove_2 as remove };
    export function removeAll(channelId: any, restartRunningChannels?: boolean, clearStatistics?: boolean): Promise<any>;
}
export namespace events {
    export function search_1(params: any): Promise<any[]>;
    export { search_1 as search };
    export function count_1(params: any): Promise<any>;
    export { count_1 as count };
    export function get_3(eventId: any): Promise<any>;
    export { get_3 as get };
    export function maxEventId(): Promise<any>;
}
export namespace alerts {
    export function list_5(): Promise<any[]>;
    export { list_5 as list };
    export function get_4(alertId: any): Promise<any>;
    export { get_4 as get };
    export function statuses(): Promise<any[]>;
    export function create_2(alert: any): Promise<any>;
    export { create_2 as create };
    export function update_2(alertId: any, alert: any): Promise<any>;
    export { update_2 as update };
    export function remove_3(alertId: any): Promise<any>;
    export { remove_3 as remove };
    export function enable(alertId: any): Promise<any>;
    export function disable(alertId: any): Promise<any>;
    export function info(alertId: any): Promise<any>;
    export function options(): Promise<any>;
}
export namespace server {
    function id(): Promise<any>;
    function version(): Promise<any>;
    function buildDate(): Promise<any>;
    function statusCode(): Promise<any>;
    function time(): Promise<any>;
    function timezone(): Promise<any>;
    function jvm(): Promise<any>;
    function about(): Promise<any>;
    function charsets(): Promise<any[]>;
    function settings(): Promise<any>;
    function setSettings(settings: any): Promise<any>;
    function updateSettings(): Promise<any>;
    function setUpdateSettings(settings: any): Promise<any>;
    function configuration(params: any): Promise<any>;
    function setConfiguration(config: any, deploy?: boolean, overwriteConfigMap?: boolean): Promise<any>;
    function testEmail(properties: any): Promise<any>;
    function generateGUID(): Promise<any>;
    function globalScripts(): Promise<any>;
    function setGlobalScripts(scripts: any): Promise<any>;
    function configurationMap(): Promise<any>;
    function setConfigurationMap(map: any): Promise<any>;
    function channelTags(): Promise<any[]>;
    function setChannelTags(tags: any): Promise<any>;
    function channelDependencies(): Promise<any[]>;
    function setChannelDependencies(deps: any): Promise<any>;
    function channelMetadata(): Promise<any>;
    function setChannelMetadata(metadata: any): Promise<any>;
    function resources(): Promise<any>;
    function setResources(resources: any): Promise<any>;
    function reloadResource(resourceId: any): Promise<any>;
    function databaseDrivers(): Promise<any[]>;
    function setDatabaseDrivers(drivers: any): Promise<any>;
    function passwordRequirements(): Promise<any>;
    function encryption(): Promise<any>;
    function licenseInfo(): Promise<any>;
    function protocolsAndCipherSuites(): Promise<any>;
    function rhinoLanguageVersion(): Promise<any>;
}
export namespace system {
    export function info_1(): Promise<any>;
    export { info_1 as info };
    export function stats(): Promise<any>;
}
export namespace codeTemplates {
    export function libraries(includeCodeTemplates?: boolean): Promise<any[]>;
    export function list_6(): Promise<any[]>;
    export { list_6 as list };
    export function get_5(id: any): Promise<any>;
    export { get_5 as get };
    export function update_3(id: any, codeTemplate: any): Promise<any>;
    export { update_3 as update };
    export function remove_4(id: any): Promise<any>;
    export { remove_4 as remove };
    export function updateLibraries(libraries: any): Promise<any>;
}
export namespace extensions {
    export function connectors(): Promise<any>;
    export function plugins(): Promise<any>;
    export function metadata(name: any): Promise<any>;
    export function isEnabled(name: any): Promise<any>;
    export function setEnabled_1(name: any, enabled: any): Promise<any>;
    export { setEnabled_1 as setEnabled };
    export function properties(name: any): Promise<any>;
    export function setProperties(name: any, properties: any): Promise<any>;
}
export namespace databaseTasks {
    export function list_7(): Promise<any>;
    export { list_7 as list };
    export function get_6(taskId: any): Promise<any>;
    export { get_6 as get };
    export function run(taskId: any): Promise<any>;
    export function cancel(taskId: any): Promise<any>;
}
declare namespace _default {
    export { get };
    export { post };
    export { put };
    export { del };
    export { getXml };
    export { postXml };
    export { putXml };
    export { asList };
    export { parseBody };
    export { onSessionExpired };
    export { auth };
    export { users };
    export { channels };
    export { channelGroups };
    export { status };
    export { statistics };
    export { engine };
    export { messages };
    export { events };
    export { alerts };
    export { server };
    export { system };
    export { codeTemplates };
    export { extensions };
    export { databaseTasks };
}
export default _default;
