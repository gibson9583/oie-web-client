import { h, modal, toast } from '@oie/web-ui';
import api from '@oie/web-api';

export type LifecycleAction = 'deploy' | 'start' | 'stop' | 'pause' | 'halt' | 'undeploy';

function shouldInclude(action: LifecycleAction, status: any): boolean {
    if (!status) return false;
    const state = String(status.state || '').toUpperCase();
    if (action === 'start') return state !== 'STARTED';
    if (action === 'stop') return state !== 'STOPPED';
    if (action === 'pause') return state !== 'PAUSED' && state !== 'STOPPED';
    return true;
}

export function expandLifecycleIds(action: Exclude<LifecycleAction, 'deploy'>, selectedIds: string[], statuses: any[], dependencies: any[]) {
    const selected = new Set(selectedIds.map(String));
    const expanded = new Set(selected);
    if (action === 'halt') return { ids: [...expanded], additional: [] as string[] };

    const statusById = new Map(statuses.map(status => [String(status.channelId), status]));
    const nextById = new Map<string, string[]>();
    for (const dependency of dependencies) {
        const dependent = String(dependency.dependentId);
        const prerequisite = String(dependency.dependencyId);
        const from = action === 'start' ? dependent : prerequisite;
        const to = action === 'start' ? prerequisite : dependent;
        const next = nextById.get(from) || [];
        next.push(to);
        nextById.set(from, next);
    }

    const visit = (id: string) => {
        for (const relatedId of nextById.get(id) || []) {
            if (expanded.has(relatedId) || !shouldInclude(action, statusById.get(relatedId))) continue;
            expanded.add(relatedId);
            visit(relatedId);
        }
    };
    for (const id of selected) visit(id);
    return { ids: [...expanded], additional: [...expanded].filter(id => !selected.has(id)) };
}

function expandDeployIds(selectedIds: string[], statuses: any[], dependencies: any[], channels: any[]) {
    const selected = new Set(selectedIds.map(String));
    const expanded = new Set(selected);
    const deployed = new Set(statuses.map(status => String(status.channelId)));
    const enabled = new Map(channels.map(channel => [String(channel.id), channel?.exportData?.metadata?.enabled !== false]));
    const prerequisites = new Map<string, string[]>();
    const dependents = new Map<string, string[]>();
    for (const dependency of dependencies) {
        const dependent = String(dependency.dependentId);
        const prerequisite = String(dependency.dependencyId);
        prerequisites.set(dependent, [...(prerequisites.get(dependent) || []), prerequisite]);
        dependents.set(prerequisite, [...(dependents.get(prerequisite) || []), dependent]);
    }
    const visit = (id: string) => {
        for (const dependent of dependents.get(id) || []) {
            if (!expanded.has(dependent) && enabled.get(dependent) && deployed.has(dependent)) {
                expanded.add(dependent);
                visit(dependent);
            }
        }
        for (const prerequisite of prerequisites.get(id) || []) {
            if (!expanded.has(prerequisite) && enabled.get(prerequisite)) {
                expanded.add(prerequisite);
                visit(prerequisite);
            }
        }
    };
    for (const id of selected) visit(id);
    return { ids: [...expanded], additional: [...expanded].filter(id => !selected.has(id)) };
}

function promptForRelated(action: LifecycleAction, ids: string[], statuses: any[], channels: any[]): Promise<'include' | 'selected' | null> {
    const names = new Map(channels.map(channel => [String(channel.id), channel.name || channel.id]));
    for (const status of statuses) names.set(String(status.channelId), status.name || status.channelId);
    return new Promise(resolve => modal({
        title: 'Channel dependencies',
        body: h('div',
            h('div.mb-2', `There ${ids.length === 1 ? 'is' : 'are'} ${ids.length} additional channel${ids.length === 1 ? '' : 's'} in the dependency chain:`),
            h('ul.pl-5', ids.map(id => h('li', names.get(id) || id)))),
        onClose: () => resolve(null),
        buttons: [
            { label: 'Cancel', onClick: () => resolve(null) },
            { label: 'Selected only', onClick: () => resolve('selected') },
            { label: `Include and ${action}`, primary: true, onClick: () => resolve('include') }
        ]
    }));
}

export async function runLifecycle(action: LifecycleAction, selectedIds: string[]): Promise<boolean> {
    if (!selectedIds.length) return false;
    if (action === 'halt') {
        await api.status.haltMany(selectedIds);
        return true;
    }

    // Re-read at click time: a poll or dependency edit may land while a menu is open.
    const [statuses, dependencies, channels] = await Promise.all([
        api.status.list(),
        api.server.channelDependencies(),
        action === 'deploy' ? api.channels.list() : Promise.resolve([])
    ]);
    let actionableIds = selectedIds.map(String);
    if (action === 'deploy') {
        const enabled = new Map(channels.map(channel => [String(channel.id), channel?.exportData?.metadata?.enabled !== false]));
        const disabled = actionableIds.filter(id => enabled.get(id) === false);
        if (disabled.length) toast('Disabled channels will not be deployed.', 'warn');
        actionableIds = actionableIds.filter(id => enabled.get(id) !== false);
        if (!actionableIds.length) return false;
    }

    const plan = action === 'deploy'
        ? expandDeployIds(actionableIds, statuses, dependencies, channels)
        : expandLifecycleIds(action, actionableIds, statuses, dependencies);
    let ids = actionableIds;
    if (plan.additional.length) {
        const choice = await promptForRelated(action, plan.additional, statuses, channels);
        if (!choice) return false;
        if (choice === 'include') ids = plan.ids;
    }

    if (action === 'deploy') await api.engine.deployMany(ids);
    else if (action === 'undeploy') await api.engine.undeployMany(ids);
    else if (action === 'start') {
        const statusById = new Map(statuses.map(status => [String(status.channelId), status]));
        const start = ids.filter(id => String(statusById.get(String(id))?.state || '').toUpperCase() !== 'PAUSED');
        const resume = ids.filter(id => String(statusById.get(String(id))?.state || '').toUpperCase() === 'PAUSED');
        if (start.length) await api.status.startMany(start);
        if (resume.length) await api.status.resumeMany(resume);
    } else {
        await (api.status as any)[`${action}Many`](ids);
    }
    return true;
}
