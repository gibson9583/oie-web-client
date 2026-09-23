import * as oie from '@oie/web-api';

type Model = Record<string, any>;

/** XStream XML without guessing the types of numeric-looking names, scripts or transport fields. */
function xmlObject(element: Element): any {
    const attributes = Object.fromEntries([...element.attributes].map(attribute => [`@${attribute.name}`, attribute.value]));
    if (attributes['@reference']) throw new Error('The export contains an unresolved XML reference');
    if (!element.children.length) {
        const text = element.textContent || '';
        return Object.keys(attributes).length ? { ...attributes, ...(text ? { $: text } : {}) } : text;
    }
    const result: Model = attributes;
    for (const child of [...element.children]) {
        const value = xmlObject(child);
        if (!Object.hasOwn(result, child.tagName)) result[child.tagName] = value;
        else result[child.tagName] = Array.isArray(result[child.tagName]) ? [...result[child.tagName], value] : [result[child.tagName], value];
    }
    return result;
}

/** Convert only fields whose registered model defaults establish a primitive type. */
export function normalizeImportTypes(value: any, defaults: any): any {
    if (typeof defaults === 'boolean' && (value === 'true' || value === 'false')) return value === 'true';
    if (typeof defaults === 'number' && typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
    if (value && typeof value === 'object' && defaults && typeof defaults === 'object') {
        for (const key of Object.keys(value)) if (Object.hasOwn(defaults, key)) value[key] = normalizeImportTypes(value[key], defaults[key]);
    }
    return value;
}

function parse(text: string, rootName: string): any {
    if (text.trimStart().startsWith('<')) {
        const document = new DOMParser().parseFromString(text, 'text/xml');
        if (document.querySelector('parsererror') || document.documentElement.tagName !== rootName) {
            throw new Error(`Expected a valid <${rootName}> export`);
        }
        return xmlObject(document.documentElement) || {};
    }
    const parsed = JSON.parse(text);
    return parsed?.[rootName] ?? parsed;
}

function normalizeElements(container: Model): void {
    const source = container.elements;
    if (source != null && source !== '' && typeof source !== 'object') throw new Error('Invalid elements collection');
    if (source && typeof source === 'object' && !Array.isArray(source)) {
        for (const [type, value] of Object.entries(source)) {
            if (type.startsWith('@')) continue;
            for (const element of Array.isArray(value) ? value : [value]) {
                if (!element || typeof element !== 'object' || Array.isArray(element)) throw new Error('Invalid filter rule or transformer step');
            }
        }
    }
    const elements = Array.isArray(container.elements) ? container.elements : oie.elementsToArray(container.elements);
    for (const element of elements) {
        if (!element || typeof element !== 'object' || typeof element.__type !== 'string') throw new Error('Invalid filter rule or transformer step');
        if (element.enabled === 'false') element.enabled = false;
        else if (element.enabled === 'true') element.enabled = true;
        if (element.properties?.children && /Iterator(Step|Rule)$/.test(element.__type)) {
            const children = { elements: element.properties.children };
            normalizeElements(children);
            element.properties.children = children.elements;
        }
    }
    container.elements = oie.arrayToElements(elements);
}

export function parseFilterTransformerImport(text: string, isFilter: boolean, version: string, current?: Model): Model {
    const rootName = isFilter ? 'filter' : 'transformer';
    const fromXml = text.trimStart().startsWith('<');
    let parsed = parse(text, rootName);
    if (fromXml && (Object.hasOwn(parsed, 'steps') || Object.hasOwn(parsed, 'rules'))) {
        throw new Error('This legacy export requires engine migration. Import it in Swing and export it again before importing here.');
    }
    if (fromXml && !Object.hasOwn(parsed, 'elements')) parsed.elements = null;
    if (!isFilter && parsed?.responseTransformer) parsed = parsed.responseTransformer;
    if (Array.isArray(parsed)) parsed = { elements: parsed };
    if (!parsed || typeof parsed !== 'object') throw new Error(`Invalid ${rootName} export`);
    if (!Object.hasOwn(parsed, 'elements')) {
        const elements = parsed.steps ?? parsed.rules ?? parsed.responseTransformer?.elements;
        if (elements === undefined) throw new Error(`No ${isFilter ? 'rules' : 'steps'} found in the file`);
        parsed = { ...parsed, elements };
        delete parsed.steps;
        delete parsed.rules;
        delete parsed.responseTransformer;
    }
    if (parsed.elements != null && parsed.elements !== '' && typeof parsed.elements !== 'object') throw new Error('Invalid elements collection');
    // Historical web exports contained only elements. They cannot replace settings
    // that were never exported; full Swing/XML exports always replace the container.
    const elementsOnly = !fromXml && !['inboundDataType', 'outboundDataType', 'inboundTemplate', 'outboundTemplate', 'inboundProperties', 'outboundProperties'].some(key => Object.hasOwn(parsed, key));
    const defaults = elementsOnly && current ? structuredClone(current) : isFilter ? oie.emptyFilter(version) : oie.emptyTransformer(version);
    const result = { ...defaults, ...parsed };
    normalizeElements(result);
    if (!isFilter) decodeImportedTemplates(result);
    return result;
}

export function parseConnectorImport(text: string, mode: 'SOURCE' | 'DESTINATION', version: string): Model {
    const parsed = parse(text, 'connector');
    if (!parsed || typeof parsed !== 'object' || typeof parsed.transportName !== 'string' || !parsed.transportName || !parsed.properties || typeof parsed.properties !== 'object') {
        throw new Error('File is not a connector export');
    }
    if (text.trimStart().startsWith('<') && !['SOURCE', 'DESTINATION'].includes(parsed.mode)) throw new Error('Invalid connector mode');
    if (parsed.mode && parsed.mode !== mode) throw new Error(`You must be on the ${parsed.mode === 'SOURCE' ? 'Source' : 'Destinations'} tab to import this connector`);
    const connector = { '@version': version, enabled: true, waitForPrevious: true, ...parsed, mode };
    if (text.trimStart().startsWith('<') && [connector.filter, connector.transformer, connector.responseTransformer]
        .some(container => container && (Object.hasOwn(container, 'steps') || Object.hasOwn(container, 'rules')))) {
        throw new Error('This legacy connector requires engine migration. Import it in Swing and export it again before importing here.');
    }
    normalizeImportTypes(connector, { metaDataId: 0, enabled: true, waitForPrevious: true });
    connector.filter = { ...oie.emptyFilter(version), ...connector.filter };
    connector.transformer = { ...oie.emptyTransformer(version), ...connector.transformer };
    normalizeElements(connector.filter);
    normalizeElements(connector.transformer);
    decodeImportedTemplates(connector.transformer);
    if (mode === 'DESTINATION') {
        connector.responseTransformer = { ...oie.emptyTransformer(version), ...connector.responseTransformer };
        normalizeElements(connector.responseTransformer);
        decodeImportedTemplates(connector.responseTransformer);
    }
    return connector;
}

export function alignDestinationTypes(channel: Model, type: string, defaults: (type: string) => Model): void {
    const updates = oie.destinationsOf(channel).filter(destination => destination.transformer?.inboundDataType !== type)
        .map(destination => ({ destination, properties: defaults(type) }));
    for (const { destination, properties } of updates) {
        destination.transformer ||= {};
        destination.transformer.inboundDataType = type;
        destination.transformer.inboundProperties = properties;
    }
}

/** Channel.addDestination assigns a fresh metadata ID; existing destination objects stay untouched. */
export function appendImportedDestination(channel: Model, imported: Model, defaults: (type: string) => Model): number {
    const destinations = oie.destinationsOf(channel);
    const names = new Set(destinations.map(destination => String(destination.name).toLowerCase()));
    if (!imported.name || names.has(String(imported.name).toLowerCase())) {
        let index = 1;
        while (names.has(`destination ${index}`)) index++;
        imported.name = `Destination ${index}`;
    }
    const nextId = Math.max(Number(channel.nextMetaDataId) || 1, ...destinations.map(destination => (Number(destination.metaDataId) || 0) + 1));
    imported.metaDataId = nextId;
    const type = channel.sourceConnector.transformer.outboundDataType;
    if (imported.transformer.inboundDataType !== type) {
        imported.transformer.inboundDataType = type;
        imported.transformer.inboundProperties = defaults(type);
    }
    oie.setDestinations(channel, [...destinations, imported]);
    channel.nextMetaDataId = nextId + 1;
    return nextId;
}

/** Swing changes the automatic DICOM attachment handler along with source input type. */
export function updateImportedAttachmentHandler(channel: Model, type: string): void {
    const properties = channel.properties ||= {};
    const current = properties.attachmentProperties || { '@version': channel['@version'], type: 'None', properties: null };
    if ((!current.type || current.type === 'None') && type === 'DICOM') {
        properties.attachmentProperties = { ...current, type: 'DICOM', className: 'com.mirth.connect.server.attachments.dicom.DICOMAttachmentHandlerProvider', properties: null };
    } else if (current.type === 'DICOM' && type !== 'DICOM') {
        properties.attachmentProperties = { '@version': current['@version'], type: 'None', properties: null };
    }
}

/** Swing updates saved resource names/IDs against this engine's resource catalog. */
export function remapImportedResources(connector: Model, raw: any): void {
    const resources: Model[] = [];
    const collect = (value: any) => {
        if (!value || typeof value !== 'object') return;
        if (value.id != null && value.name != null) resources.push(value);
        else Object.values(value).forEach(collect);
    };
    collect(raw);
    const visit = (value: any) => {
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
            if (key !== 'resourceIds') { visit(child); continue; }
            const map: any = child;
            const entries = map?.entry == null ? [] : Array.isArray(map.entry) ? map.entry : [map.entry];
            const ids = new Set(entries.map((entry: any) => String(entry.string?.[0])));
            for (const entry of entries) {
                if (!Array.isArray(entry.string) || entry.string.length !== 2) continue;
                const [id, name] = entry.string;
                const matched = resources.find(resource => String(resource.id) === String(id))
                    || resources.find(resource => String(resource.name) === String(name) && !ids.has(String(resource.id)));
                if (matched) {
                    ids.delete(String(id));
                    ids.add(String(matched.id));
                    entry.string = [String(matched.id), String(matched.name)];
                }
            }
        }
    };
    visit(connector);
}

export function hasImportedResources(connector: Model): boolean {
    return Object.entries(connector).some(([key, value]) => key === 'resourceIds'
        ? !!value && typeof value === 'object' && !!value.entry
        : !!value && typeof value === 'object' && hasImportedResources(value));
}

export function normalizeImportedElementTypes(container: Model, defaults: (type: string) => any): void {
    const elements = oie.elementsToArray(container.elements);
    for (const element of elements) {
        normalizeImportTypes(element, defaults(element.__type));
        if (element.properties?.children && /Iterator(Step|Rule)$/.test(element.__type)) {
            const children = { elements: element.properties.children };
            normalizeImportedElementTypes(children, defaults);
            element.properties.children = children.elements;
        }
    }
    container.elements = oie.arrayToElements(elements);
}

function decodeImportedTemplates(transformer: Model): void {
    for (const key of ['inboundTemplate', 'outboundTemplate']) {
        const value = transformer[key];
        if (value && typeof value === 'object') {
            if (value['@encoding'] !== 'base64') throw new Error(`Unsupported ${key} encoding`);
            const binary = atob(String(value.$ ?? '').replace(/\s+/g, ''));
            transformer[key] = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
        }
    }
}
