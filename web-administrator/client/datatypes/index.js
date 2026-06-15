/*
 * Data type registry access.
 *
 * Data types are not privileged core code: like the Swing client's
 * DataTypeClientPlugin model, every data type ships as a web plugin
 * (plugins/datatype-*) that registers a definition through
 * platform.registerDataType. The web admin's generic properties editor
 * (props-editor.js) renders whatever groups/fields a definition exposes, so a
 * third-party data type works exactly like the bundled ones.
 *
 * A data type definition (provided by each plugin):
 *   { name, label, order?, propertiesClass,
 *     defaults(version) → complete properties object ('@class'/'@version' on
 *                         the root and on every group),
 *     groups: [{ key, label, class, fields: [{ key, label, type, default,
 *                options?, hint? }] }] }
 *   Field types: 'text' | 'number' | 'checkbox' | 'select' | 'code'.
 *
 * This module is just the read side over the platform registry.
 */

import { platform } from '../core/platform.js';

/** Look up a registered data type definition; undefined for unknown types
 *  (the properties editor then shows a raw-JSON panel). */
export function dataTypeDef(name) {
    return platform.dataType(name);
}

/** Available data types for dropdowns, ordered by each plugin's `order`
 *  (then label) so the list is stable regardless of plugin load order. */
export function dataTypeList() {
    return [...platform.dataTypes().values()]
        .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || String(a.label).localeCompare(String(b.label)))
        .map(d => ({ name: d.name, label: d.label }));
}
