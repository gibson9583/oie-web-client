import { useEffect, useMemo, useState } from 'react';
import api from '@oie/web-api';
import { channelDependencyState, copyDependencySelection, copyLibrarySelection, dependencySelection, hasDependencyChanges, hasLibraryChanges, librarySelection, refreshDependencyChoices, refreshLibraryChoices } from '../../core/channel-dependencies.js';
import { captureEngineSession } from '../../core/engine-fetch.js';
import { destinationsOf } from '../../core/oie.js';
import { mappingEntries } from '../../core/xstream.js';

type ReadState<T> = { state: 'loading' | 'ready' | 'denied' | 'error'; value: T };
type Reads = { libraries: ReadState<any[]>; dependencies: ReadState<any[]>; resources: ReadState<any[]>; names: ReadState<Map<string, string>> };
const loading = (): Reads => ({ libraries: { state: 'loading', value: [] }, dependencies: { state: 'loading', value: [] }, resources: { state: 'loading', value: [] }, names: { state: 'loading', value: new Map() } });

/** Independent reads: a denied resource catalog must not hide channel dependencies.
 * Print receives this same snapshot and never performs a second set of requests. */
export function useInspectorDependencies(channel: any, revision: number, refresh: number, readOnly: boolean) {
    const [snapshot, setSnapshot] = useState(() => ({ channel, reads: loading() }));
    useEffect(() => {
        let alive = true;
        setSnapshot({ channel, reads: loading() });
        const read = <K extends keyof Reads>(key: K, load: () => Promise<Reads[K]['value']>) => {
            Promise.resolve().then(async () => {
                const assertSession = captureEngineSession();
                const value = await load();
                assertSession();
                if (alive) setSnapshot(previous => ({ channel, reads: { ...previous.reads, [key]: { state: 'ready', value } } }));
            }).catch(error => {
                if (alive) setSnapshot(previous => ({ channel, reads: { ...previous.reads, [key]: { ...loading()[key], state: error?.status === 403 ? 'denied' : 'error' } } }));
            });
        };
        read('libraries', () => api.codeTemplates.libraries(true));
        read('dependencies', () => api.server.channelDependencies());
        read('resources', async () => {
            const raw: any = await api.server.resources();
            const result: any[] = [];
            const list = raw?.list ?? raw;
            if (list && typeof list === 'object') for (const [key, value] of Object.entries(list)) {
                if (!key.startsWith('@')) for (const item of api.asList(value)) if (item?.id) result.push(item);
            }
            return result;
        });
        read('names', async () => {
            const raw: any = await api.channels.idsAndNames();
            return new Map(api.asList(raw?.entry).map(entry => {
                const [id, name] = api.asList(entry?.string);
                return [String(id), String(name ?? id)];
            }));
        });
        return () => { alive = false; };
    }, [channel, refresh]);

    // Read staged selections on every editor revision, without updating the
    // editor's pending state. Refresh only a copy to preserve local intent.
    return useMemo(() => {
        const reads = snapshot.channel === channel ? snapshot.reads : loading();
        const pending = readOnly ? null : channelDependencyState(channel);
        const libraries = pending?.libraries.current ? copyLibrarySelection(pending.libraries.current) : librarySelection(reads.libraries.value, channel.id);
        if (reads.libraries.state === 'ready') refreshLibraryChoices(libraries, reads.libraries.value, channel.id);
        const dependencies = pending?.dependencies.current ? copyDependencySelection(pending.dependencies.current) : dependencySelection(reads.dependencies.value);
        if (reads.dependencies.state === 'ready') refreshDependencyChoices(dependencies, reads.dependencies.value);
        return { reads, libraries, dependencies, pending: hasLibraryChanges(libraries) || hasDependencyChanges(dependencies) };
        // The editor's channel and pending selections are mutable drafts.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [channel, revision, readOnly, snapshot]);
}

export function InspectorDependencies({ channel, context, query, print, retry }: {
    channel: any; context: ReturnType<typeof useInspectorDependencies>; query: string; print?: boolean; retry(): void;
}) {
    const { reads, libraries, dependencies } = context;
    const hit = (value: string) => !!query && value.toLowerCase().includes(query);
    const facts = (rows: [string, string][]) => <dl className="ci-facts">{rows.map(([label, value], i) => <div key={i} className={'ci-fact' + (hit(label + ' ' + value) ? ' hit' : '')} data-hit={hit(label + ' ' + value) || undefined}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
    const status = (label: string, state: ReadState<unknown>['state']) => state === 'ready' ? null : <p className="ci-from" role={print ? undefined : 'status'}>
        {state === 'loading' ? `Loading ${label}…` : state === 'denied' ? `${label} unavailable with your permissions.` : `${label} could not be loaded.`}
        {state === 'error' && !print && <> <button type="button" className="ci-link" onClick={retry}>Retry {label}</button></>}
    </p>;
    const selected = libraries.libraries.filter((lib: any) => libraries.checked.get(lib.id));
    const channelLabel = (id: string) => reads.names.value.has(id) ? `${reads.names.value.get(id)} (${id})` : id;
    const before = dependencies.all.filter((edge: any) => edge.dependentId === channel.id).map((edge: any) => channelLabel(edge.dependencyId));
    const after = dependencies.all.filter((edge: any) => edge.dependencyId === channel.id).map((edge: any) => channelLabel(edge.dependentId));
    const resources = new Map(reads.resources.value.map(resource => [String(resource.id), resource]));
    const resourceTargets = [
        { label: 'Channel scripts · includes attachment, batch and response transformers', properties: channel.properties },
        { label: 'Source · receiver, filter and transformer', properties: channel.sourceConnector?.properties?.sourceConnectorProperties },
        ...destinationsOf(channel).map((destination: any) => ({ label: `D${destination.metaDataId} ${destination.name} · filter, transformer and dispatcher${destination.enabled === false || destination.enabled === 'false' ? ' · disabled' : ''}`, properties: destination.properties?.destinationConnectorProperties }))
    ];
    return <>
        <p className="ci-lead">Library selections supply code templates to channel scripts. Channel dependencies control deploy/start order. Resource selections supply Java libraries to the indicated contexts.</p>
        {context.pending && <p className="ci-callout">Includes pending library or channel dependency selections from this editor.</p>}
        <div className="ci-sub-head">Code template libraries</div>
        {status('Code template libraries', reads.libraries.state)}
        {selected.map((library: any) => <div key={library.id}>
            {facts([['Library', `${library.name || library.id} (${library.id})${reads.libraries.state === 'ready' && !reads.libraries.value.some(item => item.id === library.id) ? ' · no longer available on the server' : ''}`],
                ...(library.description ? [['Description', String(library.description)] as [string, string]] : []),
                ...api.asList(library.codeTemplates, 'codeTemplate').flatMap((template: any): [string, string][] => {
                    const type = template.properties?.type;
                    const contexts = api.asList(template.contextSet?.delegate, 'contextType').map(String);
                    return [['Template', String(template.name || template.id)],
                        ...(type ? [['Template type', type === 'DRAG_AND_DROP_CODE' ? 'Drag and drop code · not automatically added to scripts' : String(type).replaceAll('_', ' ').toLowerCase()] as [string, string]] : []),
                        ['Execution contexts', contexts.length ? contexts.map(value => value.replaceAll('_', ' ').toLowerCase()).join(', ') : template.contextSet ? 'None selected' : 'Not specified']];
                })])}
        </div>)}
        {!selected.length && reads.libraries.state === 'ready' && <p className="ci-none">No code template libraries selected.</p>}
        {selected.length > 0 && <p className="ci-from">Template names identify library members; template type and context determine availability. Bodies and calls are not expanded.</p>}
        <div className="ci-sub-head">Deploy/start dependencies</div>
        {status('Channel dependencies', reads.dependencies.state)}
        {before.length > 0 && facts(before.map((name: string) => ['Deploy/start this channel after', name]))}
        {after.length > 0 && facts(after.map((name: string) => ['Deploy/start this channel before', name]))}
        {!before.length && !after.length && reads.dependencies.state === 'ready' && <p className="ci-none">No direct channel dependencies.</p>}
        {reads.names.state !== 'ready' && (before.length > 0 || after.length > 0) && <p className="ci-from">Channel names unavailable; channel IDs are shown.</p>}
        <div className="ci-sub-head">Library resources</div>
        {status('Resource details', reads.resources.state)}
        {resourceTargets.map(({ label, properties }) => {
            const selectedResources = mappingEntries(properties?.resourceIds);
            return <div key={label}>{facts([[label, selectedResources.length ? selectedResources.map(([id, savedName]) => {
                const resource = resources.get(id);
                const name = resource?.name || savedName || id;
                return `${name}${name === id ? '' : ` (${id})`}${resource?.type ? ' · ' + resource.type : ''}${resource?.directory ? ' · ' + resource.directory : ''}${id !== 'Default Resource' && reads.resources.state === 'ready' && !resource ? ' · unavailable on the server' : ''}`;
            }).join('\n') : 'None selected']])}</div>;
        })}
    </>;
}
