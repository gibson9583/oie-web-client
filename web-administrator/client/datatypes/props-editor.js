/*
 * Shared data-type properties editor — renders the grouped property panels for
 * a data type (the web equivalent of the Swing DataTypePropertiesDialog), or a
 * raw JSON editor for unknown/plugin types. Used by the channel editor's "Set
 * Data Types" dialog and the transformer's Message Templates tab so both stay
 * in sync.
 *
 * Properties are mutated in place. Grouped edits fire onChange(); editing an
 * unknown type's raw JSON fires onReplace(newObject) (the whole object is
 * replaced). '@class', '@version' and unknown keys are always preserved.
 */

import { h, field, textInput, numberInput, select, checkbox, toast, modal, pickFile } from '@oie/web-ui';
import { createCodeEditor } from '@oie/web-ui';
import { dataTypeDef } from './index.js';

/* Script editor in a modal (the Swing data-type properties "Edit" → Script
   dialog): code editor + Open File / Validate Script / OK / Cancel. */
function openScriptModal(value, onSave) {
    let draft = String(value ?? '');
    const editor = createCodeEditor({ value: draft, language: 'javascript', minHeight: '360px', onChange: (v) => { draft = v; } });
    modal({
        title: 'Script',
        size: 'wide',
        body: editor.el,
        buttons: [
            { label: 'Open File…', onClick: async () => { const file = await pickFile('.js,.txt'); if (file) { draft = file.content; editor.setValue(file.content); } return false; } },
            { label: 'Validate Script', onClick: () => { try { new Function(draft); toast('Script is valid.'); } catch (e) { toast(`Invalid script: ${e.message}`, 'error'); } return false; } },
            { label: 'Cancel' },
            { label: 'OK', primary: true, onClick: () => onSave(draft === '' ? null : draft) }
        ]
    });
}

function fieldControl(groupObj, f, onChange) {
    const fire = () => onChange && onChange();
    const value = groupObj[f.key];
    switch (f.type) {
        case 'checkbox':
            return checkbox(f.label, !!value, {
                onChange: (e) => { groupObj[f.key] = e.target.checked; fire(); },
                title: f.hint || null
            }).el;
        case 'number':
            return field(f.label, numberInput(value ?? f.default ?? 0, {
                onInput: (e) => { groupObj[f.key] = Number(e.target.value) || 0; fire(); }
            }), f.hint);
        case 'select':
            return field(f.label, select(f.options, value ?? f.default, {
                onChange: (e) => { groupObj[f.key] = e.target.value; fire(); }
            }), f.hint);
        case 'code': {
            // Scripts open in a modal via an Edit button (Swing data-type
            // properties behavior) rather than rendering inline.
            const btn = h('button.btn.btn-sm', { type: 'button' },
                value && String(value).trim() ? 'Edit' : 'Edit…');
            btn.addEventListener('click', () => openScriptModal(groupObj[f.key], (v) => {
                groupObj[f.key] = v; fire();
                btn.textContent = v && String(v).trim() ? 'Edit' : 'Edit…';
            }));
            return field(f.label, btn, f.hint);
        }
        default:   // text
            return field(f.label, textInput(value ?? '', {
                onInput: (e) => { groupObj[f.key] = e.target.value === '' ? null : e.target.value; fire(); }
            }), f.hint);
    }
}

/*
 * Which property groups display for a given direction/connector type, and
 * under what label — mirrors the engine's DataTypePropertiesTableModel:
 *   inbound : Serialization, Batch (source), Response Generation (source),
 *             Response Validation (response)
 *   outbound: Deserialization, then serialization relabeled "Template Serialization"
 */
function groupSpecsFor(def, direction, connectorType) {
    const has = (key) => def.groups.some(g => g.key === key);
    const specs = [];
    if (direction === 'outbound') {
        if (has('deserializationProperties')) specs.push({ key: 'deserializationProperties', label: 'Deserialization' });
        if (has('serializationProperties')) specs.push({ key: 'serializationProperties', label: 'Template Serialization' });
    } else {
        if (has('serializationProperties')) specs.push({ key: 'serializationProperties', label: 'Serialization' });
        if (has('batchProperties') && connectorType === 'SOURCE') specs.push({ key: 'batchProperties', label: 'Batch' });
        if (has('responseGenerationProperties') && connectorType === 'SOURCE') specs.push({ key: 'responseGenerationProperties', label: 'Response Generation' });
        if (has('responseValidationProperties') && connectorType === 'RESPONSE') specs.push({ key: 'responseValidationProperties', label: 'Response Validation' });
    }
    return specs;
}

function renderGroups(def, props, version, onChange, specs) {
    const wrap = h('div');
    if (!specs.length) {
        wrap.appendChild(h('div.faint', { style: { padding: '8px 0' } },
            'This data type has no properties.'));
        return wrap;
    }
    const defaults = def.defaults(version);
    const byKey = new Map(def.groups.map(g => [g.key, g]));
    for (const spec of specs) {
        const group = byKey.get(spec.key);
        if (!group) continue;
        // Older/partial channels may lack a group: seed it from defaults.
        const groupObj = (props[group.key] && typeof props[group.key] === 'object')
            ? props[group.key]
            : (props[group.key] = defaults[group.key]);
        wrap.appendChild(h('div', {
            style: {
                fontWeight: '600', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.04em',
                color: 'var(--text-dim, inherit)', borderBottom: '1px solid var(--line)',
                padding: '10px 0 4px', marginBottom: '8px'
            }
        }, spec.label));
        const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
        for (const f of group.fields) body.appendChild(fieldControl(groupObj, f, onChange));
        wrap.appendChild(body);
    }
    return wrap;
}

/* Unknown/plugin data types: raw JSON editor over the properties object. */
function renderRawProperties(typeName, props, onReplace) {
    const area = h('textarea', { rows: 14, spellcheck: 'false' }, JSON.stringify(props ?? {}, null, 2));
    area.addEventListener('blur', () => {
        try {
            onReplace(JSON.parse(area.value));
        } catch (e) {
            toast(`Invalid JSON: ${e.message}`, 'error');
        }
    });
    return field('Properties (JSON)', area,
        `No schema registered for "${typeName}" — edit the raw properties`);
}

/**
 * Render the property editor for a data type, showing only the groups the Swing
 * client shows for the given direction/connector type.
 *   typeName       data type name (e.g. 'HL7V2')
 *   props          the properties object to edit (mutated in place)
 *   version        engine version (for seeding group defaults)
 *   direction      'inbound' | 'outbound'
 *   connectorType  'SOURCE' | 'DESTINATION' | 'RESPONSE' (default 'SOURCE')
 *   onChange       called after each grouped-field edit
 *   onReplace      called with a new object when an unknown type's raw JSON is edited
 */
export function dataTypePropertiesEditor(typeName, props, version,
    { direction = 'inbound', connectorType = 'SOURCE', onChange, onReplace } = {}) {
    const def = dataTypeDef(typeName);
    if (def) return renderGroups(def, props, version, onChange, groupSpecsFor(def, direction, connectorType));
    return renderRawProperties(typeName, props, onReplace || (() => {}));
}
