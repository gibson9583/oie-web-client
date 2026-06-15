/*
 * Channel Reader (VmReceiverProperties) / Channel Writer (VmDispatcherProperties).
 */

import { h, clear, select } from '../core/ui.js';
import { buildForm, mapEntries, defaultSourceProperties, defaultDestinationProperties } from './forms.js';

const channelReader = {
    defaults(version) {
        return {
            '@class': 'com.mirth.connect.connectors.vm.VmReceiverProperties',
            '@version': version,
            pluginProperties: null,
            sourceConnectorProperties: defaultSourceProperties(version)
        };
    },
    render(host) {
        host.appendChild(h('div.cform-section',
            h('div.cform-section-title', 'Channel Reader Settings'),
            h('div.hint', { style: { padding: '2px 0' } },
                'Channel Reader listens for messages routed from other channels on this server. It has no connector-specific settings.')));
    }
};

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
    render(host, { properties, platform, onChange }) {
        const formHost = h('div');
        host.appendChild(formHost);
        const channelSelect = select([{ value: 'none', label: '<None>' }], properties.channelId ?? 'none', {
            onChange: (e) => { properties.channelId = e.target.value; onChange(); }
        });
        buildForm(formHost, properties, [
            { section: 'Channel Writer Settings' },
            { type: 'custom', label: 'Channel Id', width: '320px', tooltip: 'Channel to write messages to', render: () => channelSelect },
            { key: 'channelTemplate', label: 'Template', type: 'code', minHeight: '340px' }
        ], onChange);

        platform.api.channels.idsAndNames().then(map => {
            const current = String(properties.channelId ?? 'none');
            const options = [['none', '<None>'], ...mapEntries(map)];
            clear(channelSelect);
            for (const [value, label] of options) {
                channelSelect.appendChild(h('option', { value, selected: value === current }, label));
            }
        }).catch(() => { /* keep the static <None> option */ });
    }
};

export function register(platform) {
    platform.registerConnectorPanel('Channel Reader', 'SOURCE', channelReader);
    platform.registerConnectorPanel('Channel Writer', 'DESTINATION', channelWriter);
}
