/*
 * Fixtures for the transformer-step / filter-rule round-trip tests
 * (step-rule-roundtrip.spec.js).
 *
 * Each element is in the engine wire shape: the plugin's create() fields plus the
 * @version + sequenceNumber the engine stamps. The test loads a channel whose
 * SOURCE connector holds one element of the type, opens the filter/transformer
 * editor, selects the element (mounting its editor), edits the Name, Saves, and
 * asserts the serialized `transformer.elements` / `filter.elements` round-trip.
 *
 * After save the element passes through elementsToArray → arrayToElements, which
 * always emits `{ <@class>: [ {...} ] }` (a one-element ARRAY, @-keys first,
 * sequenceNumber re-stamped to the index). So the expected wire shape the spec
 * builds is the element array-wrapped under its class.
 *
 * Factories return fresh objects so one test can't mutate another's expectation.
 * Iterator step/rule (nested children) is intentionally deferred.
 */

import { makeChannel } from './connector-fixtures.js';

const V = '4.5.0';
const P = 'com.mirth.connect.plugins';

/* Build a channel whose SOURCE connector's transformer (or filter) holds one
   element of `classKey`, in the engine wire shape ({ <@class>: {element} }). */
export function channelWithSourceElement(id, kind, classKey, element) {
    const ch = makeChannel(id);
    const target = kind === 'filter' ? ch.sourceConnector.filter : ch.sourceConnector.transformer;
    target.elements = { [classKey]: element };
    return ch;
}

const base = (extra) => ({ '@version': V, name: 'Original', sequenceNumber: '0', enabled: true, ...extra });

/* ---- transformer steps ---- */
const jsStep = () => base({ script: '// Write your JavaScript here\n' });
const mapperStep = () => base({ variable: 'patientId', mapping: "msg['PID']['PID.3']['PID.3.1'].toString()", defaultValue: '', replacements: '', scope: 'CHANNEL' });
const messageBuilderStep = () => base({ messageSegment: "tmp['PID']['PID.5']", mapping: '"X"', defaultValue: '', replacements: '' });
const xsltStep = () => base({ sourceXml: 'msg', resultVariable: 'out', template: '', useCustomFactory: false, customFactory: '' });
const destSetFilterStep = () => base({ behavior: 'REMOVE', metaDataIds: '', field: '', condition: 'EXISTS', values: '' });
const externalScriptStep = () => base({ scriptPath: '/opt/scripts/step.js' });

/* ---- filter rules ----
   Each case has a single rule, which is the FIRST rule — and the first rule in a
   filter carries no boolean operator (Swing parity: normalizeOperators() forces it
   to 'NONE' on save). So the fixtures use operator 'NONE' (a no-op round-trip). */
const jsRule = () => base({ operator: 'NONE', script: '// Return true to accept the message, false to filter it\nreturn true;' });
const ruleBuilderRule = () => base({ operator: 'NONE', field: '', condition: 'EXISTS', values: '' });
const externalScriptRule = () => base({ operator: 'NONE', scriptPath: '/opt/scripts/rule.js' });

/* ---- iterators (nested children; tested with an empty child list) ----
   properties is a versioned IteratorProperties; the editor only fills it when
   missing, so a complete fixture round-trips as a no-op. children '' = no children. */
const iteratorProps = () => ({ '@version': V, target: "msg['OBX']", indexVariable: 'i', prefixSubstitutions: '', children: '' });
const iteratorStep = () => base({ properties: iteratorProps() });
const iteratorRule = () => base({ operator: 'NONE', properties: iteratorProps() });

export const CASES = [
    { label: 'JavaScript Step', kind: 'transformer', class: `${P}.javascriptstep.JavaScriptStep`, element: jsStep },
    { label: 'Mapper Step', kind: 'transformer', class: `${P}.mapper.MapperStep`, element: mapperStep },
    { label: 'Message Builder Step', kind: 'transformer', class: `${P}.messagebuilder.MessageBuilderStep`, element: messageBuilderStep },
    { label: 'XSLT Step', kind: 'transformer', class: `${P}.xsltstep.XsltStep`, element: xsltStep },
    { label: 'Destination Set Filter Step', kind: 'transformer', class: `${P}.destinationsetfilter.DestinationSetFilterStep`, element: destSetFilterStep },
    { label: 'External Script Step', kind: 'transformer', class: `${P}.scriptfilestep.ExternalScriptStep`, element: externalScriptStep },
    { label: 'JavaScript Rule', kind: 'filter', class: `${P}.javascriptrule.JavaScriptRule`, element: jsRule },
    { label: 'Rule Builder Rule', kind: 'filter', class: `${P}.rulebuilder.RuleBuilderRule`, element: ruleBuilderRule },
    { label: 'External Script Rule', kind: 'filter', class: `${P}.scriptfilerule.ExternalScriptRule`, element: externalScriptRule },
    { label: 'Iterator Step', kind: 'transformer', class: 'com.mirth.connect.model.IteratorStep', element: iteratorStep },
    { label: 'Iterator Rule', kind: 'filter', class: 'com.mirth.connect.model.IteratorRule', element: iteratorRule },
];
