/*
 * Channel Inspector — the editor's read-only Inspector tab. Describes the
 * working channel in the order the engine runs it: deploy, each message,
 * after processing. It never changes the channel.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import api from '@oie/web-api';
import { inspectChannel } from '../../core/channel-inspector.js';
import type { ChannelInspection, Fact, InspectedDestination, InspectedElement, MapKey } from '../../core/channel-inspector.js';
import { parseGlobalScripts } from '../../core/global-scripts.js';
import { connectorIcon } from '../../core/icons.js';
import { platform } from '@oie/web-shell';
import { dataTypeDef } from '../../datatypes/index.js';
import { Icon } from '../bridges.jsx';

type OpenTab = (tab: 'Summary' | 'Source' | 'Destinations' | 'Scripts') => void;

interface Section { id: string; phase: string; num?: number; icon?: string; title: string; scope: string; empty?: boolean; tab?: Parameters<OpenTab>[0]; body: React.ReactNode; children?: { id: string; label: string; name: string; off: boolean }[] }

const PHASES: Record<string, [string, string]> = {
    deploy: ['deploy', 'At deploy'],
    message: ['messages', 'For each message'],
    after: ['clock', 'After processing'],
    ref: ['tag', 'Reference']
};

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const typeLabel = (name: string) => (name ? dataTypeDef(name)?.label ?? name : 'Unknown');
const keyText = (k: MapKey) => `${k.map}.${k.key}`;
const LONG_SCRIPT = 14;

function searchText(el: InspectedElement) {
    return [el.name, el.typeLabel, el.detail, ...el.reads.map(keyText), ...el.writes.map(keyText)].join(' ').toLowerCase();
}

function stepGlyph(el: InspectedElement): [string, string] {
    if (el.isScript) return ['code', 'script'];
    switch (el.typeLabel) {
        case 'Mapper': return ['tag', 'mapping'];
        case 'Message Builder': return ['edit', 'builder'];
        case 'Iterator': return ['refresh', 'iterator'];
        case 'Rule Builder': return ['filter', 'mapping'];
        case 'Template': return ['file', ''];
        case 'SQL': return ['db', ''];
        default: return ['puzzle', ''];
    }
}

/* ---- small pieces ---------------------------------------------------------------- */

function Description({ text, print = false }: { text: string; print?: boolean }) {
    const Heading = print ? 'h2' : 'h3';
    return (
        <section className={'ci-description' + (print ? ' ci-print-description' : '')} aria-label="Description">
            <Heading className="ci-description-title"><Icon name="file" size={14} />Description</Heading>
            <p className={'ci-desc' + (text ? '' : ' dim')}>{text || 'No description. Add one on the Summary tab.'}</p>
        </section>
    );
}

function Facts({ facts, query }: { facts: Fact[]; query: string }) {
    if (!facts.length) return null;
    return (
        <dl className="ci-facts">
            {facts.map(([k, v]) => {
                const hit = !!query && `${k} ${v}`.toLowerCase().includes(query);
                return <div key={k} className={'ci-fact' + (hit ? ' hit' : '')} data-hit={hit || undefined}><dt>{k}</dt><dd>{v || '—'}</dd></div>;
            })}
        </dl>
    );
}

function Code({ text, print = false }: { text: string; print?: boolean }) {
    const lines = text.split(/\r\n|\r|\n/);
    const long = lines.length > LONG_SCRIPT;
    const [full, setFull] = useState(false);
    return (
        <div>
            <pre className={'ci-code' + (long && !full && !print ? ' long' : '')} tabIndex={print ? undefined : 0}>
                {lines.map((line, i) => <span className="ci-code-row" key={i}><span className="ln" aria-hidden="true">{i + 1}</span><span className="lc">{line || ' '}</span></span>)}
            </pre>
            {long && !print && (
                <div className="ci-code-foot">
                    <span>{plural(lines.length, 'line')} · read only</span>
                    <button type="button" className="ci-link" onClick={() => setFull(!full)}>{full ? 'Show less' : 'Show full script'}</button>
                </div>
            )}
        </div>
    );
}

interface ListCtx { open: Set<string>; setOpen(id: string, open: boolean): void; query: string; onKey(k: MapKey): void; keys: Set<string>; print?: boolean }

function ElementRow({ el, index, ctx }: { el: InspectedElement; index: number; ctx: ListCtx }) {
    const [glyph, style] = stepGlyph(el);
    const hit = !!ctx.query && searchText(el).includes(ctx.query);
    const lines = el.isScript ? el.detail.split(/\r\n|\r|\n/).length : 0;
    const chip = (k: MapKey, write: boolean) => (
        <button type="button" key={(write ? 'w:' : 'r:') + keyText(k)} className={'ci-key' + (write ? ' w' : '')}
            disabled={!ctx.keys.has(keyText(k))}
            title={`${write ? 'Writes' : 'Reads'} ${keyText(k)}`}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); ctx.onKey(k); }}>
            <i>{write ? 'writes' : 'reads'}</i> {k.key}
        </button>
    );
    const heading = <>
                    {!ctx.print && <span className="ci-chev"><Icon name="chevR" size={13} /></span>}
                    <span className="ci-order">{index + 1}</span>
                    {el.operator && <span className="ci-op">{el.operator}</span>}
                    <span className={'ci-glyph ' + style} title={el.typeLabel}><Icon name={glyph} size={13} /></span>
                    <span className="ci-name">{el.name}</span>
                    <span className="ci-type">{el.typeLabel}{el.isScript ? ` · ${plural(lines, 'line')}` : ''}</span>
                    <span className="ci-tail">
                        {el.reads.map(k => <span key={'r:' + keyText(k)} className="ci-key"><i>reads</i> {k.key}</span>)}
                        {el.writes.map(k => <span key={'w:' + keyText(k)} className="ci-key w"><i>writes</i> {k.key}</span>)}
                        {!el.enabled && <span className="tag">{el.skippedByParent ? 'Iterator disabled · skipped' : 'Disabled · skipped'}</span>}
                        {el.routing && <span className="tag amber">Can change destinations</span>}
                    </span>
                </>;
    const body = <div className="ci-item-body">
        {!ctx.print && (el.reads.length > 0 || el.writes.length > 0) && <div className="ci-key-links" aria-label="Map references">{el.reads.map(k => chip(k, false))}{el.writes.map(k => chip(k, true))}</div>}
        {el.isScript ? <Code text={el.detail} print={ctx.print} /> : <pre className="ci-expr" tabIndex={!ctx.print && el.type === 'template' ? 0 : undefined}>{el.detail}</pre>}
    </div>;
    const classes = 'ci-item' + (el.enabled ? '' : ' off') + (hit ? ' hit' : '');
    return (
        <li className={'ci-item-li' + (el.depth ? ' child' : '')} style={el.depth ? { ['--ci-depth' as any]: el.depth } : undefined}>
            {ctx.print ? <div id={'print-' + el.id} className={classes}><div className="ci-item-heading">{heading}</div>{body}</div>
                : <details id={el.id} className={classes} data-hit={hit || undefined} open={ctx.open.has(el.id)}
                    onToggle={e => { const value = e.currentTarget.open; if (value !== ctx.open.has(el.id)) ctx.setOpen(el.id, value); }}>
                    <summary>{heading}</summary>{body}
                </details>}
        </li>
    );
}

