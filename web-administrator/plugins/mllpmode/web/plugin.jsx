/*
 * MLLP transmission mode — web admin plugin (mllpmode TransmissionModePlugin
 * equivalent, React-bundle authoring). Registers the MLLP framing mode for
 * connectors that expose a transmission mode (TCP). Default LLP frame bytes are
 * 0x0B (start) and 0x1C 0x0D (end).
 *
 * A TransmissionMode def has NO host-rendering render()/component of its own:
 * its UI surface is sampleFrame(tm) — a STRING preview rendered by the TCP
 * connector panel's dropdown — and openSettings(tm, onChange), an imperative
 * "Transmission Mode Settings" dialog. Per the uniform conversion rule, imperative
 * dialog helpers may still be CALLED from handlers, so the shared
 * frameModeSettingsDialog/frameModeSampleFrame helpers are kept as-is; apply(tm)
 * is pure object mutation. There is therefore no render(host)->component to
 * convert here — the def is unchanged except for sourcing the shared frame-mode
 * helpers from @oie/web-ui (which re-exports connectors/forms.js) so the file
 * builds as a bundled plugin.
 */
import { frameModeSampleFrame, frameModeSettingsDialog } from '@oie/web-ui';

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
