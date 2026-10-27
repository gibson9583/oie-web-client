/*
 * Channel Inspector model: a read-only description of a channel in the order
 * the engine runs it. Pure — reads the wire channel, never changes it.
 */

import { elementsToArray, elementTypeLabel, destinationsOf } from './oie.js';
import { mappingEntries, toDisplayString } from './xstream.js';
import type { Element } from './oie.js';
import type { OieObject } from './wire-types.js';

export type MapName = 'channelMap' | 'connectorMap' | 'globalChannelMap' | 'globalMap' | 'responseMap' | 'configurationMap' | 'sourceMap';
export interface MapKey { map: MapName; key: string }
export type Fact = [string, string];

export interface InspectedElement {
    id: string;
    name: string;
    type: string;
    typeLabel: string;
    enabled: boolean;
    /** A disabled iterator also skips its descendants. */
    skippedByParent: boolean;
    /** AND / OR before this rule; empty for steps and the first rule. */
    operator: string;
    depth: number;
    /** Expression, script or settings text shown when the row opens. */
    detail: string;
    isScript: boolean;
    reads: MapKey[];
    writes: MapKey[];
    /** The element can change the destination set for a message. */
    routing: boolean;
}

export interface InspectedDestination {
    metaDataId: number;
    label: string;
    name: string;
    transport: string;
    enabled: boolean;
    waitForPrevious: boolean;
    endpoint: string;
    settings: Fact[];
    queue: Fact[];
    queued: boolean;
    sendFirst: boolean;
    filterTransformerInQueue: boolean;
    filter: InspectedElement[];
    transformer: InspectedElement[];
    outboundTemplate: InspectedElement[];
    response: InspectedElement[];
    responseTemplate: InspectedElement[];
    send: InspectedElement[];
    inboundType: string;
    outboundType: string;
    validateResponse: boolean;
}

export interface MapUsage extends MapKey { writers: string[]; readers: string[] }

export interface ChannelInspection {
    name: string;
    description: string;
    revision: number;
    inboundType: string;
    outboundType: string;
    source: {
        transport: string;
        endpoint: string;
        settings: Fact[];
        inboundProperties: OieObject | null;
        outboundProperties: OieObject | null;
        poll: InspectedElement[];
        attachment: InspectedElement[];
        outboundTemplate: InspectedElement[];
        postprocess: InspectedElement[];
        /** Database Reader: 1 = never, 2 = once after all results, 3 = each row. */
        postprocessMode: number;
        useScript: boolean;
        aggregateResults: boolean;
        processBatch: boolean;
        firstResponse: boolean;
        respondAfterProcessing: boolean;
    };
    deploy: InspectedElement[];
    preprocessor: InspectedElement[];
    postprocessor: InspectedElement[];
    sourceFilter: InspectedElement[];
    sourceTransformer: InspectedElement[];
    destinations: InspectedDestination[];
    /** Enabled destinations grouped into chains, in order. */
    chains: InspectedDestination[][];
    response: { variable: string; label: string; destination: InspectedDestination | null };
    storage: Fact[];
    metadataColumns: Fact[];
    maps: MapUsage[];
    /** Owner label of every element id, for map cross-links. */
    owners: Record<string, string>;
}

const truthy = (v: unknown) => v === true || v === 'true';
const text = (v: unknown) => (v == null ? '' : String(v));
const list = (v: any): any[] => {
    if (v == null || v === '') return [];
    if (Array.isArray(v)) return v;
    if (typeof v === 'object') {
        const inner = v.string ?? v.int ?? v.list;
        if (inner !== undefined) return Array.isArray(inner) ? inner : [inner];
    }
    return [v];
};

/** Keep configured source, even blank bodies; execution depends on script context. */
export function hasCode(script: unknown): boolean {
    return script != null;
}

/* ---- map keys ---------------------------------------------------------------- */

