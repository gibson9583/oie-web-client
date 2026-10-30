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
import type { Platform } from '@oie/web-shell';
import { iteratorTree, iteratorSampleCount } from '/core/mapping-model.js';
import { replacementPairs, replacementsToWire } from '/core/step-replacements.js';
import type { Replacement } from '/core/step-replacements.js';
const React = platform.React;

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
const isBlank = (v: any) => v == null || String(v).trim() === '';

/* ---- XStream list helpers ----------------------------------------------------
 * List<String>  round-trips as { string: [...] }  ('' when empty — an empty
 * XML element — so the server deserializes an empty list, not null).
 * List<Integer> round-trips as { int: [...] }.
 */

function stringListToLines(value: any) {
    if (!value || typeof value !== 'object') return [];
    const list = value.string;
    if (list === null || list === undefined) return [];
    return (Array.isArray(list) ? list : [list]).map(v => String(v ?? ''));
}

function linesToStringList(text: any) {
    const lines = String(text || '').split('\n').map(s => s.trim()).filter(Boolean);
    return lines.length ? { string: lines } : '';
}

/* DestinationSetFilter metaDataIds <-> the set of checked destination ids.
   Reads the List<Integer> shape ({ int: [...] } | '' | array); writes it back
   ordered by the destination list so the model round-trips deterministically
   (and stays compatible with step-script's reader). */
function checkedIdSet(value: any) {
    if (!value || typeof value !== 'object') return new Set();
    const list = value.int;
    if (list === null || list === undefined) return new Set();
    return new Set((Array.isArray(list) ? list : [list]).map(v => String(v)));
}

function idSetToMetaData(set: any, destinations: any) {
    const ordered = destinations.map((d: any) => String(d.metaDataId)).filter((id: any) => set.has(id));
    // Preserve any checked ids that aren't in the current destination list.
    for (const id of set) if (!ordered.includes(id)) ordered.push(id);
    return ordered.length ? { int: ordered } : '';
}

/* DestinationSetFilter values <-> an array of strings (List<String>). Unlike
   linesToStringList this does NOT drop blanks — the values table keeps empty
   rows the user is still typing into; '' stands in for an empty list. */
function stringArrayToList(arr: any) {
    return arr.length ? { string: arr.map((s: any) => String(s ?? '')) } : '';
}

/* ---- JSX form helpers --------------------------------------------------------
 * JSX equivalents of core/ui.js field()/select() so the rendered DOM (and CSS
 * classes) match the imperative editors exactly:
 *   field(label, control, hint) -> <div class="field"><label/>{control}{hint}</div>
 *   select(options, value, ...) -> <select>{<option/>...}</select>
 */

function Field({ label, hint, children }: any) {
    return (
        <div className="field">
            <label>{label}</label>
            {children}
            {hint ? <div className="hint">{hint}</div> : null}
        </div>
    );
}

