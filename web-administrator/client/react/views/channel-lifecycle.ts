/* Dependency expansion shared by every place that can deploy/undeploy/start/
   stop/pause a channel. The engine orders a submitted set, but it does not add
   related channels to that set; Swing's warning dialog does that client-side
   (Frame.addChannelToTaskSet / Frame.addChannelToDeploySet). */

import api from '@oie/web-api';
import { h, modal, toast } from '@oie/web-ui';
import { strictWireList } from '../../core/wire-safety.js';

/** The five tasks Swing expands. Halt is deliberately absent: it has no
    ChannelTask and no prompt — an escape hatch has no business widening its own
    blast radius. */
export type LifecycleTask = 'deploy' | 'undeploy' | 'start' | 'stop' | 'pause';

/* Which way each task walks the graph, and which related channels are worth
   offering. Swing offers a channel only when acting on it would DO something:
   a dependency that is already STARTED is not added to a start, a dependent that
   is not deployed is not added to a stop. Without that test the dialog fires on
   every action in any deployment that uses dependencies at all, and "Include"
   then submits ids the engine no-ops (ChannelStatusTask skips an undeployed
   channel), which trains people to dismiss it.

   `state` is the channel's deployed state, or undefined when it is not deployed.
   Swing also skips channels whose metadata says disabled. For the four status
   tasks that already falls out of the state test (a disabled channel is never
   deployed); deploy is the one task that walks into UNdeployed channels, so
   withDependencies filters its candidates by the enabled flag separately —
   Swing's addChannelToDeploySet check. */
const TASK_RULES: Record<LifecycleTask, {
    /** 'dependencies' = what the selection waits for; 'dependents' = what waits for it. */
    directions: Array<'dependencies' | 'dependents'>;
    offer: (direction: 'dependencies' | 'dependents', state: string | undefined) => boolean;
    /** How the dialog introduces the list. */
    lead: (n: number) => string;
}> = {
    /* Deploy walks BOTH ways: a redeploy has to carry the already-deployed
       channels that depend on this one, and the channels it depends on
       regardless of whether those are deployed yet. */
    deploy: {
        directions: ['dependents', 'dependencies'],
        offer: (direction, state) => direction === 'dependencies' || state !== undefined,
        lead: n => `The selected channel(s) are related to ${n} channel(s) that are not selected:`
    },
    undeploy: {
        directions: ['dependents'],
        offer: (_d, state) => state !== undefined,
        lead: n => `${n} deployed channel(s) not selected depend on the selected channel(s):`
    },
    start: {
        directions: ['dependencies'],
        offer: (_d, state) => state !== undefined && state !== 'STARTED',
        lead: n => `The selected channel(s) depend on ${n} channel(s) that are not selected and not started:`
    },
    stop: {
        directions: ['dependents'],
        offer: (_d, state) => state !== undefined && state !== 'STOPPED',
        lead: n => `${n} running channel(s) not selected depend on the selected channel(s):`
    },
    pause: {
        directions: ['dependents'],
        offer: (_d, state) => state !== undefined && state !== 'PAUSED' && state !== 'STOPPED',
        lead: n => `${n} running channel(s) not selected depend on the selected channel(s):`
    }
};

/* STRICT read of the global dependency set. asList would turn a malformed {}
   into [{}] — an "empty graph" that lets a lifecycle action proceed with no
   dependency knowledge at all, or lets a merge WIPE the server's real set. ''
   is the engine's genuine empty <set>; anything else must carry well-formed
   channelDependency entries or the read fails. */
export async function readChannelDependencies(): Promise<any[]> {
    const raw: any = await api.get('/server/channelDependencies');
    const list = strictWireList<any>(raw, 'channelDependency', 'channel dependency list');
    for (const dep of list) {
        if (!dep || typeof dep !== 'object' || !(dep as any).dependentId || !(dep as any).dependencyId) {
            throw new Error('the engine returned an unusable channel dependency list');
        }
    }
    return list;
}

