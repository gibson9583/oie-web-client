import type { ConnectorMode, ConnectorPanel, ConnectorPropertiesPanel } from './platform.js';
import type { OieObject } from './wire-types.js';

// XStream may omit collection classes, collapse singleton children and return
// empty elements as null. Concrete property classes still carry meaning.
const COLLECTION_CLASSES = new Set([
    'list', 'java.util.ArrayList', 'java.util.LinkedList',
    'map', 'hash-map', 'linked-hash-map', 'java.util.HashMap', 'java.util.LinkedHashMap',
    'set', 'hash-set', 'linked-hash-set', 'java.util.HashSet', 'java.util.LinkedHashSet'
]);

function comparable(value: any, preserveEmptyEntries = false): any {
    if (value == null || value === '') return null;
    if (Array.isArray(value)) {
        if (!value.length) return null;
        return value.length === 1 ? comparable(value[0], preserveEmptyEntries)
            : value.map(child => comparable(child, preserveEmptyEntries));
    }
    if (typeof value !== 'object') return String(value);
    const entries = Object.keys(value).sort().flatMap(key => {
        if (key === '@version' || (key === '@class' && COLLECTION_CLASSES.has(value[key]))) return [];
        // A polymorphic plugin's element name is configuration even when its
        // properties are empty. Never erase an unknown plugin's identity.
        const child = comparable(value[key], key === 'pluginProperties' || key === 'responseConnectorPluginProperties');
        return child === null && !preserveEmptyEntries ? [] : [[key, child]];
    });
    return entries.length ? Object.fromEntries(entries) : null;
}

function equalProperties(left: any, right: any): boolean {
    return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

/** Swing ChannelSetup compares the CURRENT connector's properties with its
 * defaults, irrespective of channel age, dirty state or earlier type switches.
 * Compare copies: opening/cancelling the prompt must not normalize the draft.
 * Missing/failed plugin defaults never authorize silently discarding settings. */
export function connectorHasNonDefaultProperties(
    connector: OieObject, mode: ConnectorMode, version: string,
    panel: ConnectorPanel | undefined, propertyPanels: readonly ConnectorPropertiesPanel[] = []
): boolean {
    try {
        if (!panel?.defaults || !connector.properties || typeof connector.properties !== 'object') return true;
        const defaults = structuredClone(panel.defaults(version));
        if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) return true;
        const current = structuredClone(connector.properties);

        // Inherited queue values depend on engine settings, not web defaults.
        // Even a plugin default of zero cannot authorize a silent queue reset.
        for (const key of ['sourceConnectorProperties', 'destinationConnectorProperties']) {
            const buffer = current[key]?.queueBufferSize;
            if (buffer != null && Number(buffer) <= 0) return true;
        }

        // Extra connector-properties panels (e.g. HTTP authentication) are part
        // of Swing's defaults too. Web panels may leave their default entry
        // absent until edited; accept either absent or explicitly default.
        const defaultConnector = { ...connector, properties: defaults };
        for (const extension of propertyPanels) {
            if (!extension.defaults || !extension.isSupported(connector.transportName, mode, defaultConnector)) continue;
            const key = typeof extension.propertiesClass === 'function'
                ? extension.propertiesClass(connector.transportName, mode, defaultConnector) : extension.propertiesClass;
            if (!key) continue;
            const entry = extension.defaults(version, connector.transportName, mode, defaultConnector);
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return true;
            for (const properties of [current, defaults]) {
                if (properties.pluginProperties && equalProperties(properties.pluginProperties[key], entry)) {
                    delete properties.pluginProperties[key];
                }
            }
        }
        return !equalProperties(current, defaults);
    } catch {
        return true;
    }
}