const SHORTHAND: Record<string, MapName> = {
    $c: 'channelMap', $co: 'connectorMap', $gc: 'globalChannelMap', $g: 'globalMap', $r: 'responseMap', $cfg: 'configurationMap', $s: 'sourceMap'
};
const SCOPE_MAP: Record<string, MapName> = {
    CHANNEL: 'channelMap', CONNECTOR: 'connectorMap', GLOBAL_CHANNEL: 'globalChannelMap', GLOBAL: 'globalMap', RESPONSE: 'responseMap'
};
const LITERAL = String.raw`\s*\(\s*(?<q>['"])((?:\\.|(?!\k<q>)[^\\\r\n])*)\k<q>\s*(,|\))`;
const MAP_CALL_RE = new RegExp(String.raw`\b(channelMap|connectorMap|globalChannelMap|globalMap|responseMap|configurationMap|sourceMap)\s*\.\s*(get|put|containsKey|remove)` + LITERAL, 'g');
const SHORT_CALL_RE = new RegExp(String.raw`(\$co|\$gc|\$cfg|\$c|\$g|\$r|\$s)(?![\w$])` + LITERAL, 'g');

/** Literal map keys a script reads and writes. Keys built at runtime are not found. */
export function mapKeysIn(script: unknown): { reads: MapKey[]; writes: MapKey[] } {
    const reads: MapKey[] = [];
    const writes: MapKey[] = [];
    const src = text(script);
    // Ignore calls in comments and quoted text. Keep offsets so the original
    // literal (including escapes) can still be read from each matched call.
    const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, m => ' '.repeat(m.length));
    for (const m of src.matchAll(MAP_CALL_RE)) {
        if (!code.slice(m.index, m.index + m[1].length).trim()) continue;
        const key = { map: m[1] as MapName, key: m[4] };
        (m[2] === 'put' || m[2] === 'remove' ? writes : reads).push(key);
    }
    for (const m of src.matchAll(SHORT_CALL_RE)) {
        if (!code.slice(m.index, m.index + m[1].length).trim()) continue;
        const key = { map: SHORTHAND[m[1]], key: m[3] };
        (m[4] === ',' ? writes : reads).push(key);
    }
    return { reads: unique(reads), writes: unique(writes) };
}

function unique(keys: MapKey[]): MapKey[] {
    const seen = new Set<string>();
    return keys.filter(k => {
        const id = `${k.map}.${k.key}`;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
    });
}

/* ---- elements ------------------------------------------------------------------- */

const CONDITIONS: Record<string, string> = {
    EXISTS: 'exists', NOT_EXIST: 'does not exist', EQUALS: 'equals', NOT_EQUAL: 'does not equal', CONTAINS: 'contains', NOT_CONTAIN: 'does not contain'
};
const BEHAVIORS: Record<string, string> = {
    REMOVE: 'Remove destinations', REMOVE_ALL_EXCEPT: 'Remove all destinations except', REMOVE_ALL: 'Remove all destinations'
};
const ITERATOR_TYPES = new Set(['com.mirth.connect.model.IteratorStep', 'com.mirth.connect.model.IteratorRule']);

function condition(el: any): string {
    const values = list(el.values).map(text);
    return `${text(el.field)} ${CONDITIONS[text(el.condition)] ?? text(el.condition).toLowerCase()}${values.length ? ' ' + values.join(' or ') : ''}`.trim();
}

function replacementPairs(el: Element): Array<[string, string]> {
    const replacements = el.replacements;
    if (!replacements || typeof replacements !== 'object') return [];
    // Native XStream uses an ImmutablePair class wrapper; imported/editor
    // models can carry the pair fields directly.
    const rows = replacements['org.apache.commons.lang3.tuple.ImmutablePair'] ?? replacements.entry ?? replacements;
    return (Array.isArray(rows) ? rows : [rows]).flatMap(p => {
        if (!p || typeof p !== 'object') return [];
        const pair = Array.isArray(p) ? p : 'left' in p ? [p.left, p.right]
            : 'key' in p ? [p.key, p.value] : 'first' in p ? [p.first, p.second]
                : Array.isArray(p.string) ? p.string : null;
        return pair ? [[toDisplayString(pair[0]), toDisplayString(pair[1])] as [string, string]] : [];
    });
}

