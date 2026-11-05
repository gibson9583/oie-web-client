interface ActionTarget {
    name?: string;
    id?: string;
    channelId?: string;
}

/** Name every submitted target; never hide a bulk action's scope behind a count. */
export function describeTargets(noun: string, targets: readonly ActionTarget[]): string {
    const names = targets.map(target => target.name || target.id || target.channelId || '(unnamed)');
    const counts = new Map<string, number>();
    for (const name of names) counts.set(name, (counts.get(name) || 0) + 1);
    const labels = targets.map((target, index) => {
        const name = names[index];
        const id = target.id || target.channelId;
        return `"${name}"${id && counts.get(name)! > 1 ? ` (${id})` : ''}`;
    });
    return `${targets.length === 1 ? noun : `${targets.length} ${noun}s`} ${labels.join(', ')}`;
}
