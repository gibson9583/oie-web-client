/*
 * Channel Reader (VmReceiverProperties) / Channel Writer (VmDispatcherProperties).
 *
 * React port: the def.render(host, ctx) panels become def.component(ctx) => JSX.
 * Field schemas + defaults are reused VERBATIM; only the rendering layer is JSX.
 * The Channel Id dropdown keeps its original imperative <select> (populated
 * asynchronously from channels.idsAndNames) as a `custom` field — the same DOM
 * node the panel always built, mounted into the React form.
 */

import { React } from './react-platform.js';
import { h, clear, select } from '@oie/web-ui';
import { ConnectorForm, mapEntries, defaultSourceProperties, defaultDestinationProperties } from './react-forms.js';

const channelReader = {
    defaults(version) {
        return {
            '@class': 'com.mirth.connect.connectors.vm.VmReceiverProperties',
            '@version': version,
            pluginProperties: null,
            sourceConnectorProperties: defaultSourceProperties(version)
        };
    },
    component() {
        return (
            <div className="cform-section">
                <div className="cform-section-title">Channel Reader Settings</div>
                <div className="hint" style={{ padding: '2px 0' }}>
                    Channel Reader listens for messages routed from other channels on this server. It has no connector-specific settings.
                </div>
            </div>
        );
    }
};

/* Channel id→name map is fetched once and cached for the editor's lifetime so a
   form repaint (after picking a channel) reuses it instead of re-fetching. */
let channelNamesPromise = null;
function loadChannelNames(platform) {
    if (!channelNamesPromise) channelNamesPromise = platform.api.channels.idsAndNames();
    return channelNamesPromise;
}

/* The Channel Id <select> DOM node — built once and populated asynchronously,
   identical to the original render(). Returned from a `custom` field. */
function channelSelectNode(properties, platform, onChange) {
    const channelSelect = select([{ value: 'none', label: '<None>' }], properties.channelId ?? 'none', {
        onChange: (e) => { properties.channelId = e.target.value; onChange(); }
    });
    loadChannelNames(platform).then((map) => {
        const current = String(properties.channelId ?? 'none');
        const options = [['none', '<None>'], ...mapEntries(map)];
        clear(channelSelect);
        for (const [value, label] of options) {
            channelSelect.appendChild(h('option', { value, selected: value === current }, label));
        }
    }).catch(() => { /* keep the static <None> option */ });
    return channelSelect;
}

const channelWriter = {
    defaults(version) {
        return {
            '@class': 'com.mirth.connect.connectors.vm.VmDispatcherProperties',
            '@version': version,
            pluginProperties: null,
            destinationConnectorProperties: defaultDestinationProperties(version),
            channelId: 'none',
            channelTemplate: '${message.encodedData}',
            mapVariables: null
        };
    },
    component({ properties, platform, onChange }) {
        return (
            <ConnectorForm properties={properties} onChange={onChange} fields={[
                { section: 'Channel Writer Settings' },
                {
                    type: 'custom', label: 'Channel Id', width: '320px', tooltip: 'Channel to write messages to',
                    render: () => channelSelectNode(properties, platform, onChange)
                },
                { key: 'channelTemplate', label: 'Template', type: 'code', minHeight: '340px' }
            ]} />
        );
    }
};

export function register(platform) {
    platform.registerConnectorPanel('Channel Reader', 'SOURCE', channelReader);
    platform.registerConnectorPanel('Channel Writer', 'DESTINATION', channelWriter);
}
