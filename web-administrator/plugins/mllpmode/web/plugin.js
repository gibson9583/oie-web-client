// plugins/mllpmode/web/plugin.tsx
import { scope as i18nScope, frameModeSampleFrame, frameModeSettingsDialog } from "@oie/web-ui";
var { t: translate } = i18nScope("mllpmode");
function register(platform) {
  platform.registerTransmissionMode("MLLP", {
    label: translate("MLLP"),
    order: 10,
    // Applied when MLLP is selected from the Transmission Mode dropdown. MLLP
    // serializes as MLLPModeProperties (a FrameModeProperties subclass) and
    // carries the extra MLLPv2 fields — see MLLPModeProperties defaults.
    apply(tm) {
      tm["@class"] = "com.mirth.connect.plugins.mllpmode.MLLPModeProperties";
      tm.pluginPointName = "MLLP";
      tm.startOfMessageBytes = "0B";
      tm.endOfMessageBytes = "1C0D";
      tm.useMLLPv2 = false;
      tm.ackBytes = "06";
      tm.nackBytes = "15";
      tm.maxRetries = "2";
    },
    sampleFrame: frameModeSampleFrame,
    openSettings: (tm, onChange) => frameModeSettingsDialog(tm, onChange, { mllp: true })
  });
}
export {
  register
};