function describe(el: Element): { detail: string; isScript: boolean; reads: MapKey[]; writes: MapKey[]; routing: boolean } {
    const type = el.__type;
    const label = elementTypeLabel(type);
    let detail = '';
    let isScript = false;
    let routing = false;
    let reads: MapKey[] = [];
    let writes: MapKey[] = [];
    // Saved source is restored from XML by the API. Imported JSON can still
    // contain primitives; the engine imports JSON null as an empty script.
    if (typeof el.script === 'string' || (label === 'JavaScript' && Object.hasOwn(el, 'script'))) {
        detail = text(el.script);
        isScript = true;
        ({ reads, writes } = mapKeysIn(detail));
        routing = /\bdestinationSet\s*\./.test(detail);
    } else if (label === 'Mapper') {
        const map = SCOPE_MAP[text(el.scope)] ?? 'channelMap';
        const variable = text(el.variable);
        const replacements = replacementPairs(el);
        detail = `${variable} ← ${text(el.mapping)}` + (text(el.defaultValue) ? `\nDefault: ${text(el.defaultValue)}` : '') + `\nMap: ${map}`;
        if (replacements.length) detail += '\nReplacements (in order):\n' + replacements.map(([pattern, replacement], i) => `${i + 1}. ${pattern} → ${replacement}`).join('\n');
        ({ reads, writes } = mapKeysIn([el.mapping, el.defaultValue, ...replacements.flat()].join('\n')));
        if (variable) writes = unique([{ map, key: variable }, ...writes]);
    } else if (label === 'Message Builder') {
        const replacements = replacementPairs(el);
        detail = `${text(el.messageSegment)} ← ${text(el.mapping)}` + (text(el.defaultValue) ? `\nDefault: ${text(el.defaultValue)}` : '');
        if (replacements.length) detail += '\nReplacements (in order):\n' + replacements.map(([pattern, replacement], i) => `${i + 1}. ${pattern} → ${replacement}`).join('\n');
        ({ reads, writes } = mapKeysIn([el.messageSegment, el.mapping, el.defaultValue, ...replacements.flat()].join('\n')));
    } else if (label === 'Rule Builder') {
        detail = condition(el);
        reads = mapKeysIn([el.field, ...list(el.values)].join('\n')).reads;
    } else if (label === 'Iterator') {
        const p = el.properties || {};
        detail = `For each ${text(p.target)} · index variable ${text(p.indexVariable)}`;
        if (type === 'com.mirth.connect.model.IteratorRule') {
            const all = truthy(p.intersectIterations);
            // New rules serialize breakEarly=true; omitted imported flags are false.
            const early = truthy(p.breakEarly);
            detail += `\nAccept if: ${all ? 'All iterations pass' : 'Any iteration passes'}`;
            detail += `\nStop early: ${early ? `On first ${all ? 'failing' : 'passing'} iteration` : 'No · evaluate every iteration'}`;
        }
        reads = mapKeysIn(p.target).reads;
    } else if (label === 'Destination Set Filter') {
        const ids = list(el.metaDataIds).map(text);
        detail = `${BEHAVIORS[text(el.behavior)] ?? text(el.behavior)}${ids.length && el.behavior !== 'REMOVE_ALL' ? ' ' + ids.map(i => 'D' + i).join(', ') : ''}\nwhen ${condition(el)}`;
        routing = true;
        reads = mapKeysIn([el.field, ...list(el.values)].join('\n')).reads;
    } else if (label === 'XSLT Step') {
        const variable = text(el.resultVariable);
        detail = `Source XML: ${text(el.sourceXml)}\nResult variable: ${variable}`;
        if (truthy(el.useCustomFactory) && text(el.customFactory)) detail += `\nCustom factory: ${text(el.customFactory)}`;
        detail += `\n\nTemplate:\n${text(el.template)}`;
        ({ reads, writes } = mapKeysIn([el.sourceXml, el.template].join('\n')));
        if (variable) writes = unique([{ map: 'channelMap', key: variable }, ...writes]);
    } else if (label === 'External Script') {
        detail = `Script file: ${text(el.scriptPath)}`;
    } else {
        detail = `${label} (${type})`;
    }
    return { detail, isScript, reads, writes, routing };
}

class Elements {
    private counts = new Map<string, number>();
    readonly owners: Record<string, string> = {};
    readonly all: InspectedElement[] = [];

    fromScript(name: string, script: unknown, owner: string): InspectedElement[] {
        if (!hasCode(script)) return [];
        const { reads, writes } = mapKeysIn(script);
        return [this.add({ name, type: 'script', typeLabel: 'JavaScript', enabled: true, skippedByParent: false, operator: '', depth: 0, detail: text(script), isScript: true, reads, writes, routing: /\bdestinationSet\s*\./.test(text(script)) }, owner)];
    }