/* Apply only the user's edge additions/removals to a fresh graph. Both editors
   keep a snapshot while a dialog/wizard is open, but setChannelDependencies
   replaces the COMPLETE server set; writing that old snapshot would erase
   unrelated work saved by another administrator in the meantime. */
export async function saveChannelDependencyEdits(initial: any[], desired: any[]): Promise<void> {
    const normalize = (dep: any) => ({
        dependentId: String(dep?.dependentId || ''),
        dependencyId: String(dep?.dependencyId || '')
    });
    const key = (dep: any) => `${dep.dependentId}|${dep.dependencyId}`;
    const valid = (dep: any) => dep.dependentId && dep.dependencyId && dep.dependentId !== dep.dependencyId;
    const before = new Map(initial.map(normalize).filter(valid).map(dep => [key(dep), dep]));
    const wanted = new Map(desired.map(normalize).filter(valid).map(dep => [key(dep), dep]));
    const fresh = await readChannelDependencies();
    const freshNormalized = fresh.map(normalize).filter(valid);
    const next = new Map(freshNormalized.map(dep => [key(dep), dep]));

    for (const edgeKey of before.keys()) if (!wanted.has(edgeKey)) next.delete(edgeKey);
    for (const [edgeKey, dep] of wanted) if (!before.has(edgeKey)) next.set(edgeKey, dep);

    const freshKeys = freshNormalized.map(key).sort().join('|');
    const nextValues = [...next.values()];
    const nextKeys = nextValues.map(key).sort().join('|');
    if (freshKeys === nextKeys) return;
    await api.server.setChannelDependencies(nextValues);
}

/* Adjacency for one direction. dependentId depends on dependencyId, so a start
   walks dependent -> dependency and a stop walks dependency -> dependent. */
function adjacency(deps: any[], direction: 'dependencies' | 'dependents') {
    const edges = new Map<string, string[]>();
    for (const dep of deps || []) {
        const from = String((direction === 'dependencies' ? dep.dependentId : dep.dependencyId) ?? '');
        const to = String((direction === 'dependencies' ? dep.dependencyId : dep.dependentId) ?? '');
        if (!from || !to || from === to) continue;
        if (!edges.has(from)) edges.set(from, []);
        edges.get(from)!.push(to);
    }
    return edges;
}

/* Related channels worth adding: one breadth-first walk from the selection that
   expands every direction the task uses at each node, descending only through
   channels that passed the offer test. Swing's addChannelToTaskSet /
   addChannelToDeploySet recurse the same way — a channel already in the target
   state is simply not recursed into, and deploy's two directions are explored
   from every node it reaches, not only from the original selection. */
function relatedChannelIds(
    ids: any[], deps: any[], stateOf: (id: string) => string | undefined, task: LifecycleTask,
    enabledOf: (id: string) => boolean = () => true
) {
    const rules = TASK_RULES[task];
    const edges = rules.directions.map(direction => [direction, adjacency(deps, direction)] as const);
    const seen = new Set(ids.map(String));
    const extra: string[] = [];
    const unknown = new Set<string>();
    const queue = ids.map(String);
    while (queue.length) {
        const from = queue.shift()!;
        for (const [direction, byId] of edges) {
            for (const next of byId.get(from) || []) {
                if (seen.has(next) || !enabledOf(next)) continue;
                // A node that fails the offer test is not offered AND not
                // recursed into — Swing only descends into channels it added.
                if (!rules.offer(direction, stateOf(next))) {
                    /* A related channel with NO status is not "safe to skip":
                       the status endpoint REDACTS channels this account cannot
                       see (it may be a real, live prerequisite), and a deleted
                       or undeployed one still breaks the chain. Reported so the
                       prompt can say it instead of silently thinning the
                       closure. (Deploy's dependencies direction deliberately
                       offers undeployed channels, so it never lands here.) */
                    if (stateOf(next) === undefined) unknown.add(next);
                    continue;
                }
                seen.add(next); extra.push(next); queue.push(next);
            }
        }
    }
    return { extra, unknown: [...unknown] };
}