function Select({ options, value, onChange }: any) {
    return (
        <select value={value} onChange={onChange}>
            {options.map((opt: any) => {
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
    const [, force] = React.useReducer((x: any) => x + 1, 0);
    return force;
}

/* Imperative code-editor island: platform.createCodeEditor builds a DOM editor;
 * we mount it once into a ref'd host and let its own onChange write through to
 * `element` + call the host onChange — the same wiring as the original. */
function CodeEditorIsland({ value, minHeight, fill, onChange }: any) {
    const hostRef = React.useRef(null as any);
    const editorRef = React.useRef(null as any);

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

function ScriptEditor({ element, onChange }: any) {
    return (
        <Field label="Script">
            <CodeEditorIsland
                value={element.script ?? ''}
                minHeight="260px"
                fill
                onChange={(value: any) => { element.script = value; onChange(); }}
            />
        </Field>
    );
}

function ScriptPathEditor({ element, onChange }: any) {
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
                onChange={(e: any) => { element.scriptPath = e.target.value; onChange(); force(); }}
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

function makeIteratorEditor(isRule: any) {
    const type = isRule ? 'com.mirth.connect.model.IteratorRule' : 'com.mirth.connect.model.IteratorStep';
    const childNoun = isRule ? 'rule' : 'step';

    function IteratorEditor({ element, onChange }: any) {
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
                            onChange={(e: any) => { props.target = e.target.value; onChange(); force(); }}
                        />
                    </Field>
                    <Field label="Index Variable">
                        <input
                            type="text"
                            value={props.indexVariable ?? 'i'}
                            onChange={(e: any) => { props.indexVariable = e.target.value; onChange(); force(); }}
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
                                onChange={(e: any) => {
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
                <div className="text-text-faint pt-2.5 px-0 pb-0 text-[10px]">
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
        validate: (el: any) => {
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

function StringReplacementEditor({ element, onChange }: any) {
    const [rows, setRows] = React.useState(() => replacementPairs(element));
    const [selected, setSelected] = React.useState(-1);
    const commit = (next: Replacement[]) => {
        element.replacements = replacementsToWire(next);
        setRows(next);
        onChange();
    };
    const edit = (index: number, side: number, value: string) => {
        const next = rows.map((row: Replacement) => [...row] as Replacement);
        next[index][side] = value;
        commit(next);
    };
    return (
        <div className="span-2 mt-2 min-w-0" role="group" aria-label="String Replacement">
            <Field label="String Replacement">
                <div className="flex gap-2 mb-1.5">
                    <button type="button" className="btn btn-sm" onClick={() => {
                        commit([...rows, ['', '']]);
                        setSelected(rows.length);
                    }}>New</button>
                    <button type="button" className="btn btn-sm btn-danger" disabled={selected < 0 || selected >= rows.length} onClick={() => {
                        const next = rows.filter((_: Replacement, i: number) => i !== selected);
                        commit(next);
                        setSelected(next.length ? Math.min(selected, next.length - 1) : -1);
                    }}>Delete</button>
                </div>
                <div className="dt-wrap border border-line rounded max-h-[260px]">
                    <table className="dt w-full table-fixed" aria-label="String replacements">
                        <thead><tr><th scope="col">Regular Expression</th><th scope="col">Replace With</th></tr></thead>
                        <tbody>
                            {rows.length ? rows.map((row: Replacement, i: number) => (
                                <tr key={i} className={selected === i ? 'selected' : undefined} onClick={() => setSelected(i)}>
                                    {row.map((value: string, side: number) => (
                                        <td key={side}>
                                            <input type="text" spellCheck={false} aria-label={`${side === 0 ? 'Regular Expression' : 'Replace With'} ${i + 1}`}
                                                value={value} onFocus={() => setSelected(i)}
                                                onChange={(e: any) => edit(i, side, e.target.value)} />
                                        </td>
                                    ))}
                                </tr>
                            )) : <tr><td colSpan={2}><span className="text-text-faint">No replacements — use New</span></td></tr>}
                        </tbody>
                    </table>
                </div>
            </Field>
        </div>
    );
}

/* ---- Mapper / Message Builder (guided) ----------------------------------------
 * Both steps read as one statement: Set <variable | outbound field> = <value>.
 * Every Swing control is here (Variable, Add to, Message Segment, Mapping,
 * Default Value, String Replacement); the value gets four ways in (message
 * field, text, map variable, JavaScript) that all write the same `mapping`
 * expression. Transformer hosts pass messageTree / MessageFieldPicker /
 * variables (API 4.11); without them the editor still works as plain fields.
 */

let mapUid = 0;

/* Swing combo order (MapperStep.Scope). `read` is the shorthand that reads it back. */
const SCOPE_CARDS = [
    { value: 'CONNECTOR', label: 'Connector Map', hint: 'This connector, this message', read: '$co' },
    { value: 'CHANNEL', label: 'Channel Map', hint: 'All connectors, this message', read: '$c' },
    { value: 'GLOBAL_CHANNEL', label: 'Global Channel Map', hint: 'Shared across messages in this channel. Clearing on deploy depends on channel settings.', read: '$gc' },
    { value: 'GLOBAL', label: 'Global Map', hint: 'Shared across channels. Clearing on server start depends on server settings.', read: '$g' },
    { value: 'RESPONSE', label: 'Response Map', hint: 'Response variables, this message', read: '$r' }
];

const VAR_FNS = [
    { value: '$c', label: 'Channel' },
    { value: '$co', label: 'Connector' },
    { value: '$gc', label: 'Global Channel' },
    { value: '$g', label: 'Global' },
    { value: '$r', label: 'Response' },
    { value: '$s', label: 'Source' },
    { value: '$cfg', label: 'Configuration' },
    { value: '$', label: 'Any map' }
];

const VALUE_MODES = [
    { value: 'field', label: 'Message field' },
    { value: 'text', label: 'Text' },
    { value: 'variable', label: 'Variable' },
    { value: 'js', label: '{ } JavaScript' }
];

const INBOUND_PATH_RE = /^msg(?:\[(?:'(?:[^'\\]|\\.)*'|\d+|[A-Za-z_$][\w$]*)\])+(?:\.toString\(\))?$/;
const VARIABLE_RE = /^(\$(?:gc|co|cfg|g|c|r|s)?)\(\s*'((?:[^'\\]|\\.)*)'\s*\)$/;

/* JavaScript string literal <-> value (same rules as core/mapping-model). */
function literalValue(expr: any): string | null {
    const m = /^(['"])((?:\\.|(?!\1)[^\\\n])*)\1$/.exec(String(expr ?? '').trim());
    if (!m) return null;
    return m[2].replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_all: string, c: string) => {
        if (c[0] === 'u' || c[0] === 'x') return c.length > 1 ? String.fromCharCode(parseInt(c.slice(1), 16)) : c;
        return ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' } as any)[c] ?? c;
    });
}
function quoted(value: any) {
    return `'${String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, '\\\'').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;
}

function parseValue(src: any) {
    const s = String(src ?? '').trim();
    if (!s) return { mode: '' };
    if (INBOUND_PATH_RE.test(s)) return { mode: 'field', field: s };
    const lit = literalValue(s);
    if (lit !== null) return { mode: 'text', text: lit };
    const v = VARIABLE_RE.exec(s);
    if (v) return { mode: 'variable', fn: v[1], name: literalValue(`'${v[2]}'`) ?? v[2] };
    return { mode: 'js' };
}

function flattenTree(nodes: any[], parent: any = null, out: any[] = []) {
    for (const n of nodes || []) {
        out.push({ node: n, parent });
        flattenTree(n.children, n, out);
    }
    return out;
}

/* A lone .1 component is the field itself, as in the Message Trees rows. */
function fieldLabel({ node, parent }: any) {
    const lone = parent?.desc && parent.children.length === 1 && node.name === `${parent.name}.1` && !node.children.length;
    return lone ? `${node.name} (${parent.desc})` : node.label;
}

/* Undefined while loading; null when there is no usable template. */
function useMessageTree(messageTree: any, side: 'inbound' | 'outbound', revision = 0) {
    const [nodes, setNodes] = React.useState(undefined as any);
    React.useEffect(() => {
        if (typeof messageTree !== 'function') return undefined;
        let alive = true;
        setNodes(undefined);
        Promise.resolve().then(() => messageTree(side)).then((n: any) => { if (alive) setNodes(n || null); }, () => { if (alive) setNodes(null); });
        return () => { alive = false; };
    }, [messageTree, side, revision]);
    return nodes;
}

/* Inline field picker. The host draws the same tree-table as Message Trees. */
function PathPicker({ MessageFieldPicker, nodes, title, value, onPick, onClose, messageSide, onMessageSide, onRetry }: any) {
    const boxRef = React.useRef(null as any);
    React.useEffect(() => { boxRef.current.scrollIntoView({ block: 'nearest' }); }, []);
    React.useEffect(() => {
        const away = (e: any) => { if (boxRef.current && !boxRef.current.contains(e.target)) onClose(); };
        const esc = (e: any) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('mousedown', away);
        document.addEventListener('keydown', esc);
        return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
    }, [onClose]);
    return (
        <div className="map-picker" ref={boxRef} role="dialog" aria-label={title}>
            <MessageFieldPicker side={messageSide} onSide={onMessageSide} nodes={nodes} value={value} onPick={onPick} onRetry={onRetry} />
        </div>
    );
}

/* Field-path input with Browse. Drops from the Message Trees tab still land in the input. */
function FieldInput({ value, nodes, side, placeholder, ariaLabel, onValue, targetTrees, onRetry, MessageFieldPicker }: any) {
    const [open, setOpen] = React.useState(false);
    const targetSide = /^\s*tmp\b/.test(value) ? 'outbound' : 'inbound';
    const [browseSide, setBrowseSide] = React.useState(targetSide);
    const close = React.useCallback(() => setOpen(false), []);
    const selected = flattenTree((targetTrees ? targetTrees[targetSide] : nodes) || []).find(({ node }: any) =>
        String(node.accessor).replace(/\.toString\(\)\s*$/, '') === String(value).replace(/\.toString\(\)\s*$/, ''));
    return (
        <div className="map-field">
            <button type="button" className="map-field-choice" aria-expanded={open}
                title={selected ? `${fieldLabel(selected)}\n${value}` : value}
                aria-label={`Browse ${targetTrees ? 'target' : side} fields`} onClick={() => {
                    if (!open) setBrowseSide(targetSide);
                    setOpen((o: any) => !o);
                }}>
                <span>{selected ? `${targetTrees ? `${targetSide === 'outbound' ? 'tmp' : 'msg'} › ` : ''}${fieldLabel(selected)}` : value || 'Choose a field…'}</span><span>Browse…</span>
            </button>
            <details className="map-raw-path"><summary>Edit path expression</summary>
                <input type="text" className="mono" placeholder={placeholder} aria-label={ariaLabel}
                    data-message-target={targetTrees ? true : undefined}
                    value={value} onChange={(e: any) => onValue(e.target.value)} />
            </details>
            {open && MessageFieldPicker ? (
                <PathPicker MessageFieldPicker={MessageFieldPicker} nodes={targetTrees ? targetTrees[browseSide] : nodes}
                    title={targetTrees ? 'Target fields' : side === 'outbound' ? 'Outbound fields' : 'Inbound fields'} onClose={close}
                    value={value} messageSide={targetTrees ? browseSide : side} onMessageSide={targetTrees ? setBrowseSide : undefined} onRetry={onRetry}
                    onPick={(node: any) => {
                        const acc = String(node.accessor);
                        onValue(targetTrees || side === 'outbound' ? acc.replace(/\.toString\(\)\s*$/, '') : acc);
                        setOpen(false);
                    }} />
            ) : null}
        </div>
    );
}

/* The value (`mapping`) editor: four modes over one expression. Drafts keep
   each mode's last input while the editor is open, so switching modes and
   back does not lose work. */
function ValueEditor({ element, onChange, inbound, variables, defaultMode, onRetry, MessageFieldPicker }: any) {
    const force = useRerender();
    const initial = React.useMemo(() => parseValue(element.mapping), []); // eslint-disable-line react-hooks/exhaustive-deps
    const [mode, setMode] = React.useState(initial.mode || defaultMode);
    const drafts = React.useRef({
        field: initial.mode === 'field' ? initial.field : '',
        text: initial.mode === 'text' ? initial.text : '',
        fn: initial.mode === 'variable' ? initial.fn : '$c',
        name: initial.mode === 'variable' ? initial.name : '',
        js: String(element.mapping ?? '')
    } as any).current;
    const vars = typeof variables === 'function' ? variables() : [];
    const listId = React.useMemo(() => `map-vars-${++mapUid}`, []);

    const expr = (m: string) => {
        if (m === 'field') return drafts.field;
        if (m === 'text') return quoted(drafts.text);
        if (m === 'variable') return drafts.name ? `${drafts.fn}(${quoted(drafts.name)})` : '';
        return drafts.js;
    };
    const write = (m: string) => {
        element.mapping = expr(m);
        if (m !== 'js') drafts.js = element.mapping;
        onChange();
        force();
    };
    const setDraft = (key: string, v: any, m: string) => { drafts[key] = v; write(m); };
    const setters = vars.filter((v: any) => v.name === drafts.name);

    return (
        <div className="map-value">
            <select aria-label="Value type" value={mode}
                onChange={(e: any) => { const m = e.target.value; if (m === mode) return; setMode(m); write(m); }}>
                {VALUE_MODES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {mode === 'field' && (
                <FieldInput value={drafts.field} nodes={inbound} side="inbound" ariaLabel="Message field"
                    onRetry={onRetry} MessageFieldPicker={MessageFieldPicker}
                    placeholder="msg['PID']['PID.3']['PID.3.1'].toString()"
                    onValue={(v: any) => setDraft('field', v, 'field')} />
            )}
            {mode === 'text' && (
                <input type="text" aria-label="Text value" placeholder="Fixed text"
                    value={drafts.text} onChange={(e: any) => setDraft('text', e.target.value, 'text')} />
            )}
            {mode === 'variable' && (
                <div className="map-field-row">
                    <select aria-label="Map" value={drafts.fn} onChange={(e: any) => setDraft('fn', e.target.value, 'variable')}>
                        {VAR_FNS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                    <input type="text" className="mono" aria-label="Variable name" placeholder="variableName"
                        list={listId} value={drafts.name} onChange={(e: any) => setDraft('name', e.target.value, 'variable')} />
                    <datalist id={listId}>
                        {[...new Set(vars.map((v: any) => v.name))].map((n: any) => <option key={n} value={n} />)}
                    </datalist>
                </div>
            )}
            {mode === 'variable' && drafts.name && (
                <div className="hint">{setters.length
                    ? `Set by step ${setters.map((v: any) => v.step).join(', ')}`
                    : 'Not set by another step in this transformer.'}</div>
            )}
            {mode === 'js' && (
                <input type="text" className="mono" aria-label="JavaScript value" placeholder="Any JavaScript expression"
                    value={drafts.js} onChange={(e: any) => setDraft('js', e.target.value, 'js')} />
            )}
        </div>
    );
}

/* The host supplies the real ancestor stack; picker samples never change it. */
function MappingEditor({ element, onChange, messageTree, MessageFieldPicker, variables, iteratorContext, builder = false }: any) {
    const [, bumpRev] = React.useReducer((x: number) => x + 1, 0);
    const [iteratorIndices, setIndices] = React.useState({} as Record<string, number>);
    const [treeRevision, reloadTrees] = React.useReducer((x: number) => x + 1, 0);
    const reloadFields = () => { reloadTrees(); bumpRev(); };
    const inbound = useMessageTree(messageTree, 'inbound', treeRevision);
    const outbound = useMessageTree(builder ? messageTree : null, 'outbound', treeRevision);
    const contexts = typeof iteratorContext === 'function' ? iteratorContext() : [];
    const sampleOptions = { iteratorIndices };
    const pickedInbound = iteratorTree(inbound, contexts, sampleOptions);
    const pickedOutbound = iteratorTree(outbound, contexts, sampleOptions);
    const change = () => { onChange(); bumpRev(); };
    const name = String(element.variable ?? '');
    const scope = element.scope || 'CHANNEL';
    const card = SCOPE_CARDS.find(s => s.value === scope);
    const dupes = !builder && typeof variables === 'function' && name.trim()
        ? variables().filter((v: any) => v.name === name.trim()) : [];
    const summary = [!builder ? card?.label || scope : '',
        replacementPairs(element).length ? `${replacementPairs(element).length} replacement(s)` : ''].filter(Boolean).join(' · ');
    return (
        <div className="map-editor">
            {contexts.length ? <div className="map-iterator-context" aria-label="Iterator context">
                {contexts.map((context: any, i: number) => {
                    const count = iteratorSampleCount(inbound, context, contexts, sampleOptions);
                    const index = iteratorIndices[context.indexVariable] ?? 0;
                    return <div key={`${i}:${context.indexVariable}`}>
                        <span title={context.target}>Inside <b>{context.name}</b> · index <code>{context.indexVariable}</code></span>
                        {count !== null && count > 0 ? <select aria-label={`Sample for ${context.name}`} value={index}
                            onChange={(e: any) => {
                                const next = { ...iteratorIndices, [context.indexVariable]: Number(e.target.value) };
                                for (const child of contexts.slice(i + 1)) delete next[child.indexVariable];
                                setIndices(next);
                            }}>
                            {Array.from({ length: count }, (_, n) => <option key={n} value={n}>{`Sample ${n + 1} of ${count}`}</option>)}
                        </select> : <span className="hint">{count === 0 ? 'No template repetitions' : 'Sample unavailable'}</span>}
                    </div>;
                })}
            </div> : null}
            {builder ? <Field label="Step name">
                <input aria-label="Step name" placeholder="Uses the target path" value={element.name ?? ''}
                    onChange={(e: any) => { element.name = e.target.value; change(); }} />
            </Field> : null}
            <Field label={builder ? 'Target field' : 'Variable name'}>
                {builder ? <FieldInput value={element.messageSegment ?? ''} targetTrees={{ inbound: pickedInbound, outbound: pickedOutbound }}
                    onRetry={reloadFields} MessageFieldPicker={MessageFieldPicker} ariaLabel="Message Segment" placeholder="msg['PID']['PID.5']['PID.5.1']"
                    onValue={(value: string) => { element.messageSegment = value; change(); }} />
                    : <input type="text" className="mono" aria-label="Variable" placeholder="variableName" value={name}
                        onChange={(e: any) => { element.variable = e.target.value; element.name = e.target.value; change(); }} />}
                {builder ? isBlank(element.messageSegment) ? <div className="hint map-warn">The message segment value cannot be blank.</div> : null
                    : isBlank(name) ? <div className="hint map-warn">The variable name cannot be blank.</div>
                        : dupes.length ? <div className="hint map-warn">{`Also set by step ${dupes.map((v: any) => v.step).join(', ')}.`}</div> : null}
            </Field>
            <Field label="Value">
                <ValueEditor element={element} onChange={change} inbound={pickedInbound} variables={variables} defaultMode="field" onRetry={reloadFields} MessageFieldPicker={MessageFieldPicker} />
            </Field>
            <Field label="Default">
                <input type="text" className="mono" aria-label="Default Value" value={element.defaultValue ?? ''}
                    onChange={(e: any) => { element.defaultValue = e.target.value; change(); }} />
            </Field>
            {!builder && contexts.length ? <div className="hint">This Mapper stores an array of iteration results.</div> : null}
            <details className="map-more-options"><summary>More options <span className="hint">{summary}</span></summary>
                <div className="map-options-body">
                    {!builder ? <Field label="Store in">
                        <select aria-label="Add to" value={scope} onChange={(e: any) => { element.scope = e.target.value; change(); }}>
                            {!card ? <option value={scope}>{scope}</option> : null}
                            {SCOPE_CARDS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select><div className="hint">{card?.hint}</div>
                    </Field> : null}
                    <StringReplacementEditor element={element} onChange={change} />
                    <div className="hint">Expressions applied in order after the default. Include quotes around literal patterns and text.</div>
                </div>
            </details>
        </div>
    );
}
function MapperEditor(props: any) { return <MappingEditor {...props} />; }
function MessageBuilderEditor(props: any) { return <MappingEditor {...props} builder />; }

function XsltEditor({ element, onChange }: any) {
    const force = useRerender();
    return (
        <>
            <div className="form-grid">
                <Field label="Source XML String">
                    <input
                        type="text"
                        placeholder="msg"
                        value={element.sourceXml ?? ''}
                        onChange={(e: any) => { element.sourceXml = e.target.value; onChange(); force(); }}
                    />
                </Field>
                <Field label="Result Variable">
                    <input
                        type="text"
                        value={element.resultVariable ?? ''}
                        onChange={(e: any) => { element.resultVariable = e.target.value; onChange(); force(); }}
                    />
                </Field>
            </div>
            <Field label="XSLT Template">
                <CodeEditorIsland
                    value={element.template ?? ''}
                    minHeight="220px"
                    onChange={(value: any) => { element.template = value; onChange(); }}
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
let dsfUid = 0;

function DestinationSetFilterEditor({ element, onChange, destinations }: any) {
    const force = useRerender();
    const [selValue, setSelValue] = React.useState(-1);
    // Per-INSTANCE radio-group name: keying on the element class collides when
    // two Destination Set Filter steps are on screen at once (same class), and
    // colliding names let one step's Condition radios uncheck the other's.
    const uid = React.useMemo(() => ++dsfUid, []);

    const dests = Array.isArray(destinations) ? destinations : [];
    const behavior = element.behavior || 'REMOVE';
    const condition = element.condition || 'EXISTS';
    const checked = checkedIdSet(element.metaDataIds);
    const values = stringListToLines(element.values);

    const listDisabled = behavior === 'REMOVE_ALL';   // REMOVE_ALL takes no ids
    const valuesEnabled = CONDITION_USES_VALUES.has(condition);

    // ---- destination checkbox list ----
    const setChecked = (next: any) => { element.metaDataIds = idSetToMetaData(next, dests); onChange(); force(); };
    const toggleId = (id: any, on: any) => {
        const next = new Set(checked);
        if (on) next.add(String(id)); else next.delete(String(id));
        setChecked(next);
    };
    const selectAll = () => setChecked(new Set(dests.map(d => String(d.metaDataId))));
    const deselectAll = () => setChecked(new Set());

    // ---- values table ----
    const setValues = (arr: any) => { element.values = stringArrayToList(arr); onChange(); force(); };
    const newValue = () => { setValues([...values, '']); setSelValue(values.length); };
    const editValue = (i: any, v: any) => { const next = values.slice(); next[i] = v; setValues(next); };
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
                    onChange={(e: any) => { element.behavior = e.target.value; onChange(); force(); }}
                />
            </Field>
            <Field label="Field">
                <input
                    type="text"
                    placeholder="msg['PID']['PID.3']['PID.3.1'].toString()"
                    value={element.field ?? ''}
                    onChange={(e: any) => { element.field = e.target.value; onChange(); force(); }}
                />
            </Field>

            <div className="span-2 mt-2">
                <Field label="Destinations">
                    <div className="flex gap-2 mb-1.5">
                        <button type="button" className="btn btn-sm" disabled={listDisabled} onClick={selectAll}>Select All</button>
                        <button type="button" className="btn btn-sm" disabled={listDisabled} onClick={deselectAll}>Deselect All</button>
                    </div>
                    <div
                        className="dt-wrap border border-line rounded max-h-[162px]"
                        style={listDisabled ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
                    >
                        <table className="dt">
                            <thead>
                                <tr>
                                    <th className="w-[38px]"></th>
                                    <th>Name</th>
                                    <th className="w-[63px]">Id</th>
                                </tr>
                            </thead>
                            <tbody>
                                {dests.length ? dests.map((d: any) => {
                                    const id = String(d.metaDataId);
                                    return (
                                        <tr key={id}>
                                            <td className="text-center">
                                                <input
                                                    type="checkbox"
                                                    checked={checked.has(id)}
                                                    disabled={listDisabled}
                                                    onChange={(e: any) => toggleId(id, e.target.checked)}
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
                        {CONDITIONS.map((opt: any) => (
                            <label className="check" key={opt.value}>
                                <input
                                    type="radio"
                                    name={`dsf-condition-${uid}`}
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
                <Field label="Values">
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
                        className="dt-wrap border border-line rounded max-h-[162px]"
                        style={!valuesEnabled ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
                    >
                        <table className="dt">
                            <thead><tr><th>Value</th></tr></thead>
                            <tbody>
                                {values.length ? values.map((v: any, i: any) => (
                                    <tr
                                        key={i}
                                        className={selValue === i ? 'selected' : undefined}
                                        onClick={() => setSelValue(i)}
                                    >
                                        <td>
                                            <input
                                                type="text"
                                                value={v}
                                                disabled={!valuesEnabled}
                                                onFocus={() => setSelValue(i)}
                                                onChange={(e: any) => editValue(i, e.target.value)}
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

function RuleBuilderEditor({ element, onChange }: any) {
    const force = useRerender();
    return (
        <div className="form-grid">
            <Field label="Field">
                <input
                    type="text"
                    placeholder="msg['MSH']['MSH.9']['MSH.9.1'].toString()"
                    value={element.field ?? ''}
                    onChange={(e: any) => { element.field = e.target.value; onChange(); force(); }}
                />
            </Field>
            <Field label="Condition">
                <Select
                    options={CONDITIONS}
                    value={element.condition || 'EXISTS'}
                    onChange={(e: any) => { element.condition = e.target.value; onChange(); force(); }}
                />
            </Field>
            <div className="span-2">
                <Field label="Values">
                    <textarea
                        rows={4}
                        placeholder="One value per line"
                        title="Only used by Equals / Not Equal / Contains / Not Contain"
                        value={stringListToLines(element.values).join('\n')}
                        onChange={(e: any) => { element.values = linesToStringList(e.target.value); onChange(); force(); }}
                    />
                </Field>
            </div>
        </div>
    );
}

/* ---- registration ----------------------------------------------------------- */

export function register(platform: Platform) {

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
        validate: (el: any) => isBlank(el.variable) ? 'The variable name cannot be blank.' : '',
        component: MapperEditor
    });

    platform.registerStepType('com.mirth.connect.plugins.messagebuilder.MessageBuilderStep', {
        label: 'Message Builder',
        create: () => ({
            __type: 'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep',
            name: '', enabled: true,
            messageSegment: '', mapping: '', defaultValue: '', replacements: ''
        }),
        validate: (el: any) => isBlank(el.messageSegment) ? 'The message segment value cannot be blank.' : '',
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
        validate: (el: any) => {
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
        validate: (el: any) => isBlank(el.field) ? 'The field cannot be blank.' : '',
        component: DestinationSetFilterEditor
    });

    platform.registerStepType('com.mirth.connect.plugins.scriptfilestep.ExternalScriptStep', {
        label: 'External Script',
        create: () => ({
            __type: 'com.mirth.connect.plugins.scriptfilestep.ExternalScriptStep',
            name: '', enabled: true,
            scriptPath: ''
        }),
        validate: (el: any) => isBlank(el.scriptPath) ? 'The script path cannot be blank.' : '',
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
        validate: (el: any) => isBlank(el.field) ? 'The field cannot be blank.' : '',
        component: RuleBuilderEditor
    });

    platform.registerRuleType('com.mirth.connect.plugins.scriptfilerule.ExternalScriptRule', {
        label: 'External Script',
        create: () => ({
            __type: 'com.mirth.connect.plugins.scriptfilerule.ExternalScriptRule',
            name: '', enabled: true, operator: 'AND',
            scriptPath: ''
        }),
        validate: (el: any) => isBlank(el.scriptPath) ? 'The script path cannot be blank.' : '',
        component: ScriptPathEditor
    });

    platform.registerRuleType('com.mirth.connect.model.IteratorRule', makeIteratorEditor(true));
}
