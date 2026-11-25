// plugins/mllpmode/web/plugin.tsx
import { frameModeSampleFrame, frameModeSettingsDialog } from "@oie/web-ui";
var mllpPropertiesClass = "com.mirth.connect.plugins.mllpmode.MLLPModeProperties";
function register(platform) {
  platform.registerTransmissionMode("MLLP", {
    label: "MLLP",
    order: 10,
    // Applied when MLLP is selected from the Transmission Mode dropdown. MLLP
    // serializes as MLLPModeProperties (a FrameModeProperties subclass) and
    // carries the extra MLLPv2 fields — see MLLPModeProperties defaults.
    apply(tm) {
      tm["@class"] = mllpPropertiesClass;
      tm.pluginPointName = "MLLP";
      tm.startOfMessageBytes = "0B";
      tm.endOfMessageBytes = "1C0D";
      tm.useMLLPv2 = false;
      tm.ackBytes = "06";
      tm.nackBytes = "15";
      tm.maxRetries = "2";
    },
    sampleFrame: frameModeSampleFrame,
    openSettings: (tm, onChange) => frameModeSettingsDialog(tm, () => {
      if (tm["@class"] === "com.mirth.connect.model.transmission.framemode.FrameModeProperties") {
        tm["@class"] = mllpPropertiesClass;
      }
      onChange();
    }, { mllp: true })
  });
}
export {
  register
};
