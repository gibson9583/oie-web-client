/*
 * Built-in transformer step and filter rule editors — web admin plugin (React).
 * (TransformerStepPlugin / FilterRulePlugin equivalent). Bundled steps/rules
 * are registered through the plugin loader, exactly like a third-party step or
 * rule plugin would be.
 *
 * React port of the imperative plugin.js: each step/rule def's render(host, ctx)
 * editor becomes a `component` (a React function component) that receives the
 * SAME ctx as PROPS ({ element, platform, onChange }) and RETURNS JSX instead of
 * appending to a host. All data/serialization logic (XStream list helpers, the
 * Iterator children model, the exact editor fields/labels/placeholders/hints) is
 * preserved VERBATIM; only the rendering layer is React/JSX. The imperative code
 * editor (platform.createCodeEditor) is still an imperative DOM island, mounted
 * into a ref'd <div> via useEffect (an imperative helper called from a handler).
 *
 * Field names mirror the engine's Java model exactly (XStream round-trip):
 *   FilterTransformerElement: name, sequenceNumber, enabled
 *   Rule (filter base):       operator (AND | OR | NONE)
 *   JavaScriptStep:           script
 *   MapperStep:               variable, mapping, defaultValue, replacements, scope
 *   MessageBuilderStep:       messageSegment, mapping, defaultValue, replacements
 *   XsltStep:                 sourceXml, resultVariable, template, useCustomFactory, customFactory
 *   DestinationSetFilterStep: behavior, metaDataIds, field, condition, values
 *   JavaScriptRule:           script
 *   RuleBuilderRule:          field, condition, values
 *   ExternalScriptStep/Rule:  scriptPath
 *   IteratorStep/Rule:        properties { target, indexVariable,
 *                                 prefixSubstitutions (List<String>),
 *                                 children (polymorphic element list) }
 */

import { platform } from '@oie/web-shell';
const React = platform.React;

const SCOPES = [
    { value: 'CHANNEL', label: 'Channel Map' },
    { value: 'CONNECTOR', label: 'Connector Map' },
    { value: 'GLOBAL_CHANNEL', label: 'Global Channel Map' },
    { value: 'GLOBAL', label: 'Global Map' },
    { value: 'RESPONSE', label: 'Response Map' }
];

const CONDITIONS = [
    { value: 'EXISTS', label: 'Exists' },
    { value: 'NOT_EXIST', label: 'Not Exist' },
    { value: 'EQUALS', label: 'Equals' },
    { value: 'NOT_EQUAL', label: 'Not Equal' },
    { value: 'CONTAINS', label: 'Contains' },
    { value: 'NOT_CONTAIN', label: 'Not Contain' }
];

const BEHAVIORS = [
    { value: 'REMOVE', label: 'Remove the following' },
    { value: 'REMOVE_ALL_EXCEPT', label: 'Remove all except the following' },
    { value: 'REMOVE_ALL', label: 'Remove all' }
];

/* Conditions that actually consume the Values list (the Swing DestinationSetFilter
   / RuleBuilder dialog greys the values table for EXISTS / NOT_EXIST). */
const CONDITION_USES_VALUES = new Set(['EQUALS', 'NOT_EQUAL', 'CONTAINS', 'NOT_CONTAIN']);

/* Per-element field validation — the web-admin port of each type plugin's
   checkProperties(properties, highlight). Each validator returns an error
   message ('' = valid), mirroring StringUtils.isBlank checks in the Swing
   client. The editor's validateAll runs these before returning to the channel.
   (JavaScript step/rule have no field check — their script is syntax-validated
   through the engine's Rhino compiler instead.) */
const isBlank = (v) => v == null || String(v).trim() === '';

/* ---- XStream list helpers ----------------------------------------------------
 * List<String>  round-trips as { string: [...] }  ('' when empty — an empty
 * XML element — so the server deserializes an empty list, not null).
 * List<Integer> round-trips as { int: [...] }.
 */

function stringListToLines(value) {
    if (!value || typeof value !== 'object') return [];
    const list = value.string;
    if (list === null || list === undefined) return [];
    return (Array.isArray(list) ? list : [list]).map(v => String(v ?? ''));
}

function linesToStringList(text) {
    const lines = String(text || '').split('\n').map(s => s.trim()).filter(Boolean);
    return lines.length ? { string: lines } : '';
}