    fromText(name: string, value: unknown, owner: string, type: 'template' | 'sql'): InspectedElement[] {
        const detail = text(value);
        if (!detail.trim()) return [];
        // Template bodies and SQL are not JavaScript. Calls appearing in their
        // literal text must not create map readers, writers or routing claims.
        return [this.add({ name, type, typeLabel: type === 'template' ? 'Template' : 'SQL', enabled: true, skippedByParent: false,
            operator: '', depth: 0, detail, isScript: false, reads: [], writes: [], routing: false }, owner)];
    }

    fromElements(elements: unknown, owner: string, rules: boolean): InspectedElement[] {
        const out: InspectedElement[] = [];
        const walk = (items: Element[], depth: number, parentEnabled = true) => {
            items.forEach((el, index) => {
                const enabled = parentEnabled && el.enabled !== false && el.enabled !== 'false';
                out.push(this.add({
                    name: text(el.name) || elementTypeLabel(el.__type),
                    type: el.__type,
                    typeLabel: elementTypeLabel(el.__type),
                    enabled,
                    skippedByParent: !parentEnabled,
                    operator: rules && index > 0 ? (el.operator === 'OR' ? 'OR' : 'AND') : '',
                    depth,
                    ...describe(el)
                }, owner));
                if (ITERATOR_TYPES.has(el.__type)) walk(elementsToArray(el.properties?.children), depth + 1, enabled);
            });
        };
        walk(elementsToArray(elements as any), 0);
        return out;
    }

    private add(el: Omit<InspectedElement, 'id'>, owner: string): InspectedElement {
        const index = this.counts.get(owner) ?? 0;
        this.counts.set(owner, index + 1);
        // Loading or excluding global hooks must not change channel row ids.
        const item = { id: `el-${encodeURIComponent(owner)}-${index}`, ...el };
        this.owners[item.id] = `${owner} · ${item.name}`;
        this.all.push(item);
        return item;
    }
}

/* ---- connectors ----------------------------------------------------------------- */

function listener(p: any): string {
    const l = p?.listenerConnectorProperties;
    return l ? `${text(l.host) || '0.0.0.0'}:${text(l.port)}` : '';
}

function endpointOf(transport: string, p: any): string {
    switch (transport) {
        case 'TCP Listener': return p.serverMode === false || p.serverMode === 'false' ? `${text(p.remoteAddress)}:${text(p.remotePort)}` : listener(p);
        case 'TCP Sender': return `${text(p.remoteAddress)}:${text(p.remotePort)}`;
        case 'HTTP Listener': return listener(p) + text(p.contextPath);
        case 'HTTP Sender': return text(p.host);
        case 'File Reader': case 'File Writer': case 'Document Writer':
            return `${text(p.scheme || 'FILE').toLowerCase()}://${text(p.host)}${text(p.outputPattern) ? '/' + text(p.outputPattern) : ''}`;
        case 'Database Reader': case 'Database Writer': return text(p.url);
        case 'Channel Writer': return text(p.channelId);
        case 'SMTP Sender': return `${text(p.smtpHost)}:${text(p.smtpPort)} → ${text(p.to)}`;
        case 'JMS Sender': case 'JMS Listener': return text(p.destinationName);
        case 'Web Service Sender': return text(p.locationURI || p.wsdlUrl);
        case 'DICOM Sender': return `${text(p.host)}:${text(p.port)}`;
        default: return listener(p) || text(p.host);
    }
}