/**
 * The channel ids a lifecycle action should act on: the selection, plus any
 * related channels the user chose to include. Returns null when the user
 * cancelled, or when the graph could not be read (the action must not proceed
 * unordered on a guess).
 *
 * `nameOf` labels the prompt; it falls back to the dashboard status name, then
 * the id, so a related channel that has no row on the calling screen still reads
 * as something.
 */
export async function withDependencies(
    ids: any[],
    task: LifecycleTask,
    verb: string,
    nameOf: (id: any) => any = () => '',
    confirmFinal?: (chosen: string[]) => Promise<boolean>
): Promise<string[] | null> {
    const base = ids.map(String);

    /* ONE computation of the whole offer — related channels (transitive,
       direction-per-task), unverifiable neighbors, and for deploy the enabled
       filter — run for the initial prompt AND AGAIN at submit time. Comparing
       the two complete results catches every kind of drift the same way: a
       relation added while the dialog sat open, a relation REMOVED (the user's
       Include no longer covers what it confirmed), and an enabled flag that
       flipped (deploy metadata is part of the offer, so it is re-read too).
       Throws when the graph or statuses cannot be read (fail closed); a deploy
       whose enabled flags cannot be read reports `blocked` instead — the
       selection itself stays deployable, the expansion does not. */
    type Offer = { extra: string[]; unknown: string[]; blocked: string; names: Map<string, string> };
    const computeOffer = async (): Promise<Offer> => {
        const [deps, statuses] = await Promise.all([readChannelDependencies(), api.status.list()]);
        const statusById = new Map<string, any>((statuses || []).map((s: any) => [String(s.channelId), s]));
        const stateOf = (id: string) => statusById.get(id)?.state;
        const names = new Map<string, string>((statuses || []).map((s: any) => [String(s.channelId), String(s.name || '')]));
        let { extra, unknown } = relatedChannelIds(base, deps, stateOf, task);
        let blocked = '';
        if (task === 'deploy' && extra.length) {
            /* Swing's deploy walker (Frame.addChannelToDeploySet) skips channels
               whose metadata says disabled — and everything reachable only
               THROUGH them: the walk stops at a disabled node. The flags DEFINE
               the closure. When they cannot all be read, the correct expanded
               set is unknowable and expansion is withheld (no "Include"). */
            try {
                const records = await api.channels.list(extra);
                const byId = new Map((records || []).map((c: any) => [String(c && c.id), c]));
                const missing = extra.filter(id => !byId.has(id));
                if (missing.length) throw new Error(`no channel record for ${missing.join(', ')}`);
                const disabled = new Set<string>();
                for (const id of extra) {
                    // STRICT: the flag must be an explicit true/false. A record
                    // that exists but carries no readable flag must not default
                    // to "enabled" — that is the fail-open this exists to stop.
                    const flag = String(byId.get(id)?.exportData?.metadata?.enabled);
                    if (flag === 'false') disabled.add(id);
                    else if (flag !== 'true') throw new Error(`channel ${id} has no readable enabled flag`);
                }
                if (disabled.size) {
                    const rewalk = relatedChannelIds(base, deps, stateOf, task, id => !disabled.has(id));
                    extra = rewalk.extra;
                    unknown = rewalk.unknown;
                }
            } catch (e: any) {
                blocked = `Could not verify which of these channels are enabled (${e?.message || e}). `
                    + 'A disabled channel also keeps everything that depends on it through the walk out of a '
                    + 'deploy, so the related channels cannot be safely included until the lookup succeeds.';
            }
        }
        return { extra, unknown, blocked, names };
    };
    // What the user confirmed is this shape; ANY difference at submit time
    // invalidates the confirmation. Names are labels, not part of the shape.
    const signature = (offer: Offer) => JSON.stringify({
        extra: [...offer.extra].sort(),
        unknown: [...offer.unknown].sort(),
        blocked: !!offer.blocked
    });

    let initial: Offer;
    try {
        initial = await computeOffer();
    } catch (e: any) {
        toast(`${verb} cancelled — channel dependencies could not be loaded: ${e?.message || e}`, 'error');
        return null;
    }

    const finish = async (chosen: string[]): Promise<string[] | null> => {
        let second: Offer;
        try {
            second = await computeOffer();
        } catch (e: any) {
            toast(`${verb} cancelled — channel dependencies could not be re-read: ${e?.message || e}`, 'error');
            return null;
        }
        if (signature(second) !== signature(initial)) {
            toast(`${verb} cancelled — the channel dependencies changed while confirming. Retry to see the current graph.`, 'error');
            return null;
        }
        return chosen;
    };

    const { extra, unknown, blocked: expansionBlocked } = initial;
    if (!extra.length && !unknown.length) {
        if (confirmFinal && !(await confirmFinal(base))) return null;
        return finish(base);
    }

    const label = (id: string) => String(nameOf(id) || initial.names.get(id) || id);
    const unknownNote = unknown.length
        ? `${unknown.length} related channel(s) could not be verified — not deployed, deleted, or not `
        + `visible to your account — and are NOT included: ${unknown.map(label).join(', ')}. `
        + `The engine may leave them behind.`
        : '';
    const chosen: string[] | null = await new Promise((resolve: any) => {
        modal({
            title: 'Channel Dependencies',
            body: h('div',
                h('div.mb-[13px]', extra.length
                    ? TASK_RULES[task].lead(extra.length)
                    : `The selected channel(s) are related to channels this ${verb.toLowerCase()} cannot verify:`),
                extra.length
                    ? h('ul', { class: 'mb-[13px] pl-[18px] list-disc max-h-[180px] overflow-auto' },
                        extra.map((id: string) => h('li', label(id))))
                    : null,
                unknownNote ? h('div.mb-[13px]', { style: 'color: var(--warn)' }, unknownNote) : null,
                expansionBlocked
                    ? h('div.mb-[13px]', { style: 'color: var(--warn)' }, expansionBlocked)
                    : h('div', extra.length
                        ? `Include them in the ${verb.toLowerCase()}?`
                        : `Continue with the selected channel(s) only?`)),
            onClose: () => resolve(null),
            buttons: !extra.length
                ? [
                    { label: 'Cancel', onClick: () => { resolve(null); } },
                    { label: 'Continue', primary: true, onClick: () => { resolve(base); } }
                ]
                : expansionBlocked
                    ? [
                        { label: 'Cancel', onClick: () => { resolve(null); } },
                        { label: 'Selected Only', primary: true, onClick: () => { resolve(base); } }
                    ]
                    : [
                        { label: 'Cancel', onClick: () => { resolve(null); } },
                        { label: 'Selected Only', onClick: () => { resolve(base); } },
                        { label: 'Include', primary: true, onClick: () => { resolve([...base, ...extra]); } }
                    ]
        });
    });
    if (!chosen) return null;
    /* The caller's own final confirmation (e.g. "Undeploy N channel(s)?") is
       MORE open-ended user time — it has to sit inside this boundary so the
       offer recomputation runs after the LAST dialog, not before it. */
    if (confirmFinal && !(await confirmFinal(chosen))) return null;
    return finish(chosen);
}