function More({ title, children, print, className = '' }: { title: React.ReactNode; children: React.ReactNode; print?: boolean; className?: string }) {
    return print ? <section className={'ci-more ' + className}><h4 className="ci-more-title">{title}</h4>{children}</section>
        : <details className={'ci-more ' + className}><summary><Icon name="chevR" size={13} />{title}</summary>{children}</details>;
}

function Elements({ list, kind, ctx }: { list: InspectedElement[]; kind: 'rule' | 'step' | 'script'; ctx: ListCtx }) {
    if (!list.length) return <p className="ci-none">No {kind}s configured.</p>;
    // Number siblings the way the filter/transformer editor does: per level.
    const counters: number[] = [];
    return (
        <ol className="ci-items">
            {list.map(el => {
                counters.length = el.depth + 1;
                counters[el.depth] = (counters[el.depth] ?? -1) + 1;
                return <ElementRow key={el.id} el={el} index={counters[el.depth]} ctx={ctx} />;
            })}
        </ol>
    );
}

function DataTypeFacts({ name, props, query }: { name: string; props: any; query: string }) {
    const def: any = name ? dataTypeDef(name) : null;
    if (!def || !props) return <p className="ci-none">No properties.</p>;
    const facts: Fact[] = [];
    for (const group of def.groups || []) {
        const values = props[group.key];
        if (!values || typeof values !== 'object') continue;
        for (const field of group.fields || []) {
            let v = values[field.key];
            if (v == null || v === '') continue;
            if (field.type === 'checkbox') v = String(v) === 'true' ? 'Yes' : 'No';
            else if (typeof v === 'object') v = api.asList(v.string ?? v.int ?? v).join(', ');
            facts.push([`${group.label} · ${field.label}`, String(v)]);
        }
    }
    return facts.length ? <Facts facts={facts} query={query} /> : <p className="ci-none">No properties.</p>;
}

function OutboundTemplate({ list, ctx }: { list: InspectedElement[]; ctx: ListCtx }) {
    if (!list.length) return null;
    return <div className="ci-template">
        <p className="ci-lead">The outbound template initializes <code>tmp</code>. Transformer steps can change it; its final value supplies the output.</p>
        <Elements list={list} kind="step" ctx={ctx} />
    </div>;
}

function PrintMapReferences({ inspection: r }: { inspection: ChannelInspection }) {
    return <div className="ci-print-maps">{r.maps.map(m => (
        <table key={keyText(m)} id={'print-ci-key-' + keyText(m)} className="ci-print-map" aria-label={keyText(m)}>
            <colgroup><col className="ci-print-map-direction" /><col /></colgroup>
            <thead><tr><th colSpan={2} scope="colgroup"><code>{m.key}</code><span className="dim">{m.map}</span></th></tr></thead>
            <tbody>
                {[{ label: 'Written by', ids: m.writers }, { label: 'Read by', ids: m.readers }].flatMap(({ label, ids }) =>
                    ids.length ? ids.map(id => <tr key={label + id}><th scope="row">{label}</th><td>{r.owners[id]}</td></tr>)
                        : [<tr key={label}><th scope="row">{label}</th><td>None{label === 'Written by' && m.readers.length > 0 && m.map !== 'configurationMap' && m.map !== 'sourceMap'
                            && <span className="ci-warn">No writer in this channel. It can come from a global script, a code template or another channel.</span>}</td></tr>]
                )}
            </tbody>
        </table>
    ))}</div>;
}

/* ---- the tab ---------------------------------------------------------------- */