/* DestinationSetFilter metaDataIds <-> the set of checked destination ids.
   Reads the List<Integer> shape ({ int: [...] } | '' | array); writes it back
   ordered by the destination list so the model round-trips deterministically
   (and stays compatible with step-script's reader). */
function checkedIdSet(value) {
    if (!value || typeof value !== 'object') return new Set();
    const list = value.int;
    if (list === null || list === undefined) return new Set();
    return new Set((Array.isArray(list) ? list : [list]).map(v => String(v)));
}

function idSetToMetaData(set, destinations) {
    const ordered = destinations.map(d => String(d.metaDataId)).filter(id => set.has(id));
    // Preserve any checked ids that aren't in the current destination list.
    for (const id of set) if (!ordered.includes(id)) ordered.push(id);
    return ordered.length ? { int: ordered } : '';
}

/* DestinationSetFilter values <-> an array of strings (List<String>). Unlike
   linesToStringList this does NOT drop blanks — the values table keeps empty
   rows the user is still typing into; '' stands in for an empty list. */
function stringArrayToList(arr) {
    return arr.length ? { string: arr.map(s => String(s ?? '')) } : '';
}

/* ---- JSX form helpers --------------------------------------------------------
 * JSX equivalents of core/ui.js field()/select() so the rendered DOM (and CSS
 * classes) match the imperative editors exactly:
 *   field(label, control, hint) -> <div class="field"><label/>{control}{hint}</div>
 *   select(options, value, ...) -> <select>{<option/>...}</select>
 */

function Field({ label, hint, children }) {
    return (
        <div className="field">
            <label>{label}</label>
            {children}
            {hint ? <div className="hint">{hint}</div> : null}
        </div>
    );
}

function Select({ options, value, onChange }) {
    return (
        <select value={value} onChange={onChange}>
            {options.map((opt) => {
                const o = typeof opt === 'object' ? opt : { value: opt, label: String(opt) };
                return <option key={String(o.value)} value={o.value}>{o.label}</option>;
            })}
        </select>
    );
}

/* A small force-update hook: the editors mutate the shared `element` object in
 * place (matching the imperative plugin), then call the host's onChange(); this
 * tick makes the controlled inputs reflect the mutation immediately. */
function useRerender() {
    const [, force] = React.useReducer((x) => x + 1, 0);
    return force;
}

/* Imperative code-editor island: platform.createCodeEditor builds a DOM editor;
 * we mount it once into a ref'd host and let its own onChange write through to
 * `element` + call the host onChange — the same wiring as the original. */