/* Deploy/undeploy has the same authorization trap as the status lifecycle
   endpoints: the bulk servlet silently removes ids the user may no longer act
   on and still returns success. Preserve the engine's dependency ordering for
   a real set, but use the addressable endpoint for one id (it performs the
   channel authorization check) and verify every bulk result.

   Swing builds the submitted set from typed Channel objects in its authorized
   channel cache, then refreshes after the engine call. The web action may sit
   behind more user confirmation, so reproduce that identity guarantee at
   ACTION time: read every requested channel through its addressable endpoint
   before the bulk call, then read every result through its authorization-
   enforcing addressable status endpoint. Do not use the filtered status-list
   endpoint as an authorization check. If all submitted ids are redacted, that
   servlet passes an empty set to DonkeyEngineController, where empty means "all
   channels"; an already-deployed redacted set can therefore look fully
   successful even though EngineServlet discarded the entire request. */
export type DeploymentTask = 'deploy' | 'undeploy';

const DEPLOYED_STATES = new Set(['STARTED', 'PAUSED', 'STOPPED']);

async function verifyDeploymentChannels(requested: string[], action: DeploymentTask) {
    const checks = await Promise.all(requested.map(async id => {
        try {
            const channel: any = await api.channels.get(id);
            return channel && typeof channel === 'object' && String(channel.id ?? '') === id
                ? null
                : id;
        } catch {
            return id;
        }
    }));
    const unverified = checks.filter((id): id is string => id !== null);
    if (!unverified.length) return;

    throw new Error(`the bulk ${action} request was not submitted because no trustworthy authorized channel record was returned for ${unverified.join(', ')} — a channel may be unauthorized or deleted; check current status before retrying`);
}