export function ChannelInspectorTab({ channel, openTab, revision, dirty, isNew }: { channel: any; openTab: OpenTab; revision: number; dirty: boolean; isNew: boolean }) {
    const [includeGlobals, setIncludeGlobals] = useState(true);
    const [globals, setGlobals] = useState<Record<string, string>>({});
    const [globalState, setGlobalState] = useState('loading');
    const [deployment, setDeployment] = useState('Loading deployment status…');
    const [refresh, setRefresh] = useState(0);
    const [showCode, setShowCode] = useState(false);
    const [printPreview, setPrintPreview] = useState(false);
    const canGlobals = platform.checkTask('channel', 'doEditGlobalScripts');
    // The editor mutates its working channel in place; revision invalidates it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const r: ChannelInspection = useMemo(() => inspectChannel(channel, includeGlobals && canGlobals ? globals : {}), [channel, revision, includeGlobals, canGlobals, globals]);
    const allIds = useMemo(() => Object.keys(r.owners), [r]);
    const [open, setOpenState] = useState<Set<string>>(() => new Set());
    // Stage folding is independent of the toolbar's code/detail disclosures.
    const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set());
    const [query, setQuery] = useState('');
    const [hitIndex, setHitIndex] = useState(-1);
    const [channelNames, setChannelNames] = useState<Map<string, string>>(() => new Map());
    const [activeSection, setActiveSection] = useState('');
    const [targetKey, setTargetKey] = useState('');
    const storyRef = useRef<HTMLDivElement>(null);
    const q = query.trim().toLowerCase();
    const revisionText = `Current editor · revision ${r.revision}${dirty ? ' · unsaved changes' : ''}`;
    const globalsText = !includeGlobals ? 'Global scripts excluded.' : !canGlobals ? 'Global scripts unavailable with your permissions.'
        : globalState === 'ready' ? 'Includes the latest saved global scripts.' : globalState === 'loading' ? 'Loading global scripts…' : 'Global scripts could not be loaded.';
    const hasChannelWriter = r.destinations.some(d => d.transport === 'Channel Writer');

    useEffect(() => {
        if (!includeGlobals || !canGlobals) return undefined;
        let alive = true;
        setGlobalState('loading');
        api.getXml('/server/globalScripts').then(parseGlobalScripts).then(value => {
            if (alive) { setGlobals(value); setGlobalState('ready'); }
        }).catch(() => { if (alive) { setGlobals({}); setGlobalState('error'); } });
        return () => { alive = false; };
    }, [includeGlobals, canGlobals, refresh]);

    useEffect(() => {
        if (isNew) { setDeployment('Not saved or deployed.'); return undefined; }
        let alive = true;
        setDeployment('Loading deployment status…');
        api.status.one(channel.id).then(value => {
            if (!alive) return;
            if (!value?.state) { setDeployment('Deployment status unavailable.'); return; }
            const delta = value.deployedRevisionDelta;
            setDeployment(String(value.state).toUpperCase() === 'UNDEPLOYED' ? 'Channel is not deployed.'
                : delta == null ? 'Channel is deployed.'
                : Number(delta) === 0 ? 'Latest saved channel revision matches the deployed revision.'
                : Number(delta) > 0 ? `Latest saved channel is ${plural(Number(delta), 'revision')} ahead of deployed.`
                : 'The saved and deployed channel revisions differ.');
        }).catch(error => {
            // This endpoint returns 404 when the channel is not deployed.
            if (alive) setDeployment(error?.status === 404 ? 'Channel is not deployed.' : 'Deployment status unavailable.');
        });
        return () => { alive = false; };
    }, [channel.id, revision, isNew, refresh]);

    // Channel Writer targets are ids; resolve names when the user may list channels.
    useEffect(() => {
        if (!hasChannelWriter) return undefined;
        let alive = true;
        api.channels.idsAndNames().then((v: any) => {
            if (!alive) return;
            const names = new Map<string, string>();
            for (const en of api.asList(v && v.entry)) {
                const pair = api.asList<any>(en && en.string);
                if (pair.length) names.set(String(pair[0]), String(pair[1] ?? pair[0]));
            }
            setChannelNames(names);
        }).catch(() => { /* ids stay visible */ });
        return () => { alive = false; };
    }, [channel.id, hasChannelWriter]);

    const setOpen = (id: string, value: boolean) => setOpenState(prev => {
        const next = new Set(prev);
        if (value) next.add(id); else next.delete(id);
        return next;
    });

    const setSectionOpen = (id: string, value: boolean) => setCollapsedSections(prev => {
        const next = new Set(prev);
        if (value) next.delete(id); else next.add(id);
        return next;
    });

    // Find: open matching rows so the match is visible.
    const matches = useMemo(() => {
        if (!q) return [] as string[];
        const ids: string[] = [];
        const all = [r.source.poll, r.source.attachment, r.source.postprocess, r.source.outboundTemplate, r.deploy, r.preprocessor, r.sourceFilter, r.sourceTransformer, r.postprocessor,
            ...r.destinations.flatMap(d => [d.filter, d.transformer, d.outboundTemplate, d.send, d.response, d.responseTemplate])].flat();
        for (const el of all) if (searchText(el).includes(q)) ids.push(el.id);
        return ids;
    }, [q, r]);
    useEffect(() => {
        const ids = showCode ? allIds : matches;
        if (ids.length) setOpenState(prev => new Set([...prev, ...ids]));
    }, [matches, allIds, showCode]);

    // A new search reveals matching stages, including connector-setting facts.
    // Changing code disclosures alone must never unfold a stage.
    useEffect(() => {
        if (!q) return;
        const sections = new Set([...storyRef.current?.querySelectorAll<HTMLElement>('[data-hit]') ?? []]
            .map(el => el.closest('.ci-section')?.id).filter((id): id is string => !!id));
        setCollapsedSections(prev => new Set([...prev].filter(id => !sections.has(id))));
    }, [q, r]);

    const revealAndScroll = (el: HTMLElement) => {
        const section = el.closest('.ci-section');
        if (section) setSectionOpen(section.id, true);
        let p = el.parentElement;
        while (p) { if (p.tagName === 'DETAILS') (p as HTMLDetailsElement).open = true; p = p.parentElement; }
        if (el.tagName === 'DETAILS' && !open.has(el.id)) setOpen(el.id, true);
        // Wait for React to expose the stage before measuring its scroll target.
        window.requestAnimationFrame(() => {
            if (el.isConnected) el.scrollIntoView({ block: el.matches('.ci-section, .ci-dest') ? 'start' : 'center' });
        });
    };
    const scrollTo = (id: string) => {
        const el = document.getElementById(id);
        if (el) revealAndScroll(el);
    };
    const nextHit = () => {
        const hits = [...(storyRef.current?.querySelectorAll<HTMLElement>('[data-hit]') ?? [])];
        if (!hits.length) return;
        const i = (hitIndex + 1) % hits.length;
        setHitIndex(i);
        revealAndScroll(hits[i]);
    };
    const [hitCount, setHitCount] = useState(0);
    useEffect(() => { setHitCount(q && storyRef.current ? storyRef.current.querySelectorAll('[data-hit]').length : 0); }, [q, r, open]);
    const onKey = (k: MapKey) => { setTargetKey(keyText(k)); window.requestAnimationFrame(() => scrollTo('ci-key-' + keyText(k))); };
    const ctx: ListCtx = { open, setOpen, query: q, onKey, keys: new Set(r.maps.map(keyText)) };

    // Table of contents follows the scroll position.
    useEffect(() => {
        const root = storyRef.current;
        const scroll = root?.closest('.ci-scroll');
        if (!root || !scroll) return undefined;
        const targets = [...root.querySelectorAll<HTMLElement>('.ci-section, .ci-dest')];
        let frame = 0;
        const update = () => {
            frame = 0;
            // Use the actual viewport height. IntersectionObserver percentage
            // root margins are relative to width and can erase a wide root.
            const top = scroll.getBoundingClientRect().top + 32;
            let current: HTMLElement | undefined = targets[0];
            for (const target of targets) {
                if (!target.getClientRects().length) continue;
                if (target.getBoundingClientRect().top > top) break;
                current = target;
            }
            if (scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 1) current = targets.at(-1);
            setActiveSection(current?.id ?? '');
        };
        const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
        scroll.addEventListener('scroll', schedule, { passive: true });
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
        observer?.observe(root);
        observer?.observe(scroll);
        schedule();
        return () => { scroll.removeEventListener('scroll', schedule); observer?.disconnect(); window.cancelAnimationFrame(frame); };
    }, [r]);

    const sections = buildSections(r, ctx, channelNames, openTab, scrollTo, targetKey);
    const routing = r.sourceTransformer.find(e => e.routing && e.enabled);

    return (
        <div className="ci-root">
            <div className="ci-toolbar" role="toolbar" aria-label="Inspector tools">
                <label className="ci-find">
                    <Icon name="search" size={14} />
                    <span className="sr-only">Find in channel</span>
                    <input type="search" value={query} placeholder="Find in channel" autoComplete="off"
                        onChange={e => { setQuery(e.target.value); setHitIndex(-1); }}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); nextHit(); } if (e.key === 'Escape') setQuery(''); }} />
                    {q && <span className="ci-count" aria-live="polite">{hitCount ? `${Math.max(hitIndex, 0) + 1} of ${hitCount}` : 'No matches'}</span>}
                </label>
                <label className="ci-toggle"><input type="checkbox" checked={showCode} onChange={e => { setShowCode(e.target.checked); setOpenState(e.target.checked ? new Set(allIds) : new Set()); }} />Show all code</label>
                <label className="ci-toggle"><input type="checkbox" checked={includeGlobals && canGlobals} disabled={!canGlobals} onChange={e => setIncludeGlobals(e.target.checked)} />Include global scripts</label>
                <span className="ci-spacer" />
                <button type="button" className="btn" onClick={() => { setOpenState(new Set(allIds)); storyRef.current?.querySelectorAll('details').forEach(el => { el.open = true; }); }}><Icon name="chevD" size={14} />Expand all</button>
                <button type="button" className="btn" onClick={() => { setShowCode(false); setOpenState(new Set()); storyRef.current?.querySelectorAll('details').forEach(el => { el.open = false; }); }}><Icon name="chevR" size={14} />Collapse all</button>
                <Dialog.Root open={printPreview} onOpenChange={setPrintPreview}>
                    <Dialog.Trigger asChild><button type="button" className="btn"><Icon name="print" size={14} />Print</button></Dialog.Trigger>
                    {printPreview && <PrintView inspection={r} context={`${revisionText}. ${deployment}`} globalsText={globalsText} channelNames={channelNames} />}
                </Dialog.Root>
            </div>
            <div className="ci-scroll">
                <div className="ci-layout">
                    <nav className="ci-toc" aria-label="Steps in this channel">
                        {sections.map((s, i) => (
                            <div key={s.id}>
                                {(i === 0 || sections[i - 1].phase !== s.phase) && <div className="ci-toc-phase">{PHASES[s.phase][1]}</div>}
                                <a href={'#' + s.id} className={(activeSection === s.id ? 'on ' : '') + (s.empty ? 'empty' : '')}
                                    onClick={e => { e.preventDefault(); scrollTo(s.id); }}>
                                    <span className="n">{s.num ?? '·'}</span><span className="ci-toc-name">{s.title}</span>
                                </a>
                                {s.children?.map(c => (
                                    <a key={c.id} href={'#' + c.id} className={'sub ' + (activeSection === c.id ? 'on ' : '') + (c.off ? 'empty' : '')}
                                        aria-label={`${c.label} ${c.name}`} onClick={e => { e.preventDefault(); scrollTo(c.id); }}><span className="n">{c.label}</span>{' '}<span className="ci-toc-name">{c.name}</span></a>
                                ))}
                            </div>
                        ))}
                    </nav>
                    <div className="ci-story" ref={storyRef}>
                        <section className="ci-purpose">
                            <Description text={r.description} />
                            <div className="ci-glance">
                                <span><Icon name={connectorIcon(r.source.transport)} size={14} /><b>{typeLabel(r.inboundType)}</b> over {r.source.transport || 'an unknown connector'}</span>
                                <span><Icon name="filter" size={14} />{plural(r.sourceFilter.length, 'source rule')}</span>
                                <span><Icon name="transform" size={14} />{plural(r.sourceTransformer.length, 'source step')}</span>
                                <span><Icon name="send" size={14} />{plural(r.chains.flat().length, 'destination')} in {plural(r.chains.length, 'chain')}</span>
                                <span><Icon name="undo" size={14} />{r.response.variable === 'None' ? 'No response to sender' : !r.source.respondAfterProcessing ? 'Responds before processing' : `Responds with ${r.response.destination ? `the ${r.response.destination.label} response` : r.response.label.charAt(0).toLowerCase() + r.response.label.slice(1)}`}</span>
                            </div>
                            <p className="ci-from">{revisionText}. {deployment} <button type="button" className="ci-link" onClick={() => setRefresh(x => x + 1)}>Refresh status</button></p>
                            <p className="ci-from" role="status">{globalsText} {includeGlobals && canGlobals && globalState === 'error' && <button type="button" className="ci-link" onClick={() => setRefresh(x => x + 1)}>Retry global scripts</button>}</p>
                            {routing && <p className="ci-callout">A source transformer step, “{routing.name}”, can remove destinations for each message. The destinations below show what is configured, not what every message reaches.</p>}
                        </section>
                        {sections.map((s, i) => (
                            <div key={s.id}>
                                {(i === 0 || sections[i - 1].phase !== s.phase) && <h3 className="ci-phase"><Icon name={PHASES[s.phase][0]} size={14} />{PHASES[s.phase][1]}</h3>}
                                <section id={s.id} className={'ci-section' + (s.empty ? ' empty' : '') + (i === sections.length - 1 || sections[i + 1].phase !== s.phase ? ' last' : '')} aria-labelledby={s.id + '-h'}>
                                    {s.num == null && <span className="ci-index"><Icon name={s.icon || 'info'} size={14} /></span>}
                                    <div className="ci-section-body">
                                        <div className="ci-section-head">
                                            <h4 id={s.id + '-h'}>{s.num != null
                                                ? <button type="button" className="ci-section-toggle" aria-expanded={!collapsedSections.has(s.id)} aria-controls={s.id + '-content'}
                                                    onClick={() => setSectionOpen(s.id, collapsedSections.has(s.id))}>
                                                    <span className="ci-index" aria-hidden="true">{s.num}</span>
                                                    <span className="ci-section-title">{s.title}</span><Icon name="chevR" size={14} />
                                                </button>
                                                : <span className="ci-section-title">{s.title}</span>}</h4>
                                            <span className="ci-scope">{s.scope}</span>
                                            {s.tab && <button type="button" className="ci-link ci-open" onClick={() => openTab(s.tab!)}>Open in {s.tab}</button>}
                                        </div>
                                        <div id={s.id + '-content'} className="ci-section-content" hidden={s.num != null && collapsedSections.has(s.id)}>{s.body}</div>
                                    </div>
                                </section>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ---- sections ------------------------------------------------------------------- */

function PrintView({ inspection: r, context, globalsText, channelNames }: { inspection: ChannelInspection; context: string; globalsText: string; channelNames: Map<string, string> }) {
    const [prepared] = useState(() => new Date().toLocaleString());
    const ctx: ListCtx = { open: new Set(), setOpen: () => {}, query: '', onKey: () => {}, keys: new Set(r.maps.map(keyText)), print: true };
    const sections = buildSections(r, ctx, channelNames, () => {}, () => {}, '');
    return <Dialog.Portal>
        <Dialog.Overlay className="ci-print-scrim" />
        <Dialog.Content className="ci-print-dialog" aria-describedby={undefined}>
            <header className="ci-print-toolbar">
                <Dialog.Title asChild><span className="ci-preview-title">Print preview</span></Dialog.Title>
                <span className="ci-spacer" />
                <Dialog.Close asChild><button type="button" className="btn">Back to Inspector</button></Dialog.Close>
                <button type="button" className="btn btn-primary" onClick={() => window.print()}><Icon name="print" size={14} />Print / Save PDF</button>
            </header>
            <div className="ci-print-scroll" tabIndex={0} role="region" aria-label="Inspection pages">
                <article className="ci-print-paper" aria-label="Channel inspection document">
                    <header className="ci-print-header">
                        <h1>{r.name}</h1>
                        <p className="ci-print-subtitle">Channel Inspector · {context}</p>
                        <p className="ci-print-context">{globalsText} Prepared {prepared}.</p>
                        {r.description && <Description text={r.description} print />}
                        <Facts facts={[
                            ['Source', `${typeLabel(r.inboundType)} · ${r.source.transport}`],
                            ['Destinations', `${plural(r.chains.flat().length, 'enabled destination')} · ${plural(r.chains.length, 'chain')}`],
                            ['Source output', typeLabel(r.outboundType)],
                            ['Response selection', r.response.label]
                        ]} query="" />
                    </header>
                    {sections.map((section, i) => <div key={section.id}>
                        {(i === 0 || sections[i - 1].phase !== section.phase) && <h2 className="ci-print-phase">{PHASES[section.phase][1]}</h2>}
                        <section className="ci-print-section" aria-labelledby={'print-' + section.id}>
                            <header className="ci-print-section-head">
                                <h3 id={'print-' + section.id}>{section.num != null && <span className="ci-print-number">{section.num}.</span>}{section.title}</h3>
                                <span className="ci-scope">{section.scope}</span>
                            </header>
                            {section.body}
                        </section>
                    </div>)}
                    <footer className="ci-print-footer">Read-only configuration from the current editor. Scripts are included as text and are never run by Inspector.</footer>
                </article>
            </div>
        </Dialog.Content>
    </Dialog.Portal>;
}

function buildSections(r: ChannelInspection, ctx: ListCtx, channelNames: Map<string, string>, openTab: OpenTab, scrollTo: (id: string) => void, targetKey: string): Section[] {
    const s: Section[] = [];
    let n = 0;
    const msg = (x: Omit<Section, 'phase' | 'num'>) => s.push({ ...x, phase: 'message', num: ++n });
    const q = ctx.query;
    const lead = (text: React.ReactNode) => <p className="ci-lead">{text}</p>;

    if (r.deploy.length) {
        s.push({ id: 'ci-deploy', phase: 'deploy', icon: 'deploy', title: 'Prepare the channel', scope: 'Scripts', tab: 'Scripts',
            body: <>{lead('Deploy scripts prepare the channel. Global deploy runs before channel deploy; channel undeploy runs before global undeploy. Global hooks run once per deployment task.')}<Elements list={r.deploy} kind="script" ctx={ctx} /></> });
    }

    const inbound = typeLabel(r.inboundType), outbound = typeLabel(r.outboundType);
    msg({ id: 'ci-receive', title: `Receive ${inbound} over ${r.source.transport || 'the source connector'}`, scope: 'Source', tab: 'Source',
        body: <>
            {lead(<>{r.source.transport} {r.source.endpoint ? <>at <code>{r.source.endpoint}</code> </> : ''}accepts {inbound}.</>)}
            <Facts facts={r.source.settings} query={q} />
            {r.source.poll.length > 0 && <Elements list={r.source.poll} kind="script" ctx={ctx} />}
            <More print={ctx.print} title={<>Data type properties<span className="dim">· inbound {inbound} · outbound {outbound}</span></>}>
                <div className="ci-sub-head">Inbound {inbound}</div>
                <DataTypeFacts name={r.inboundType} props={r.source.inboundProperties} query={q} />
                <div className="ci-sub-head">Outbound {outbound}</div>
                <DataTypeFacts name={r.outboundType} props={r.source.outboundProperties} query={q} />
            </More>
        </> });

    if (r.source.attachment.length) {
        msg({ id: 'ci-attachments', title: 'Run the attachment handler', scope: 'Attachments', tab: 'Summary',
            body: <>{lead('Runs before preprocessing. It can extract attachments and replace the raw message passed to the preprocessor.')}<Elements list={r.source.attachment} kind="script" ctx={ctx} /></> });
    }

    msg({ id: 'ci-preprocess', title: 'Preprocess the raw message', scope: 'Scripts', tab: 'Scripts', empty: !r.preprocessor.length,
        body: r.preprocessor.length
            ? <>{lead('Runs on the raw text before it is parsed, global first and then channel. The returned string becomes the message.')}<Elements list={r.preprocessor} kind="script" ctx={ctx} /></>
            : lead('No preprocessor source is included here. A global preprocessor can still run.') });

    msg({ id: 'ci-filter', title: 'Accept or filter the message', scope: 'Source filter', tab: 'Source', empty: !r.sourceFilter.length,
        body: r.sourceFilter.length
            ? <>{lead(`${plural(r.sourceFilter.length, 'rule')}, joined as shown. If the result is false, the message is filtered and no destination runs.`)}<Elements list={r.sourceFilter} kind="rule" ctx={ctx} /></>
            : lead('No source filter rules. Every message continues.') });

    const skipped = r.sourceTransformer.filter(e => !e.enabled).length;
    msg({ id: 'ci-transform', title: r.inboundType === r.outboundType ? `Transform the ${inbound} message` : `Transform ${inbound} to ${outbound}`, scope: 'Source transformer', tab: 'Source', empty: !r.sourceTransformer.length && !r.source.outboundTemplate.length,
        body: <><OutboundTemplate list={r.source.outboundTemplate} ctx={ctx} />{r.sourceTransformer.length
            ? <>{lead(`${plural(r.sourceTransformer.length - skipped, 'enabled step')} run in order${skipped ? `; ${plural(skipped, 'disabled step')} skipped` : ''}. The result is the source output that every destination starts from.`)}<Elements list={r.sourceTransformer} kind="step" ctx={ctx} /></>
            : lead(r.source.outboundTemplate.length ? 'No transformer steps. The outbound template supplies the source output.'
                : `No transformer steps. The message is serialized from ${inbound} to ${outbound}.`)}</> });

    const off = r.destinations.filter(d => !d.enabled);
    const chip = (d: InspectedDestination) => {
        const content = <><Icon name={connectorIcon(d.transport)} size={14} /><span className="dn">{d.label}</span>{' '}<span className="ci-dchip-name">{d.name}</span></>;
        return ctx.print ? <span key={d.metaDataId} className={'ci-dchip' + (d.enabled ? '' : ' off')}>{content}</span> :
        <button type="button" key={d.metaDataId} className={'ci-dchip' + (d.enabled ? '' : ' off')} onClick={() => scrollTo('ci-dest-' + d.metaDataId)}>
            {content}
        </button>;
    };
    msg({ id: 'ci-destinations', title: 'Send to destinations', scope: 'Destinations', tab: 'Destinations', empty: !r.destinations.length,
        children: r.destinations.map(d => ({ id: 'ci-dest-' + d.metaDataId, label: d.label, name: d.name, off: !d.enabled })),
        body: !r.destinations.length ? lead('No destinations.') : <>
            {lead(`${plural(r.chains.flat().length, 'enabled destination')} in ${plural(r.chains.length, 'chain')}. Chains process independently from the source output. Inside a chain, each destination waits for the one before it to finish initial processing; queued work may complete later. Filtering or a send error allows the chain to continue; an error in the initial filter/transformer stops the rest of that chain.`)}
            <div className="ci-chain-map" aria-label="Chain map">
                {r.chains.map((chain, i) => (
                    <div className="ci-chain-row" key={i}>
                        <span className="lbl">Chain {i + 1}</span>
                        {chain.map((d, j) => <span key={d.metaDataId} className="ci-chain-step">{j > 0 && <Icon name="chevR" size={14} />}{chip(d)}</span>)}
                    </div>
                ))}
                {off.length > 0 && <div className="ci-chain-row"><span className="lbl">Disabled</span>{off.map(chip)}</div>}
            </div>
            {r.chains.map((chain, i) => (
                <section className="ci-chain" key={i} aria-label={`Chain ${i + 1}`}>
                    <div className="ci-chain-label"><strong>Chain {i + 1}</strong><span className="dim">{chain.length > 6 ? plural(chain.length, 'destination') + ', in configured order'
                        : chain.length > 1 ? chain.map(d => d.label).join(' then ') + ', in order' : 'One destination'}{i > 0 ? ' · independent of Chain 1' : ''}</span></div>
                    {chain.map((d, j) => (
                        <div key={d.metaDataId}>
                            {j > 0 && <div className="ci-wait"><Icon name="arrowDown" size={14} />{d.label} waits for {chain[j - 1].label} to finish initial processing.</div>}
                            <DestinationCard d={d} r={r} ctx={ctx} channelNames={channelNames} openTab={openTab} />
                        </div>
                    ))}
                </section>
            ))}
            {off.length > 0 && (
                <More print={ctx.print} className="ci-disabled" title={<>Disabled · {off.length > 6 ? plural(off.length, 'destination') : off.map(d => d.name).join(', ')} · configured but never runs</>}>
                    {off.map(d => <DestinationCard key={d.metaDataId} d={d} r={r} ctx={ctx} channelNames={channelNames} openTab={openTab} />)}
                </More>
            )}
        </> });

    msg({ id: 'ci-postprocess', title: 'Postprocess', scope: 'Scripts', tab: 'Scripts', empty: !r.postprocessor.length,
        body: r.postprocessor.length
            ? <>{lead('Runs after the destinations finish initial processing, channel first and then global. Queued work can still be pending.')}<Elements list={r.postprocessor} kind="script" ctx={ctx} /></>
            : lead('No postprocessor code. A global postprocessor can still run.') });

    const rd = r.response.destination;
    msg({ id: 'ci-respond', title: 'Respond to the sender', scope: 'Source', tab: 'Source',
        body: <>
            {lead(!r.source.respondAfterProcessing ? 'The source queue is enabled. The sender receives its response before message processing; destination and postprocessor responses are not available yet.' : rd
                ? `The sender gets the response from ${rd.label} ${rd.name}.${r.destinations.some(d => d.enabled && d.queued) ? ' Queued destinations can still be pending when this response is sent.' : ''}`
                : `Respond with: ${r.response.label}.`)}
            {rd && !rd.enabled && <p className="ci-callout">{rd.label} is disabled, so it cannot supply a destination response.</p>}
            <Facts facts={[['Response', rd ? `${rd.label} · ${rd.name}` : r.response.label], ...(rd ? [['Validate response', rd.validateResponse ? 'Yes' : 'No'] as Fact] : [])]} query={q} />
        </> });

    if (r.source.postprocessMode === 2 || r.source.postprocessMode === 3) {
        const eachRow = r.source.postprocessMode === 3;
        const afterPoll = !eachRow && (!r.source.useScript || !r.source.aggregateResults);
        const message = r.source.processBatch
            ? (r.source.firstResponse ? 'first' : 'last') + ' batch message for the combined results' : 'combined results message';
        const rowTiming = r.source.processBatch ? 'Runs once for each dispatched batch message from a row.' : 'Runs once per row after dispatching its message.';
        let timing = afterPoll ? 'Runs once at the end of each poll, including when polling fails or returns no rows.'
            : r.source.aggregateResults ? (eachRow ? 'Runs once per row' : 'Runs once') + ' after dispatching the ' + message + '.'
                : rowTiming;
        if (r.source.useScript && r.source.aggregateResults) {
            timing = 'If the script returns a nonempty ResultSet: ' + timing + ' If it returns a Java List, rows are dispatched individually. '
                + (eachRow ? rowTiming : 'The post-process is skipped for a Java List while Aggregate Results is enabled.');
        }
        s.push({ id: 'ci-source-postprocess', phase: afterPoll ? 'after' : 'message', num: afterPoll ? undefined : ++n, icon: 'db',
            title: 'Postprocess Database Reader results', scope: 'Source post-process', tab: 'Source',
            body: <>{lead(timing + (!r.source.respondAfterProcessing ? ' With the source queue enabled, message processing may still be pending.' : ' Queued destination work may still be pending.'))}
                {r.source.postprocess.length ? <Elements list={r.source.postprocess} kind="script" ctx={ctx} /> : lead('No post-process code configured.')}</>
        });
    }

    const queued = r.destinations.filter(d => d.enabled && d.queued);
    s.push({ id: 'ci-queue', phase: 'after', icon: 'clock', title: 'Retry queued sends', scope: 'Destinations', tab: 'Destinations', empty: !queued.length,
        body: queued.length
            ? <>{lead('These destinations queue sends always or on failure, as configured, and retry in the background. Queue processing is independent of the response to the sender.')}
                {queued.some(d => d.filterTransformerInQueue) && lead('When Include filter/transformer is enabled, queued attempts also repeat the filter and transformer.')}
                {queued.map(d => <div key={d.metaDataId}><div className="ci-sub-head">{d.label} · {d.name}</div><Facts facts={d.queue} query={q} /></div>)}</>
            : lead('No destination queues. A failed send is final once its retries end.') });

    s.push({ id: 'ci-storage', phase: 'after', icon: 'db', title: 'Store and prune messages', scope: 'Summary', tab: 'Summary',
        body: <>
            <Facts facts={r.storage} query={q} />
            {r.metadataColumns.length > 0 && <><div className="ci-sub-head">Custom metadata columns</div><Facts facts={r.metadataColumns} query={q} /></>}
        </> });

    s.push({ id: 'ci-maps', phase: 'ref', icon: 'tag', title: 'Maps and variables', scope: 'Reference',
        body: !r.maps.length ? lead('No literal map keys found in the inspected steps and scripts. Dynamic keys and code template internals are not resolved.') : <>
            {lead(<>Literal keys found in enabled steps and scripts, including Mapper variables and calls such as <code>$c()</code> and <code>channelMap.put()</code>. Dynamic keys and code template internals are not resolved. The same key in separate destination connector maps is a separate value.</>)}
            {ctx.print ? <PrintMapReferences inspection={r} /> : <div className="ci-map-wrap"><table className="ci-maps">
                <thead><tr><th>Key</th><th>Map</th><th>Written by</th><th>Read by</th></tr></thead>
                <tbody>
                    {r.maps.map(m => {
                        const id = keyText(m);
                        const flag = !m.writers.length && m.readers.length > 0 && m.map !== 'configurationMap' && m.map !== 'sourceMap';
                        const loc = (ids: string[]) => {
                            if (!ids.length) return <span className="dim">None</span>;
                            const links = ids.map(x => <button type="button" key={x} className="ci-link ci-loc" onClick={() => scrollTo(x)}>{r.owners[x]}</button>);
                            return ids.length > 6 ? <details className="ci-locations"><summary>{plural(ids.length, 'reference')}</summary>{links}</details> : links;
                        };
                        const hit = !!q && id.toLowerCase().includes(q);
                        return (
                            <tr key={id} id={(ctx.print ? 'print-' : '') + 'ci-key-' + id} className={(flag ? 'flag ' : '') + (targetKey === id ? 'target ' : '') + (hit ? 'hit' : '')} data-hit={hit || undefined}>
                                <td className="mono">{m.key}</td>
                                <td className="dim">{m.map}</td>
                                <td>{loc(m.writers)}{flag && <span className="ci-warn">No writer in this channel. It can come from a global script, a code template or another channel.</span>}</td>
                                <td>{loc(m.readers)}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table></div>}
        </> });
    return s;
}

function DestinationCard({ d, r, ctx, channelNames, openTab }: { d: InspectedDestination; r: ChannelInspection; ctx: ListCtx; channelNames: Map<string, string>; openTab: OpenTab }) {
    const target = d.transport === 'Channel Writer' ? (d.endpoint === 'none' || !d.endpoint ? 'No target channel' : channelNames.get(d.endpoint) ?? d.endpoint) : d.endpoint;
    const outbound = typeLabel(d.outboundType || r.outboundType);
    const sourceOut = typeLabel(r.outboundType);
    const Heading = ctx.print ? 'h4' : 'h5';
    const letters = 'abcd';
    let li = 0;
    const sub = (title: string, icon: string, body: React.ReactNode) => (
        <li className="ci-substep"><h5><span className="letter">{letters[li++]}.</span><Icon name={icon} size={14} />{title}</h5>{body}</li>
    );
    return (
        <article id={(ctx.print ? 'print-' : '') + 'ci-dest-' + d.metaDataId} className={'ci-dest' + (d.enabled ? '' : ' off')}>
            <header className="ci-dest-head">
                <span className="ci-cglyph"><Icon name={connectorIcon(d.transport)} size={18} /></span>
                <span className="ci-dest-title"><span className="dn">{d.label}</span>{' '}<Heading>{d.name}</Heading></span>
                <span className="dim">{d.transport}</span>
                {target && <span className="ci-addr">{target}</span>}
                {!d.enabled && <span className="tag">Disabled</span>}
                {!ctx.print && <button type="button" className="ci-link ci-open" onClick={() => openTab('Destinations')}>Open in Destinations</button>}
            </header>
            {d.filterTransformerInQueue && <p className="ci-lead">{d.sendFirst
                ? 'When an immediate send is attempted, the filter and transformer run first. Otherwise this work starts in the queue. Each queued attempt repeats the filter and transformer.'
                : 'Filter, transformer and send run in the queue. The next destination and the response to the sender can proceed before this work finishes. Queued retries repeat the filter and transformer.'}</p>}
            <ol className="ci-substeps">
                {sub('Filter', 'filter', d.filter.length
                    ? <><p className="ci-lead">If false, only {d.label} is skipped. Other destinations still run.</p><Elements list={d.filter} kind="rule" ctx={ctx} /></>
                    : <p className="ci-lead">No rules. Accepts every message that reaches it.</p>)}
                {sub(sourceOut === outbound ? 'Transform' : `Transform ${sourceOut} to ${outbound}`, 'transform', <>
                    <OutboundTemplate list={d.outboundTemplate} ctx={ctx} />
                    {d.transformer.length ? <Elements list={d.transformer} kind="step" ctx={ctx} />
                        : <p className="ci-lead">{d.outboundTemplate.length ? 'No steps. The outbound template supplies the destination output.' : <>No steps. Sends the source output as {outbound}.</>}</p>}
                </>)}
                {sub('Send', 'send', <><Facts facts={[...d.settings, ...d.queue]} query={ctx.query} />{d.send.length > 0 && <Elements list={d.send} kind="script" ctx={ctx} />}</>)}
                {sub('Handle the response', 'undo', <>
                    <Facts facts={[['Validate response', d.validateResponse ? 'Yes' : 'No']]} query={ctx.query} />
                    <OutboundTemplate list={d.responseTemplate} ctx={ctx} />
                    {d.response.length > 0 && <><div className="ci-sub-head">Response transformer</div><Elements list={d.response} kind="step" ctx={ctx} /></>}
                    {!d.response.length && !d.responseTemplate.length && <p className="ci-lead">No response transformer steps.</p>}
                </>)}
            </ol>
        </article>
    );
}
