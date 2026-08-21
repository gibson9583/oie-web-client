/* Dependency expansion shared by every place that can deploy/start/stop a
   channel. The engine orders a submitted set, but it does not add related
   channels to that set; Swing's warning dialog does that client-side. */

import api from '@oie/web-api';
import { h, modal } from '@oie/web-ui';

async function relatedChannelIds(ids: any, direction: any) {
    let deps: any[];
    // Dependency data is advisory. A failed read must not block the action the
    // user actually asked for, so fall back to "nothing related".
    try { deps = await api.server.channelDependencies(); } catch { return []; }
    const edges = new Map();
    for (const dep of deps || []) {
        const from = String((direction === 'dependencies' ? dep.dependentId : dep.dependencyId) ?? '');
        const to = String((direction === 'dependencies' ? dep.dependencyId : dep.dependentId) ?? '');
        if (!from || !to || from === to) continue;
        if (!edges.has(from)) edges.set(from, []);
        edges.get(from).push(to);
    }
    const seen = new Set(ids.map(String));
    const queue = [...seen];
    const extra: any[] = [];
    while (queue.length) {
        for (const next of edges.get(queue.shift()) || []) {
            if (seen.has(next)) continue;
            seen.add(next); extra.push(next); queue.push(next);
        }
    }
    return extra;
}

export async function withDependencies(
    ids: any,
    direction: any,
    verb: any,
    nameOf: any = (id: any) => id
) {
    const extra = await relatedChannelIds(ids, direction);
    if (!extra.length) return ids;
    const lead = direction === 'dependencies'
        ? `The selected channel(s) depend on ${extra.length} channel(s) that are not selected:`
        : `${extra.length} channel(s) not selected depend on the selected channel(s):`;
    return new Promise((resolve: any) => {
        modal({
            title: 'Channel Dependencies',
            body: h('div',
                h('div.mb-[13px]', lead),
                h('ul', { class: 'mb-[13px] pl-[18px] list-disc max-h-[180px] overflow-auto' },
                    extra.map((id: any) => h('li', nameOf(id)))),
                h('div', `Include them in the ${verb.toLowerCase()}?`)),
            onClose: () => resolve(null),
            buttons: [
                { label: 'Cancel', onClick: () => { resolve(null); } },
                { label: 'Selected Only', onClick: () => { resolve(ids); } },
                { label: 'Include', primary: true, onClick: () => { resolve([...ids, ...extra]); } }
            ]
        });
    });
}
