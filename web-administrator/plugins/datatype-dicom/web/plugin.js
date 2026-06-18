// plugins/datatype-dicom/web/plugin.jsx
import { platform } from "@oie/web-shell";
var React = platform.React;
var PKG = "com.mirth.connect.plugins.datatypes.dicom";
var DEF = {
  name: "DICOM",
  label: "DICOM",
  order: 90,
  propertiesClass: `${PKG}.DICOMDataTypeProperties`,
  groups: []
};
DEF.defaults = (version) => ({ "@class": DEF.propertiesClass, "@version": version });
function register(platform2) {
  platform2.registerDataType(DEF.name, DEF);
}
export {
  register
};