function settingsOf(transport: string, p: any): Fact[] {
    const facts: Fact[] = [];
    const add = (k: string, v: unknown) => { if (text(v) !== '') facts.push([k, text(v)]); };
    const mode = p.transmissionModeProperties?.pluginPointName;
    if (mode) add('Transmission mode', mode);
    switch (transport) {
        case 'TCP Listener': case 'TCP Sender':
            add('Mode', truthy(p.serverMode) ? 'Server' : 'Client');
            add('Keep connection open', truthy(p.keepConnectionOpen) ? 'Yes' : 'No');
            add('Send timeout', p.sendTimeout != null ? `${text(p.sendTimeout)} ms` : '');
            add('Response timeout', p.responseTimeout != null ? `${text(p.responseTimeout)} ms` : '');
            add('Receive timeout', p.receiveTimeout != null ? `${text(p.receiveTimeout)} ms` : '');
            add('Max connections', p.maxConnections);
            break;
        case 'HTTP Sender':
            add('Method', text(p.method).toUpperCase());
            add('Content type', p.contentType);
            add('Socket timeout', p.socketTimeout != null ? `${text(p.socketTimeout)} ms` : '');
            break;
        case 'HTTP Listener':
            add('Response content type', p.responseContentType);
            add('Response status code', p.responseStatusCode);
            break;
        case 'File Reader':
            add('File filter', p.fileFilter);
            add('After processing', p.afterProcessingAction);
            break;
        case 'File Writer':
            add('If file exists', truthy(p.outputAppend) ? 'Append' : truthy(p.errorOnExists) ? 'Error' : 'Overwrite');
            add('Template', p.template);
            break;
        case 'Database Writer': case 'Database Reader':
            add('Driver', p.driver);
            add('Use JavaScript', truthy(p.useScript) ? 'Yes' : 'No');
            if (!truthy(p.useScript)) add(transport === 'Database Reader' ? 'Select' : 'Query', transport === 'Database Reader' ? p.select : p.query);
            if (transport === 'Database Reader') {
                add('Aggregate results', truthy(p.aggregateResults) ? 'Yes' : 'No');
                add('Post-process', Number(p.updateMode) === 2 ? 'Once after all results' : Number(p.updateMode) === 3 ? 'Once per row' : 'Never');
            }
            break;
        case 'Channel Writer':
            add('Template', p.channelTemplate);
            add('Map variables', list(p.mapVariables).join(', '));
            break;
        case 'SMTP Sender':
            add('Subject', p.subject);
            add('From', p.from);
            break;
        case 'Web Service Sender':
            add('Service', p.service);
            add('Operation', p.operation);
            break;
    }
    return facts;
}

function seconds(ms: unknown): string {
    const n = Number(ms);
    return Number.isFinite(n) ? (n % 1000 === 0 ? `${n / 1000} s` : `${n} ms`) : text(ms);
}

function queueOf(d: any): { facts: Fact[]; queued: boolean; sendFirst: boolean; filterTransformerInQueue: boolean } {
    const q = d.properties?.destinationConnectorProperties || {};
    const queued = truthy(q.queueEnabled);
    const sendFirst = truthy(q.sendFirst);
    const filterTransformerInQueue = queued && truthy(q.regenerateTemplate) && truthy(q.includeFilterTransformer);
    const facts: Fact[] = [['Queue', queued ? (sendFirst ? 'On failure' : 'Always') : 'Never']];
    facts.push(['Retry count', text(q.retryCount ?? 0)]);
    if (queued || Number(q.retryCount) > 0) facts.push(['Retry interval', seconds(q.retryIntervalMillis)]);
    if (queued) {
        facts.push(['Queue threads', text(q.threadCount ?? 1)]);
        facts.push(['Rotate', truthy(q.rotate) ? 'Yes' : 'No']);
        facts.push(['Regenerate template', truthy(q.regenerateTemplate) ? 'Yes' : 'No']);
        facts.push(['Include filter/transformer', filterTransformerInQueue ? 'Yes' : 'No']);
    }
    return { facts, queued, sendFirst, filterTransformerInQueue };
}

/* ---- channel -------------------------------------------------------------------- */

const RESPONSE_LABELS: Record<string, string> = {
    None: 'No response',
    'Auto-generate (Before processing)': 'Auto-generated before processing',
    'Auto-generate (After source transformer)': 'Auto-generated after the source transformer',
    'Auto-generate (Destinations completed)': 'Auto-generated after the destinations complete',
    Postprocessor: 'The postprocessor return value'
};

