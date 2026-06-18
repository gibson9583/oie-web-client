// plugins/mllpmode/web/plugin.jsx
import { frameModeSampleFrame, frameModeSettingsDialog } from "@oie/web-ui";
function register(platform) {
  platform.registerTransmissionMode("MLLP", {
    label: "MLLP",
    order: 10,
    // Applied when MLLP is selected from the Transmission Mode dropdown.
    apply(tm) {
      tm.pluginPointName = "MLLP";
      tm.startOfMessageBytes = "0B";
      tm.endOfMessageBytes = "1C0D";
    },
    sampleFrame: frameModeSampleFrame,
    openSettings: frameModeSettingsDialog
  });
}
export {
  register
};
