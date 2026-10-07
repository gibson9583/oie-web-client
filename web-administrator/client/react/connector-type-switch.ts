import { useEffect, useReducer, useRef, useState } from 'react';
import { platform } from '@oie/web-shell';
import { confirmDialog, errorModal, toast } from '@oie/web-ui';
import type { ConnectorMode } from '../core/platform.js';
import type { OieObject } from '../core/wire-types.js';
import { connectorHasNonDefaultProperties } from '../core/connector-defaults.js';
import { channelSessionActive } from './channel-persistence.js';

/** Shared by the classic dropdown and wizard picker. Confirm only when the
 * current connector differs from its defaults, just like Swing ChannelSetup. */
export function useConnectorTypeSwitch(connector: OieObject, mode: ConnectorMode, version: string, onChanged: () => void) {
    const [, bump] = useReducer((revision: number) => revision + 1, 0);
    const [switching, setSwitching] = useState(false);
    const switchingRef = useRef(false);
    const currentConnectorRef = useRef(connector);
    currentConnectorRef.current = connector;
    const mountedRef = useRef(true);
    useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

    async function switchType(name: string) {
        if (switchingRef.current || name === connector.transportName) return;
        const def = platform.connectorPanel(name, mode);
        if (!def || typeof def.defaults !== 'function') {
            bump(); // Restore the select's model value for engine-only types.
            toast(`"${name}" cannot be configured in the web administrator — install a web admin plugin that registers a connector panel for it.`, 'warn');
            return;
        }
        switchingRef.current = true;
        setSwitching(true);
        const isCurrentSession = channelSessionActive();
        const oldName = connector.transportName, oldProperties = connector.properties;
        try {
            // Build before changing either model field: a plugin default
            // factory failure must leave the old connector intact.
            const properties = def.defaults(version);
            if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
                throw new Error(`"${name}" did not provide valid default connector settings.`);
            }
            if (connectorHasNonDefaultProperties(connector, mode, version,
                platform.connectorPanel(oldName, mode), platform.connectorPropertiesPanels())) {
                const ok = await confirmDialog('Change Connector Type',
                    `Switch this connector to ${name}? Connector settings will reset to defaults (the filter and transformer are kept).`);
                if (!ok) return;
            }
            if (!mountedRef.current || !isCurrentSession() || currentConnectorRef.current !== connector
                || connector.transportName !== oldName || connector.properties !== oldProperties) return;
            connector.transportName = name;
            connector.properties = properties;
            onChanged();
        } catch (error) {
            errorModal('Change Connector Type Failed', error);
        } finally {
            switchingRef.current = false;
            if (mountedRef.current) { setSwitching(false); bump(); }
        }
    }

    return { switching, switchType };
}
