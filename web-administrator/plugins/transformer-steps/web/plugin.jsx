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
    { value: 'REMOVE', label: 'Remove the following destinations' },
    { value: 'REMOVE_ALL_EXCEPT', label: 'Remove all except the following destinations' },
    { value: 'REMOVE_ALL', label: 'Remove all destinations' }
];

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

function intListToText(value) {
    if (!value || typeof value !== 'object') return '';
    const list = value.int;
    if (list === null || list === undefined) return '';
    return (Array.isArray(list) ? list : [list]).join(', ');
}

function textToIntList(text) {
    const ids = String(text || '').split(/[,\s]+/).map(s => s.trim())
        .filter(s => s !== '' && !isNaN(Number(s))).map(s => String(parseInt(s, 10)));
    return ids.length ? { int: ids } : '';
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
                <div className="faint" style={{ padding: '10px 0 0', fontSize: '11px' }}>
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
                        placeholder="msg['MSH']['MSH.3']['MSH.3.1'].toString()"
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

function DestinationSetFilterEditor({ element, onChange }) {
    const force = useRerender();
    return (
        <div className="form-grid">
            <Field label="Behavior">
                <Select
                    options={BEHAVIORS}
                    value={element.behavior || 'REMOVE'}
                    onChange={(e) => { element.behavior = e.target.value; onChange(); force(); }}
                />
            </Field>
            <Field
                label="Destination Meta Data Ids"
                hint="Comma-separated destination metaDataIds this filter applies to"
            >
                <input
                    type="text"
                    placeholder="e.g. 1, 2"
                    value={intListToText(element.metaDataIds)}
                    onChange={(e) => { element.metaDataIds = textToIntList(e.target.value); onChange(); force(); }}
                />
            </Field>
            <Field label="Field">
                <input
                    type="text"
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
        component: MapperEditor
    });

    platform.registerStepType('com.mirth.connect.plugins.messagebuilder.MessageBuilderStep', {
        label: 'Message Builder',
        create: () => ({
            __type: 'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep',
            name: '', enabled: true,
            messageSegment: '', mapping: '', defaultValue: '', replacements: ''
        }),
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
        component: DestinationSetFilterEditor
    });

    platform.registerStepType('com.mirth.connect.plugins.scriptfilestep.ExternalScriptStep', {
        label: 'External Script',
        create: () => ({
            __type: 'com.mirth.connect.plugins.scriptfilestep.ExternalScriptStep',
            name: '', enabled: true,
            scriptPath: ''
        }),
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
        component: RuleBuilderEditor
    });

    platform.registerRuleType('com.mirth.connect.plugins.scriptfilerule.ExternalScriptRule', {
        label: 'External Script',
        create: () => ({
            __type: 'com.mirth.connect.plugins.scriptfilerule.ExternalScriptRule',
            name: '', enabled: true, operator: 'AND',
            scriptPath: ''
        }),
        component: ScriptPathEditor
    });

    platform.registerRuleType('com.mirth.connect.model.IteratorRule', makeIteratorEditor(true));
}