async function verifyDeploymentResults(requested: string[], action: DeploymentTask) {
    const checks = await Promise.all(requested.map(async id => {
        try {
            /* Unlike the collection endpoint, this servlet carries
               @CheckAuthorizedChannelId, so state and authorization are checked
               atomically for a deploy result. */
            const status: any = await api.status.one(id);
            if (String(status?.channelId ?? '') !== id) return id;
            if (action === 'deploy' && DEPLOYED_STATES.has(String(status?.state ?? ''))) return null;
            // Be tolerant of an engine version that materializes undeployed
            // status here; current OIE normally answers 404 instead.
            if (action === 'undeploy' && String(status?.state ?? '') === 'UNDEPLOYED') return null;
            return id;
        } catch (e: any) {
            if (action !== 'undeploy' || e?.status !== 404) return id;

            /* For an authorized undeployed channel the addressable status
               endpoint returns 404. Prove the channel itself still exists and
               is visible so a deleted/redacted channel cannot masquerade as a
               successful undeploy. */
            try {
                const channel: any = await api.channels.get(id);
                return channel && typeof channel === 'object' && String(channel.id ?? '') === id
                    ? null
                    : id;
            } catch {
                return id;
            }
        }
    }));
    const unconfirmed = checks.filter((id): id is string => id !== null);
    if (unconfirmed.length) {
        throw new Error(`the engine did not confirm ${action} for ${unconfirmed.join(', ')} — the operation may be partial because a channel was unauthorized, deleted, or changed state; check current status before retrying`);
    }
}

export async function submitDeployment(action: DeploymentTask, ids: any[]) {
    const requested = [...new Set(ids.map(String))];
    if (!requested.length) return;

    // The addressable servlet has @CheckAuthorizedChannelId; the collection
    // servlet does not, even when its submitted set happens to contain one id.
    if (requested.length === 1) {
        if (action === 'deploy') await api.engine.deploy(requested[0], true);
        else await api.engine.undeploy(requested[0], true);
        return;
    }

    await verifyDeploymentChannels(requested, action);

    if (action === 'deploy') await api.engine.deployMany(requested, true);
    else await api.engine.undeployMany(requested, true);

    // A permission may be revoked after the preflight but before EngineServlet
    // applies its silent redaction. Addressable status checks make that
    // authorization decision part of each result read; the collection endpoint
    // cannot safely provide this guarantee when every id is redacted.
    await verifyDeploymentResults(requested, action);
}

/* "Start" over a selection that may mix STOPPED and PAUSED channels.

   Start must be expressed as TWO engine operations — _start no-ops a PAUSED
   channel (donkey Channel.start acts only on STOPPED/DEPLOYING; only _resume
   restarts its source) — and the engine dependency-orders within one request,
   never across two. So any fixed batch order is wrong in one direction:
   start-then-resume runs a stopped dependent before the paused dependency it
   waits for; resume-then-start breaks the mirror case.

   Rules this enforces, all fail-closed:
   - Classification is ACTION-time truth: the channels' states are re-read here
     (one filtered statuses call), not taken from the render-time poll — a
     dependency that moved STOPPED -> PAUSED since the table drew would be sent
     _start, which the engine no-ops, while its dependent starts anyway.
   - An unmixed selection stays ONE bulk request, which the engine orders best.
     A genuinely mixed one is tiered by the same graph the engine uses (Kahn
     levels, dependencies first) and submitted tier by tier; one tier's members
     have no edges between each other by construction.
   - `submit` must REJECT on failure. A failed batch ABORTS every later tier —
     those channels' prerequisites never reached their state, and submitting
     them anyway recreates the ordering bug this exists to prevent — and the
     error propagates with the skipped count for the caller to surface. */
