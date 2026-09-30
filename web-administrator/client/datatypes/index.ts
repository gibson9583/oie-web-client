import { compareText } from '../core/i18n.js';
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
 *   Field types: 'text' | 'number' | 'checkbox' | 'select' | 'code' | 'list'.
 *   List fields specify item: 'int' | 'string', optionally xmlNames: true.
 *
 * This module is just the read side over the platform registry.
 */

import { platform } from '@oie/web-shell';
import { normalizeDataTypeList } from '../core/datatype-arrays.js';

/** Look up a registered data type definition; undefined for unknown types
 *  (the properties editor then shows a raw-JSON panel). */
export function dataTypeDef(name: any) {
    return platform.dataType(name);
}

/** Validate every list in a dialog draft, including groups/rows not currently
 * mounted. Blank lists omit their keys; invalid text stays in the draft so OK
 * cannot silently commit the previous valid value. */
export function normalizeDataTypeProperties(name: any, props: any): string[] {
    const errors: string[] = [];
    const def = dataTypeDef(name);
    if (!def || !props || typeof props !== 'object') return errors;
    for (const group of def.groups || []) {
        const values = props[group.key];
        if (!values || typeof values !== 'object') continue;
        for (const field of group.fields || []) {
            if (field.type !== 'list') continue;
            const result = normalizeDataTypeList(values[field.key], field.item === 'int' ? 'int' : 'string', field.xmlNames);
            if (result.error) errors.push(`${group.label} — ${field.label}: ${result.error}`);
            else if (result.value === undefined) delete values[field.key];
            else values[field.key] = result.value;
        }
    }
    return errors;
}

/** Available data types for dropdowns, ordered by each plugin's `order`
 *  (then label) so the list is stable regardless of plugin load order. */
export function dataTypeList() {
    return [...platform.dataTypes().values()]
        .sort((a: any, b: any) => (a.order ?? 100) - (b.order ?? 100) || compareText(String(a.label), String(b.label)))
        .map(d => ({ name: d.name, label: d.label }));
}
