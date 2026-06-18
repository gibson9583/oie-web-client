/*
 * DICOM data type — web admin plugin (React, DataTypeClientPlugin equivalent).
 * DICOMDataTypeProperties defines no property groups, so the editor shows none.
 *
 * Contributes a DATA definition only (no groups, no JSX). Authored as .jsx
 * under the React plugin contract, sharing the host's single React instance
 * via platform.React.
 */

import { platform } from '@oie/web-shell';
const React = platform.React;

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
