/*
 * DICOM data type — web admin plugin (DataTypeClientPlugin equivalent).
 * DICOMDataTypeProperties defines no property groups, so the editor shows none.
 */

const PKG = 'com.mirth.connect.plugins.datatypes.dicom';

const DEF = {
    name: 'DICOM', label: 'DICOM', order: 90,
    propertiesClass: `${PKG}.DICOMDataTypeProperties`,
    groups: []
};

DEF.defaults = (version) => ({ '@class': DEF.propertiesClass, '@version': version });

export function register(platform) {
    platform.registerDataType(DEF.name, DEF);
}