function CodeEditorIsland({ value, minHeight, fill, onChange }) {
    const hostRef = React.useRef(null);
    const editorRef = React.useRef(null);

    React.useEffect(() => {
        const editor = platform.createCodeEditor({
            value: value ?? '',
            minHeight,
            popoutable: true,   // full-screen code view; the transformer editor moves its
            popoutTitle: 'JavaScript',   // Reference/Templates/Trees panel in (oie:code-view)
            onChange
        });
        editorRef.current = editor;
        // In fill mode the editor grows to fill the (flex:1) field instead of
        // sitting at minHeight — minHeight stays as the floor.
        if (fill) { editor.el.style.flex = '1'; editor.el.style.minHeight = '0'; }
        hostRef.current.appendChild(editor.el);
        return () => {
            if (editor.el && editor.el.parentNode) editor.el.parentNode.removeChild(editor.el);
            editorRef.current = null;
        };
        // Mount once per element editor instance (the host remounts this when the
        // selected step/rule changes); the editor owns its value thereafter.
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return <div ref={hostRef} style={fill ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } : undefined} />;
}

/* Shared editors for the script/scriptPath step+rule types. */

function ScriptEditor({ element, onChange }) {
    return (
        <Field label="Script">
            <CodeEditorIsland
                value={element.script ?? ''}
                minHeight="260px"
                fill
                onChange={(value) => { element.script = value; onChange(); }}
            />
        </Field>
    );
}

function ScriptPathEditor({ element, onChange }) {
    const force = useRerender();
    return (
        <Field
            label="Script Path"
            hint="Path to a JavaScript file on the server — its contents are loaded when the channel is deployed"
        >
            <input
                type="text"
                placeholder="/opt/scripts/example.js"
                value={element.scriptPath ?? ''}
                onChange={(e) => { element.scriptPath = e.target.value; onChange(); force(); }}
            />
        </Field>
    );
}

/* ---- Iterator (step + rule) ---------------------------------------------------
 * IteratorStep/IteratorRule wrap a polymorphic list of child elements:
 *   properties { target, indexVariable, prefixSubstitutions, children }
 * The children container round-trips through the same shape as a filter or
 * transformer 'elements' map (mirth.elementsToArray / arrayToElements), with
 * '' standing in for an empty list so the server deserializes an empty
 * collection instead of null.
 */

function emptyIteratorProperties() {
    return { target: '', indexVariable: 'i', prefixSubstitutions: '', children: '' };
}

function makeIteratorEditor(isRule) {
    const type = isRule ? 'com.mirth.connect.model.IteratorRule' : 'com.mirth.connect.model.IteratorStep';
    const childNoun = isRule ? 'rule' : 'step';

    function IteratorEditor({ element, onChange }) {
        const force = useRerender();
        if (!element.properties || typeof element.properties !== 'object') {
            element.properties = emptyIteratorProperties();
        }
        const props = element.properties;

        return (
            <>
                <div className="form-grid">
                    <Field
                        label="Iterate On (target)"
                        hint="E4X XML node list or JavaScript array to iterate over"
                    >
                        <input
                            type="text"
                            placeholder="msg['OBX']"
                            value={props.target ?? ''}
                            onChange={(e) => { props.target = e.target.value; onChange(); force(); }}
                        />
                    </Field>
                    <Field label="Index Variable">
                        <input
                            type="text"
                            value={props.indexVariable ?? 'i'}
                            onChange={(e) => { props.indexVariable = e.target.value; onChange(); force(); }}
                        />
                    </Field>
                    <div className="span-2">
                        <Field
                            label="Prefix Substitutions"
                            hint="One prefix per line — when dragging values into children, the index variable (e.g. [i]) is injected after these prefixes"
                        >
                            <textarea
                                rows={3}
                                placeholder="msg['OBX']"
                                value={stringListToLines(props.prefixSubstitutions).join('\n')}
                                onChange={(e) => {
                                    props.prefixSubstitutions = linesToStringList(e.target.value);
                                    onChange();
                                    force();
                                }}
                            />
                        </Field>
                    </div>
                </div>

                {/* Children are managed in the main element list (nested under this
                    Iterator), matching the Swing tree-table — not edited here. */}
                <div className="text-text-faint pt-2.5 px-0 pb-0 text-[11px]">
                    {`Child ${childNoun}s appear nested under this Iterator in the ${childNoun} list. `
                        + `Add a ${childNoun} while a child is selected, or right-click a ${childNoun} and choose "Assign To Iterator".`}
                </div>
            </>
        );
    }

    return {
        label: 'Iterator',
        create: () => ({
            __type: type,
            name: '', enabled: true,
            ...(isRule ? { operator: 'AND' } : null),
            properties: emptyIteratorProperties()
        }),
        validate: (el) => {
            const p = el.properties || {};
            let m = '';
            if (isBlank(p.target)) m += 'The iteration target expression cannot be blank.\n';
            if (isBlank(p.indexVariable)) m += 'The iteration index variable cannot be blank.\n';
            return m.trim();
        },
        component: IteratorEditor
    };
}

/* ---- per-type editor components ---------------------------------------------- */

function MapperEditor({ element, onChange }) {
    const force = useRerender();
    return (
        <div className="form-grid">
            <Field label="Variable">
                <input
                    type="text"
                    value={element.variable ?? ''}
                    onChange={(e) => { element.variable = e.target.value; onChange(); force(); }}
                />
            </Field>
            <Field label="Add to">
                <Select
                    options={SCOPES}
                    value={element.scope || 'CHANNEL'}
                    onChange={(e) => { element.scope = e.target.value; onChange(); force(); }}
                />
            </Field>
            <div className="span-2">
                <Field label="Mapping">
                    <input
                        type="text"
                        value={element.mapping ?? ''}
                        onChange={(e) => { element.mapping = e.target.value; onChange(); force(); }}
                    />
                </Field>
            </div>
            <div className="span-2 mt-2">
                <Field label="Default Value">
                    <input
                        type="text"
                        value={element.defaultValue ?? ''}
                        onChange={(e) => { element.defaultValue = e.target.value; onChange(); force(); }}
                    />
                </Field>
            </div>
        </div>
    );
}

function MessageBuilderEditor({ element, onChange }) {
    const force = useRerender();
    return (
        <div className="form-grid">
            <div className="span-2">
                <Field label="Message Segment">
                    <input
                        type="text"
                        placeholder="tmp['MSH']['MSH.3']['MSH.3.1']"
                        value={element.messageSegment ?? ''}
                        onChange={(e) => { element.messageSegment = e.target.value; onChange(); force(); }}
                    />
                </Field>
            </div>
            <div className="span-2">
                <Field label="Mapping">
                    <input
                        type="text"
                        value={element.mapping ?? ''}
                        onChange={(e) => { element.mapping = e.target.value; onChange(); force(); }}
                    />
                </Field>
            </div>
            <div className="span-2">
                <Field label="Default Value">
                    <input
                        type="text"
                        value={element.defaultValue ?? ''}
                        onChange={(e) => { element.defaultValue = e.target.value; onChange(); force(); }}
                    />
                </Field>
            </div>
        </div>
    );
}

function XsltEditor({ element, onChange }) {
    const force = useRerender();
    return (
        <>
            <div className="form-grid">
                <Field label="Source XML String">
                    <input
                        type="text"
                        placeholder="msg"
                        value={element.sourceXml ?? ''}
                        onChange={(e) => { element.sourceXml = e.target.value; onChange(); force(); }}
                    />
                </Field>
                <Field label="Result Variable">
                    <input
                        type="text"
                        value={element.resultVariable ?? ''}
                        onChange={(e) => { element.resultVariable = e.target.value; onChange(); force(); }}
                    />
                </Field>
            </div>
            <Field label="XSLT Template">
                <CodeEditorIsland
                    value={element.template ?? ''}
                    minHeight="220px"
                    onChange={(value) => { element.template = value; onChange(); }}
                />
            </Field>
        </>
    );
}

/* Destination Set Filter — Swing-parity editor. The channel's destinations are
   threaded in as the `destinations` prop ([{metaDataId, name}, …]) by the
   filter/transformer view; other step editors ignore it, so it's backward
   compatible. metaDataIds is stored as the List<Integer> of CHECKED ids and
   values as a List<String>, in the same wire shape the model loaded with — a
   loaded element the user only renames round-trips untouched. */
function DestinationSetFilterEditor({ element, onChange, destinations }) {
    const force = useRerender();
    const [selValue, setSelValue] = React.useState(-1);

    const dests = Array.isArray(destinations) ? destinations : [];
    const behavior = element.behavior || 'REMOVE';
    const condition = element.condition || 'EXISTS';
    const checked = checkedIdSet(element.metaDataIds);
    const values = stringListToLines(element.values);

    const listDisabled = behavior === 'REMOVE_ALL';   // REMOVE_ALL takes no ids
    const valuesEnabled = CONDITION_USES_VALUES.has(condition);

    // ---- destination checkbox list ----
    const setChecked = (next) => { element.metaDataIds = idSetToMetaData(next, dests); onChange(); force(); };
    const toggleId = (id, on) => {
        const next = new Set(checked);
        if (on) next.add(String(id)); else next.delete(String(id));
        setChecked(next);
    };
    const selectAll = () => setChecked(new Set(dests.map(d => String(d.metaDataId))));
    const deselectAll = () => setChecked(new Set());

    // ---- values table ----
    const setValues = (arr) => { element.values = stringArrayToList(arr); onChange(); force(); };
    const newValue = () => { setValues([...values, '']); setSelValue(values.length); };
    const editValue = (i, v) => { const next = values.slice(); next[i] = v; setValues(next); };
    const deleteSelected = () => {
        if (selValue < 0 || selValue >= values.length) return;
        const next = values.slice();
        next.splice(selValue, 1);
        setValues(next);
        setSelValue(next.length ? Math.min(selValue, next.length - 1) : -1);
    };

    return (
        <div className="form-grid">
            <Field label="Behavior">
                <Select
                    options={BEHAVIORS}
                    value={behavior}
                    onChange={(e) => { element.behavior = e.target.value; onChange(); force(); }}
                />
            </Field>
            <Field label="Field">
                <input
                    type="text"
                    placeholder="msg['PID']['PID.3']['PID.3.1'].toString()"
                    value={element.field ?? ''}
                    onChange={(e) => { element.field = e.target.value; onChange(); force(); }}
                />
            </Field>

            <div className="span-2 mt-2">
                <Field label="Destinations">
                    <div className="flex gap-2 mb-1.5">
                        <button type="button" className="btn btn-sm" disabled={listDisabled} onClick={selectAll}>Select All</button>
                        <button type="button" className="btn btn-sm" disabled={listDisabled} onClick={deselectAll}>Deselect All</button>
                    </div>
                    <div
                        className="dt-wrap border border-line rounded max-h-[180px]"
                        style={listDisabled ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
                    >
                        <table className="dt">
                            <thead>
                                <tr>
                                    <th className="w-[42px]"></th>
                                    <th>Name</th>
                                    <th className="w-[70px]">Id</th>
                                </tr>
                            </thead>
                            <tbody>
                                {dests.length ? dests.map((d) => {
                                    const id = String(d.metaDataId);
                                    return (
                                        <tr key={id}>
                                            <td className="text-center">
                                                <input
                                                    type="checkbox"
                                                    checked={checked.has(id)}
                                                    disabled={listDisabled}
                                                    onChange={(e) => toggleId(id, e.target.checked)}
                                                />
                                            </td>
                                            <td>{d.name || `Destination ${id}`}</td>
                                            <td className="num">{id}</td>
                                        </tr>
                                    );
                                }) : (
                                    <tr><td colSpan={3}><span className="text-text-faint">No destinations on this channel</span></td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </Field>
            </div>

            <div className="span-2 mt-2">
                <Field label="Condition">
                    <div className="radio-group inline-row">
                        {CONDITIONS.map((opt) => (
                            <label className="check" key={opt.value}>
                                <input
                                    type="radio"
                                    name={`dsf-condition-${element.__type}`}
                                    checked={condition === opt.value}
                                    onChange={() => { element.condition = opt.value; onChange(); force(); }}
                                />
                                {opt.label}
                            </label>
                        ))}
                    </div>
                </Field>
            </div>

            <div className="span-2 mt-2">
                <Field label="Values" hint="Only used by Equals / Not Equal / Contains / Not Contain">
                    <div className="flex gap-2 mb-1.5">
                        <button type="button" className="btn btn-sm" disabled={!valuesEnabled} onClick={newValue}>New</button>
                        <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            disabled={!valuesEnabled || selValue < 0 || selValue >= values.length}
                            onClick={deleteSelected}
                        >Delete</button>
                    </div>
                    <div
                        className="dt-wrap border border-line rounded max-h-[180px]"
                        style={!valuesEnabled ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
                    >
                        <table className="dt">
                            <thead><tr><th>Value</th></tr></thead>
                            <tbody>
                                {values.length ? values.map((v, i) => (
                                    <tr
                                        key={i}
                                        className={selValue === i ? 'selected' : null}
                                        onClick={() => setSelValue(i)}
                                    >
                                        <td>
                                            <input
                                                type="text"
                                                value={v}
                                                disabled={!valuesEnabled}
                                                onFocus={() => setSelValue(i)}
                                                onChange={(e) => editValue(i, e.target.value)}
                                            />
                                        </td>
                                    </tr>
                                )) : (
                                    <tr><td><span className="text-text-faint">No values — use New</span></td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </Field>
            </div>
        </div>
    );
}

function RuleBuilderEditor({ element, onChange }) {
    const force = useRerender();
    return (
        <div className="form-grid">
            <Field label="Field">
                <input
                    type="text"
                    placeholder="msg['MSH']['MSH.9']['MSH.9.1'].toString()"
                    value={element.field ?? ''}
                    onChange={(e) => { element.field = e.target.value; onChange(); force(); }}
                />
            </Field>
            <Field label="Condition">
                <Select
                    options={CONDITIONS}
                    value={element.condition || 'EXISTS'}
                    onChange={(e) => { element.condition = e.target.value; onChange(); force(); }}
                />
            </Field>
            <div className="span-2">
                <Field label="Values">
                    <textarea
                        rows={4}
                        placeholder="One value per line"
                        title="Only used by Equals / Not Equal / Contains / Not Contain"
                        value={stringListToLines(element.values).join('\n')}
                        onChange={(e) => { element.values = linesToStringList(e.target.value); onChange(); force(); }}
                    />
                </Field>
            </div>
        </div>
    );
}

/* ---- registration ----------------------------------------------------------- */

export function register(platform) {

    /* ---- transformer steps ---- */

    platform.registerStepType('com.mirth.connect.plugins.javascriptstep.JavaScriptStep', {
        label: 'JavaScript',
        create: () => ({
            __type: 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep',
            name: '', enabled: true,
            script: '// Write your JavaScript here\n'
        }),
        component: ScriptEditor
    });

    platform.registerStepType('com.mirth.connect.plugins.mapper.MapperStep', {
        label: 'Mapper',
        create: () => ({
            __type: 'com.mirth.connect.plugins.mapper.MapperStep',
            name: '', enabled: true,
            variable: '', mapping: '', defaultValue: '', replacements: '', scope: 'CHANNEL'
        }),
        validate: (el) => isBlank(el.variable) ? 'The variable name cannot be blank.' : '',
        component: MapperEditor
    });

    platform.registerStepType('com.mirth.connect.plugins.messagebuilder.MessageBuilderStep', {
        label: 'Message Builder',
        create: () => ({
            __type: 'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep',
            name: '', enabled: true,
            messageSegment: '', mapping: '', defaultValue: '', replacements: ''
        }),
        validate: (el) => isBlank(el.messageSegment) ? 'The message segment value cannot be blank.' : '',
        component: MessageBuilderEditor
    });

    platform.registerStepType('com.mirth.connect.plugins.xsltstep.XsltStep', {
        label: 'XSLT Step',
        create: () => ({
            __type: 'com.mirth.connect.plugins.xsltstep.XsltStep',
            name: '', enabled: true,
            sourceXml: '', resultVariable: '', template: '',
            useCustomFactory: false, customFactory: ''
        }),
        validate: (el) => {
            let m = '';
            if (isBlank(el.sourceXml)) m += 'The source XML string cannot be blank.\n';
            if (isBlank(el.resultVariable)) m += 'The result variable cannot be blank.\n';
            return m.trim();
        },
        component: XsltEditor
    });

    platform.registerStepType('com.mirth.connect.plugins.destinationsetfilter.DestinationSetFilterStep', {
        label: 'Destination Set Filter',
        // Only available on the source transformer (DestinationSetFilterPlugin
        // .onlySourceConnector()); destinations/response transformers exclude it.
        onlySource: true,
        create: () => ({
            __type: 'com.mirth.connect.plugins.destinationsetfilter.DestinationSetFilterStep',
            name: '', enabled: true,
            behavior: 'REMOVE', metaDataIds: '', field: '', condition: 'EXISTS', values: ''
        }),
        validate: (el) => isBlank(el.field) ? 'The field cannot be blank.' : '',
        component: DestinationSetFilterEditor
    });

    platform.registerStepType('com.mirth.connect.plugins.scriptfilestep.ExternalScriptStep', {
        label: 'External Script',
        create: () => ({
            __type: 'com.mirth.connect.plugins.scriptfilestep.ExternalScriptStep',
            name: '', enabled: true,
            scriptPath: ''
        }),
        validate: (el) => isBlank(el.scriptPath) ? 'The script path cannot be blank.' : '',
        component: ScriptPathEditor
    });

    platform.registerStepType('com.mirth.connect.model.IteratorStep', makeIteratorEditor(false));

    /* ---- filter rules ---- */

    platform.registerRuleType('com.mirth.connect.plugins.javascriptrule.JavaScriptRule', {
        label: 'JavaScript',
        create: () => ({
            __type: 'com.mirth.connect.plugins.javascriptrule.JavaScriptRule',
            name: '', enabled: true, operator: 'AND',
            script: '// Return true to accept the message, false to filter it\nreturn true;'
        }),
        component: ScriptEditor
    });

    platform.registerRuleType('com.mirth.connect.plugins.rulebuilder.RuleBuilderRule', {
        label: 'Rule Builder',
        create: () => ({
            __type: 'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule',
            name: '', enabled: true, operator: 'AND',
            field: '', condition: 'EXISTS', values: ''
        }),
        validate: (el) => isBlank(el.field) ? 'The field cannot be blank.' : '',
        component: RuleBuilderEditor
    });

    platform.registerRuleType('com.mirth.connect.plugins.scriptfilerule.ExternalScriptRule', {
        label: 'External Script',
        create: () => ({
            __type: 'com.mirth.connect.plugins.scriptfilerule.ExternalScriptRule',
            name: '', enabled: true, operator: 'AND',
            scriptPath: ''
        }),
        validate: (el) => isBlank(el.scriptPath) ? 'The script path cannot be blank.' : '',
        component: ScriptPathEditor
    });

    platform.registerRuleType('com.mirth.connect.model.IteratorRule', makeIteratorEditor(true));
}