export function inspectChannel(channel: OieObject, globals: Record<string, string> = {}): ChannelInspection {
    const els = new Elements();
    const source: any = channel.sourceConnector || {};
    const sp: any = source.properties || {};
    const scp: any = sp.sourceConnectorProperties || {};
    const sourceTransport = text(source.transportName);
    const postprocessMode = sourceTransport === 'Database Reader' ? Number(sp.updateMode ?? 1) : 1;

    const destinations: InspectedDestination[] = destinationsOf(channel).map((d: any) => {
        const p = d.properties || {};
        const metaDataId = Number(d.metaDataId);
        const label = `D${metaDataId}`;
        const owner = `${label} ${text(d.name)}`;
        const { facts, queued, sendFirst, filterTransformerInQueue } = queueOf(d);
        const send = [
            ...(d.transportName === 'JavaScript Writer' ? els.fromScript('Writer script', p.script, owner) : []),
            ...(d.transportName === 'Database Writer' && truthy(p.useScript) ? els.fromScript('Database script', p.query, owner) : [])
        ];
        return {
            metaDataId, label,
            name: text(d.name),
            transport: text(d.transportName),
            enabled: d.enabled !== false && d.enabled !== 'false',
            waitForPrevious: truthy(d.waitForPrevious),
            endpoint: endpointOf(text(d.transportName), p),
            settings: settingsOf(text(d.transportName), p),
            queue: facts, queued, sendFirst, filterTransformerInQueue,
            filter: els.fromElements(d.filter?.elements, `${owner} filter`, true),
            transformer: els.fromElements(d.transformer?.elements, `${owner} transformer`, false),
            response: els.fromElements(d.responseTransformer?.elements, `${owner} response`, false),
            send,
            outboundTemplate: els.fromText('Outbound template', d.transformer?.outboundTemplate, owner + ' output template', 'template'),
            responseTemplate: els.fromText('Response outbound template', d.responseTransformer?.outboundTemplate, owner + ' response template', 'template'),
            inboundType: text(d.transformer?.inboundDataType),
            outboundType: text(d.transformer?.outboundDataType),
            validateResponse: truthy(p.destinationConnectorProperties?.validateResponse)
        };
    });

    // Mirrors DonkeyEngineController: enabled destinations, a new chain unless waitForPrevious.
    const chains: InspectedDestination[][] = [];
    for (const d of destinations.filter(x => x.enabled)) {
        if (!d.waitForPrevious || !chains.length) chains.push([]);
        chains[chains.length - 1].push(d);
    }

    const variable = text(scp.responseVariable || 'None');
    const responseDest = /^d\d+$/.test(variable) ? destinations.find(d => d.metaDataId === Number(variable.slice(1))) ?? null : null;
    const responseLabel = responseDest ? `${responseDest.label} ${responseDest.name}` : (RESPONSE_LABELS[variable] ?? `Response map variable “${variable}”`);

    const sourceSettings: Fact[] = [
        ...settingsOf(sourceTransport, sp),
        ['Source queue', scp.respondAfterProcessing !== false && scp.respondAfterProcessing !== 'false' ? 'Off · respond after processing' : 'On · respond before processing'],
        ['Process batch', truthy(scp.processBatch) ? 'Yes' : 'No'],
        ['Processing threads', text(scp.processingThreads || 1)],
        ['Attachment handler', text(channel.properties?.attachmentProperties?.type || 'None')]
    ];

    const props: any = channel.properties || {};
    const pruning: any = channel.exportData?.metadata?.pruningSettings || {};
    const days = (v: unknown) => (v == null || v === '' ? 'Never' : `${text(v)} days`);
    const storage: Fact[] = [
        ['Storage mode', text(props.messageStorageMode || 'DEVELOPMENT').charAt(0) + text(props.messageStorageMode || 'DEVELOPMENT').slice(1).toLowerCase()],
        ['Encrypt data', truthy(props.encryptData) ? 'Yes' : 'No'],
        ['Remove content on completion', truthy(props.removeContentOnCompletion) ? (truthy(props.removeOnlyFilteredOnCompletion) ? 'Filtered only' : 'Yes') : 'No'],
        ['Prune metadata after', days(pruning.pruneMetaDataDays)],
        ['Prune content after', days(pruning.pruneContentDays)],
        ['Initial state', text(props.initialState || 'STARTED').charAt(0) + text(props.initialState || 'STARTED').slice(1).toLowerCase()]
    ];
    const metadataColumns: Fact[] = list(props.metaDataColumns?.metaDataColumn ?? props.metaDataColumns)
        .filter((c: any) => c && typeof c === 'object')
        .map((c: any) => [text(c.name), text(c.mappingName)]);

    const result: ChannelInspection = {
        name: text(channel.name),
        description: text(channel.description).trim(),
        revision: Number(channel.revision) || 0,
        inboundType: text(source.transformer?.inboundDataType),
        outboundType: text(source.transformer?.outboundDataType),
        source: {
            transport: sourceTransport,
            endpoint: endpointOf(sourceTransport, sp),
            settings: sourceSettings,
            inboundProperties: source.transformer?.inboundProperties ?? null,
            outboundProperties: source.transformer?.outboundProperties ?? null,
            outboundTemplate: els.fromText('Outbound template', source.transformer?.outboundTemplate, 'Source output template', 'template'),
            attachment: props.attachmentProperties?.type === 'JavaScript'
                ? els.fromScript('Attachment handler script', mappingEntries(props.attachmentProperties.properties).find(([key]) => key === 'javascript.script')?.[1], 'Attachments') : [],
            postprocessMode,
            useScript: truthy(sp.useScript),
            aggregateResults: truthy(sp.aggregateResults),
            processBatch: truthy(scp.processBatch),
            firstResponse: truthy(scp.firstResponse),
            postprocess: postprocessMode === 2 || postprocessMode === 3
                ? truthy(sp.useScript) ? els.fromScript('Database post-process script', sp.update, 'Source post-process')
                    : els.fromText('Database post-process SQL', sp.update, 'Source post-process', 'sql')
                : [],
            poll: sourceTransport === 'JavaScript Reader' ? els.fromScript('Reader script', sp.script, 'Source')
                : sourceTransport === 'Database Reader' && truthy(sp.useScript) ? els.fromScript('Database select script', sp.select, 'Source') : [],
            respondAfterProcessing: scp.respondAfterProcessing !== false && scp.respondAfterProcessing !== 'false'
        },
        deploy: [
            ...els.fromScript('Global deploy script', globals.Deploy, 'Global deploy'),
            ...els.fromScript('Deploy script', channel.deployScript, 'Deploy'),
            ...els.fromScript('Undeploy script', channel.undeployScript, 'Undeploy'),
            ...els.fromScript('Global undeploy script', globals.Undeploy, 'Global undeploy')
        ],
        preprocessor: [...els.fromScript('Global preprocessor', globals.Preprocessor, 'Global preprocessor'), ...els.fromScript('Preprocessor', channel.preprocessingScript, 'Preprocessor')],
        sourceFilter: els.fromElements(source.filter?.elements, 'Source filter', true),
        sourceTransformer: els.fromElements(source.transformer?.elements, 'Source transformer', false),
        postprocessor: [...els.fromScript('Postprocessor', channel.postprocessingScript, 'Postprocessor'), ...els.fromScript('Global postprocessor', globals.Postprocessor, 'Global postprocessor')],
        destinations,
        chains,
        response: { variable, label: responseLabel, destination: responseDest },
        storage,
        metadataColumns,
        maps: [],
        owners: els.owners
    };
    const disabledIds = new Set(destinations.filter(d => !d.enabled).flatMap(d => [...d.filter, ...d.transformer, ...d.send, ...d.response].map(el => el.id)));
    result.maps = mapUsage(els.all.filter(el => !disabledIds.has(el.id)));
    return result;
}

const MAP_ORDER: MapName[] = ['globalMap', 'globalChannelMap', 'configurationMap', 'channelMap', 'connectorMap', 'responseMap', 'sourceMap'];

function mapUsage(elements: InspectedElement[]): MapUsage[] {
    const usage = new Map<string, MapUsage>();
    const entry = (k: MapKey) => {
        const id = `${k.map}.${k.key}`;
        if (!usage.has(id)) usage.set(id, { ...k, writers: [], readers: [] });
        return usage.get(id)!;
    };
    for (const el of elements) {
        if (!el.enabled) continue;
        el.writes.forEach(k => entry(k).writers.push(el.id));
        el.reads.forEach(k => entry(k).readers.push(el.id));
    }
    return [...usage.values()].sort((a, b) => MAP_ORDER.indexOf(a.map) - MAP_ORDER.indexOf(b.map) || a.key.localeCompare(b.key));
}
