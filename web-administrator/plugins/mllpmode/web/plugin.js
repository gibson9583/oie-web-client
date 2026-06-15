/*
 * MLLP transmission mode — web admin plugin (mllpmode TransmissionModePlugin
 * equivalent). Registers the MLLP framing mode for connectors that expose a
 * transmission mode (TCP). Default LLP frame bytes are 0x0B (start) and
 * 0x1C 0x0D (end). The frame-bytes settings dialog + sample-frame preview come
 * from the shared connector framework (/connectors/forms.js).
 */

import { frameModeSampleFrame, frameModeSettingsDialog } from '/connectors/forms.js';

export function register(platform) {
    platform.registerTransmissionMode('MLLP', {
        label: 'MLLP',
        order: 10,
        // Applied when MLLP is selected from the Transmission Mode dropdown.
        apply(tm) {
            tm.pluginPointName = 'MLLP';
            tm.startOfMessageBytes = '0B';
            tm.endOfMessageBytes = '1C0D';
        },
        sampleFrame: frameModeSampleFrame,
        openSettings: frameModeSettingsDialog
    });
}
