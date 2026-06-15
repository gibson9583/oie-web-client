/*
 * Connector framework — registers the generic JSON fallback ('*') used for any
 * connector type without a dedicated panel (e.g. a third-party connector with
 * no web UI yet).
 *
 * The bundled transports now load as plugins (plugins/connector-*); their panel
 * implementations live in this shared client connector library (./vm.js,
 * ./tcp.js, …) and build on the shared ./forms.js framework — the web
 * equivalent of Mirth's client-core that connector extensions depend on.
 */

import { h, toast } from '../core/ui.js';
import { createCodeEditor } from '../core/codeeditor.js';
import { frameModeSampleFrame, frameModeSettingsDialog } from './forms.js';

function genericPanel() {
    return {
        defaults(version) {
            return { '@version': version };
        },
        render(host, { properties, onChange }) {
            const editor = createCodeEditor({
                value: JSON.stringify(properties, null, 2),
                language: 'text',
                minHeight: '320px'
            });
            host.appendChild(h('div.hint', { style: { marginBottom: '6px' } },
                'No dedicated editor for this connector type — edit the raw properties JSON. "@class" and "@version" must be preserved.'));
            host.appendChild(editor.el);
            host.appendChild(h('div', { style: { marginTop: '8px' } },
                h('button.btn.btn-primary', {
                    onClick: () => {
                        let parsed;
                        try {
                            parsed = JSON.parse(editor.getValue());
                        } catch (e) {
                            toast('Invalid JSON: ' + e.message, 'error');
                            return;
                        }
                        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                            toast('Properties must be a JSON object', 'error');
                            return;
                        }
                        for (const key of Object.keys(properties)) {
                            if (!(key in parsed)) delete properties[key];
                        }
                        Object.assign(properties, parsed);
                        onChange();
                        toast('Properties applied');
                    }
                }, 'Apply')));
        }
    };
}

export function register(platform) {
    platform.registerConnectorPanel('*', 'SOURCE', genericPanel());
    platform.registerConnectorPanel('*', 'DESTINATION', genericPanel());

    // Basic TCP transmission mode (no framing) — the built-in TransmissionMode;
    // MLLP framing ships as the mllpmode plugin.
    platform.registerTransmissionMode('Basic', {
        label: 'Basic TCP', order: 20,
        apply(tm) { tm.pluginPointName = 'Basic'; tm.startOfMessageBytes = ''; tm.endOfMessageBytes = ''; },
        sampleFrame: frameModeSampleFrame,
        openSettings: frameModeSettingsDialog
    });
}