export async function submitStartResume(
    ids: any[],
    submit: (action: 'start' | 'resume', ids: string[]) => Promise<any>
) {
    const all = ids.map(String);

    let fresh: any[];
    try {
        fresh = await api.status.list(all, undefined, true);
    } catch (e: any) {
        throw new Error(`channel states could not be read: ${e?.message || e}`);
    }
    /* Fail CLOSED on anything but a clean STOPPED/PAUSED/STARTED answer for
       EVERY requested id. A missing entry (deleted between the dependency
       prompt and this submit), a duplicate, or a transitional/undeployed state
       means the correct operation set is unknowable — classifying blind would
       send _start for a prerequisite the engine no-ops and then release its
       dependents anyway. */
    const allSet = new Set(all);
    const stateOf = new Map<string, string>();
    for (const s of fresh || []) {
        const id = String(s?.channelId ?? '');
        if (!allSet.has(id)) continue;
        if (stateOf.has(id)) throw new Error(`the engine reported channel ${id} more than once — nothing was submitted`);
        stateOf.set(id, String(s?.state ?? ''));
    }
    const paused = new Set<string>();
    const ready: string[] = [];
    for (const id of all) {
        const state = stateOf.get(id);
        if (state === undefined) throw new Error(`channel ${id} is not deployed or no longer exists — nothing was submitted`);
        if (state === 'PAUSED') { paused.add(id); ready.push(id); }
        else if (state === 'STOPPED') ready.push(id);
        // STARTED is already the target state: nothing to do for it. Anything
        // else (STARTING, STOPPING, PAUSING, UNDEPLOYED, …) is not a state this
        // can act on deterministically.
        else if (state !== 'STARTED') throw new Error(`channel ${id} is ${state} — nothing was submitted; retry when it settles`);
    }
    if (!ready.length) return;
    const stopped = ready.filter(id => !paused.has(id));
    const pausedIds = ready.filter(id => paused.has(id));
    if (!pausedIds.length || !stopped.length) {
        if (stopped.length) await submit('start', stopped);
        else if (pausedIds.length) await submit('resume', pausedIds);
        return;
    }

    let deps: any[];
    try {
        deps = await readChannelDependencies();
    } catch (e: any) {
        throw new Error(`channel dependencies could not be loaded: ${e?.message || e}`);
    }
    // dependent -> its dependencies, restricted to the submitted set.
    const inSet = new Set(ready);
    const depsOf = new Map<string, Set<string>>();
    for (const dep of deps || []) {
        const dependent = String(dep?.dependentId ?? '');
        const dependency = String(dep?.dependencyId ?? '');
        if (!dependent || !dependency || dependent === dependency) continue;
        if (!inSet.has(dependent) || !inSet.has(dependency)) continue;
        if (!depsOf.has(dependent)) depsOf.set(dependent, new Set());
        depsOf.get(dependent)!.add(dependency);
    }

    const placed = new Set<string>();
    let remaining = ready;
    while (remaining.length) {
        let tier = remaining.filter(id => [...(depsOf.get(id) || [])].every(d => placed.has(d)));
        // The engine rejects cyclic dependency sets at the PUT, so an empty tier
        // should be impossible — but never spin on hostile data: flush the rest.
        if (!tier.length) tier = remaining;
        const start = tier.filter(id => !paused.has(id));
        const resume = tier.filter(id => paused.has(id));
        for (const id of tier) placed.add(id);
        remaining = remaining.filter(id => !placed.has(id));
        try {
            if (start.length) await submit('start', start);
            if (resume.length) await submit('resume', resume);
        } catch (e: any) {
            throw remaining.length
                ? new Error(`${e?.message || e} — ${remaining.length} dependent channel(s) were not submitted because a prerequisite failed`)
                : e;
        }
    }
}
