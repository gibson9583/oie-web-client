/*
 * Built-in transformer step and filter rule editors — web admin plugin
 * (TransformerStepPlugin / FilterRulePlugin equivalent). Bundled steps/rules
 * are registered through the plugin loader, exactly like a third-party step or
 * rule plugin would be; the shared UI toolkit comes from the served client
 * modules (/core/*), the web equivalent of Mirth's client-core API.
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

import { h, field, textInput, select } from '/core/ui.js';
import { createCodeEditor } from '/core/codeeditor.js';

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

function bind(input, fn) {
    input.addEventListener('input', () => fn(input.value));
    return input;
}

function scriptEditor(element, onChange) {
    const editor = createCodeEditor({
        value: element.script ?? '',
        minHeight: '260px',
        onChange: (value) => { element.script = value; onChange(); }
    });
    return editor.el;
}

function scriptPathEditor(element, onChange) {
    return field('Script Path',
        bind(textInput(element.scriptPath ?? '', { placeholder: '/opt/scripts/example.js' }),
            v => { element.scriptPath = v; onChange(); }),
        'Path to a JavaScript file on the server — its contents are loaded when the channel is deployed');
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

function iteratorEditor(isRule) {
    const type = isRule ? 'com.mirth.connect.model.IteratorRule' : 'com.mirth.connect.model.IteratorStep';
    const childNoun = isRule ? 'rule' : 'step';
    return {
        label: 'Iterator',
        create: () => ({
            __type: type,
            name: '', enabled: true,
            ...(isRule ? { operator: 'AND' } : null),
            properties: emptyIteratorProperties()
        }),
        render(host, { element, onChange }) {
            if (!element.properties || typeof element.properties !== 'object') {
                element.properties = emptyIteratorProperties();
            }
            const props = element.properties;

            const prefixArea = h('textarea', { rows: 3, placeholder: 'msg[\'OBX\']' },
                stringListToLines(props.prefixSubstitutions).join('\n'));
            prefixArea.addEventListener('input', () => {
                props.prefixSubstitutions = linesToStringList(prefixArea.value);
                onChange();
            });

            host.appendChild(h('div.form-grid',
                field('Iterate On (target)',
                    bind(textInput(props.target ?? '', { placeholder: 'msg[\'OBX\']' }),
                        v => { props.target = v; onChange(); }),
                    'E4X XML node list or JavaScript array to iterate over'),
                field('Index Variable',
                    bind(textInput(props.indexVariable ?? 'i'),
                        v => { props.indexVariable = v; onChange(); })),
                h('div.span-2', field('Prefix Substitutions', prefixArea,
                    'One prefix per line — when dragging values into children, the index variable (e.g. [i]) is injected after these prefixes'))));

            // Children are managed in the main element list (nested under this
            // Iterator), matching the Swing tree-table — not edited here.
            host.appendChild(h('div.faint', { style: { padding: '10px 0 0', fontSize: '11px' } },
                `Child ${childNoun}s appear nested under this Iterator in the ${childNoun} list. `
                + `Add a ${childNoun} while a child is selected, or right-click a ${childNoun} and choose "Assign To Iterator".`));
        }
    };
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
        render(host, { element, onChange }) {
            host.appendChild(field('Script', scriptEditor(element, onChange)));
        }
    });

    platform.registerStepType('com.mirth.connect.plugins.mapper.MapperStep', {
        label: 'Mapper',
        create: () => ({
            __type: 'com.mirth.connect.plugins.mapper.MapperStep',
            name: '', enabled: true,
            variable: '', mapping: '', defaultValue: '', replacements: '', scope: 'CHANNEL'
        }),
        render(host, { element, onChange }) {
            host.appendChild(h('div.form-grid',
                field('Variable', bind(textInput(element.variable ?? ''), v => { element.variable = v; onChange(); })),
                field('Add to', select(SCOPES, element.scope || 'CHANNEL', {
                    onChange: (e) => { element.scope = e.target.value; onChange(); }
                })),
                h('div.span-2', field('Mapping', bind(textInput(element.mapping ?? '', { placeholder: 'msg[\'MSH\'][\'MSH.3\'][\'MSH.3.1\'].toString()' }), v => { element.mapping = v; onChange(); }))),
                h('div.span-2', field('Default Value', bind(textInput(element.defaultValue ?? ''), v => { element.defaultValue = v; onChange(); })))));
        }
    });

    platform.registerStepType('com.mirth.connect.plugins.messagebuilder.MessageBuilderStep', {
        label: 'Message Builder',
        create: () => ({
            __type: 'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep',
            name: '', enabled: true,
            messageSegment: '', mapping: '', defaultValue: '', replacements: ''
        }),
        render(host, { element, onChange }) {
            host.appendChild(h('div.form-grid',
                h('div.span-2', field('Message Segment', bind(textInput(element.messageSegment ?? '', { placeholder: 'tmp[\'MSH\'][\'MSH.3\'][\'MSH.3.1\']' }), v => { element.messageSegment = v; onChange(); }))),
                h('div.span-2', field('Mapping', bind(textInput(element.mapping ?? ''), v => { element.mapping = v; onChange(); }))),
                h('div.span-2', field('Default Value', bind(textInput(element.defaultValue ?? ''), v => { element.defaultValue = v; onChange(); })))));
        }
    });

    platform.registerStepType('com.mirth.connect.plugins.xsltstep.XsltStep', {
        label: 'XSLT Step',
        create: () => ({
            __type: 'com.mirth.connect.plugins.xsltstep.XsltStep',
            name: '', enabled: true,
            sourceXml: '', resultVariable: '', template: '',
            useCustomFactory: false, customFactory: ''
        }),
        render(host, { element, onChange }) {
            const editor = createCodeEditor({
                value: element.template ?? '',
                minHeight: '220px',
                onChange: (value) => { element.template = value; onChange(); }
            });
            host.appendChild(h('div.form-grid',
                field('Source XML String', bind(textInput(element.sourceXml ?? '', { placeholder: 'msg' }), v => { element.sourceXml = v; onChange(); })),
                field('Result Variable', bind(textInput(element.resultVariable ?? ''), v => { element.resultVariable = v; onChange(); }))));
            host.appendChild(field('XSLT Template', editor.el));
        }
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
        render(host, { element, onChange }) {
            const valuesArea = h('textarea', { rows: 4, placeholder: 'One value per line', title: 'Only used by Equals / Not Equal / Contains / Not Contain' },
                stringListToLines(element.values).join('\n'));
            valuesArea.addEventListener('input', () => {
                element.values = linesToStringList(valuesArea.value);
                onChange();
            });
            host.appendChild(h('div.form-grid',
                field('Behavior', select(BEHAVIORS, element.behavior || 'REMOVE', {
                    onChange: (e) => { element.behavior = e.target.value; onChange(); }
                })),
                field('Destination Meta Data Ids', bind(textInput(intListToText(element.metaDataIds), { placeholder: 'e.g. 1, 2' }), v => { element.metaDataIds = textToIntList(v); onChange(); }),
                    'Comma-separated destination metaDataIds this filter applies to'),
                field('Field', bind(textInput(element.field ?? ''), v => { element.field = v; onChange(); })),
                field('Condition', select(CONDITIONS, element.condition || 'EXISTS', {
                    onChange: (e) => { element.condition = e.target.value; onChange(); }
                })),
                h('div.span-2', field('Values', valuesArea))));
        }
    });

    platform.registerStepType('com.mirth.connect.plugins.scriptfilestep.ExternalScriptStep', {
        label: 'External Script',
        create: () => ({
            __type: 'com.mirth.connect.plugins.scriptfilestep.ExternalScriptStep',
            name: '', enabled: true,
            scriptPath: ''
        }),
        render(host, { element, onChange }) {
            host.appendChild(scriptPathEditor(element, onChange));
        }
    });

    platform.registerStepType('com.mirth.connect.model.IteratorStep', iteratorEditor(false));

    /* ---- filter rules ---- */

    platform.registerRuleType('com.mirth.connect.plugins.javascriptrule.JavaScriptRule', {
        label: 'JavaScript',
        create: () => ({
            __type: 'com.mirth.connect.plugins.javascriptrule.JavaScriptRule',
            name: '', enabled: true, operator: 'AND',
            script: '// Return true to accept the message, false to filter it\nreturn true;'
        }),
        render(host, { element, onChange }) {
            host.appendChild(field('Script', scriptEditor(element, onChange)));
        }
    });

    platform.registerRuleType('com.mirth.connect.plugins.rulebuilder.RuleBuilderRule', {
        label: 'Rule Builder',
        create: () => ({
            __type: 'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule',
            name: '', enabled: true, operator: 'AND',
            field: '', condition: 'EXISTS', values: ''
        }),
        render(host, { element, onChange }) {
            const valuesArea = h('textarea', { rows: 4, placeholder: 'One value per line', title: 'Only used by Equals / Not Equal / Contains / Not Contain' },
                stringListToLines(element.values).join('\n'));
            valuesArea.addEventListener('input', () => {
                element.values = linesToStringList(valuesArea.value);
                onChange();
            });
            host.appendChild(h('div.form-grid',
                field('Field', bind(textInput(element.field ?? '', { placeholder: 'msg[\'MSH\'][\'MSH.9\'][\'MSH.9.1\'].toString()' }), v => { element.field = v; onChange(); })),
                field('Condition', select(CONDITIONS, element.condition || 'EXISTS', {
                    onChange: (e) => { element.condition = e.target.value; onChange(); }
                })),
                h('div.span-2', field('Values', valuesArea))));
        }
    });

    platform.registerRuleType('com.mirth.connect.plugins.scriptfilerule.ExternalScriptRule', {
        label: 'External Script',
        create: () => ({
            __type: 'com.mirth.connect.plugins.scriptfilerule.ExternalScriptRule',
            name: '', enabled: true, operator: 'AND',
            scriptPath: ''
        }),
        render(host, { element, onChange }) {
            host.appendChild(scriptPathEditor(element, onChange));
        }
    });

    platform.registerRuleType('com.mirth.connect.model.IteratorRule', iteratorEditor(true));
}
