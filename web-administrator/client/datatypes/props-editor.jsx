/*
 * Shared data-type properties editor — renders the grouped property panels for
 * a data type (the web equivalent of the Swing DataTypePropertiesDialog), or a
 * raw JSON editor for unknown/plugin types. Used by the channel editor's "Set
 * Data Types" dialog and the transformer's Message Templates tab so both stay
 * in sync.
 *
 * React component (mounted by its consumers via mountReact). Properties are
 * mutated in place; grouped edits fire onChange(); editing an unknown type's raw
 * JSON fires onReplace(newObject) (the whole object is replaced). '@class',
 * '@version' and unknown keys are always preserved.
 */

import { useReducer } from 'react';
import { toast, modal, pickFile, createCodeEditor } from '@oie/web-ui';
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
        onClose: () => { editor.dispose && editor.dispose(); },
        buttons: [
            { label: 'Open File…', onClick: async () => { const file = await pickFile('.js,.txt'); if (file) { draft = file.content; editor.setValue(file.content); } return false; } },
            { label: 'Validate Script', onClick: () => { try { new Function(draft); toast('Script is valid.'); } catch (e) { toast(`Invalid script: ${e.message}`, 'error'); } return false; } },
            { label: 'Cancel' },
            { label: 'OK', primary: true, onClick: () => onSave(draft === '' ? null : draft) }
        ]
    });
}

/*
 * Which property groups display for a given direction/connector type, and under
 * what label — mirrors the engine's DataTypePropertiesTableModel:
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

// label/control/hint row, matching core/ui.js field() markup.
function Field({ label, hint, children }) {
    return (
        <div className="field">
            <label>{label}</label>
            {children}
            {hint ? <div className="hint">{hint}</div> : null}
        </div>
    );
}

// One grouped field; mutates groupObj[f.key] in place, then notifies (which
// re-renders so the controlled input reflects + fires the host onChange). The
// null/number/boolean coercions match the imperative editor verbatim.
function FieldControl({ groupObj, f, notify }) {
    const value = groupObj[f.key];
    switch (f.type) {
        case 'checkbox':
            return (
                <label className="check" title={f.hint || undefined}>
                    <input type="checkbox" checked={!!value}
                        onChange={(e) => { groupObj[f.key] = e.target.checked; notify(); }} />
                    {f.label}
                </label>
            );
        case 'number':
            return (
                <Field label={f.label} hint={f.hint}>
                    <input type="number" value={value ?? f.default ?? 0}
                        onChange={(e) => { groupObj[f.key] = Number(e.target.value) || 0; notify(); }} />
                </Field>
            );
        case 'select':
            return (
                <Field label={f.label} hint={f.hint}>
                    <select value={value ?? f.default ?? ''}
                        onChange={(e) => { groupObj[f.key] = e.target.value; notify(); }}>
                        {(f.options || []).map((opt, i) => {
                            const o = typeof opt === 'object' ? opt : { value: opt, label: String(opt) };
                            return <option key={i} value={o.value}>{o.label}</option>;
                        })}
                    </select>
                </Field>
            );
        case 'code':
            // Scripts open in a modal via an Edit button (Swing behavior).
            return (
                <Field label={f.label} hint={f.hint}>
                    <button type="button" className="btn btn-sm"
                        onClick={() => openScriptModal(groupObj[f.key], (v) => { groupObj[f.key] = v; notify(); })}>
                        {value && String(value).trim() ? 'Edit' : 'Edit…'}
                    </button>
                </Field>
            );
        default:   // text
            return (
                <Field label={f.label} hint={f.hint}>
                    <input type="text" value={value ?? ''}
                        onChange={(e) => { groupObj[f.key] = e.target.value === '' ? null : e.target.value; notify(); }} />
                </Field>
            );
    }
}

const GROUP_LABEL_CLASS = 'font-semibold text-[12px] uppercase tracking-[0.04em] text-[var(--text-dim,inherit)] border-b border-line pt-2.5 px-0 pb-1 mb-2';

/* Unknown/plugin data types: raw JSON editor over the properties object. */
function RawProperties({ typeName, props, onReplace }) {
    return (
        <Field label="Properties (JSON)" hint={`No schema registered for "${typeName}" — edit the raw properties`}>
            <textarea rows={14} spellCheck={false} defaultValue={JSON.stringify(props ?? {}, null, 2)}
                onBlur={(e) => { try { onReplace(JSON.parse(e.target.value)); } catch (err) { toast(`Invalid JSON: ${err.message}`, 'error'); } }} />
        </Field>
    );
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
export function DataTypePropertiesEditor({ typeName, props, version, direction = 'inbound', connectorType = 'SOURCE', onChange, onReplace }) {
    const [, tick] = useReducer((x) => x + 1, 0);
    const notify = () => { if (onChange) onChange(); tick(); };

    const def = dataTypeDef(typeName);
    if (!def) return <RawProperties typeName={typeName} props={props} onReplace={onReplace || (() => {})} />;

    const specs = groupSpecsFor(def, direction, connectorType);
    if (!specs.length) return <div className="text-text-faint py-2 px-0">This data type has no properties.</div>;

    const defaults = def.defaults(version);
    const byKey = new Map(def.groups.map((g) => [g.key, g]));
    return (
        <div>
            {specs.map((spec) => {
                const group = byKey.get(spec.key);
                if (!group) return null;
                // Older/partial channels may lack a group: seed it from defaults.
                const groupObj = (props[group.key] && typeof props[group.key] === 'object')
                    ? props[group.key]
                    : (props[group.key] = defaults[group.key]);
                return (
                    <div key={spec.key}>
                        <div className={GROUP_LABEL_CLASS}>{spec.label}</div>
                        <div className="flex flex-col gap-1.5">
                            {group.fields.map((f) => <FieldControl key={f.key} groupObj={groupObj} f={f} notify={notify} />)}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
