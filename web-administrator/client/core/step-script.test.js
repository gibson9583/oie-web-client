import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateElementScript } from './step-script.js';

test('nested Message Builder previews initialize both ancestor indices', () => {
    const builder = {
        __type: 'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep',
        messageSegment: 'tmp.group.OBX[i].value[j].text',
        mapping: 'rows[i][j]'
    };
    const iterator = (indexVariable, target, child) => ({
        __type: 'com.mirth.connect.model.IteratorStep',
        properties: { indexVariable, target },
        __children: [child]
    });
    const script = generateElementScript(iterator('i', 'rows', iterator('j', 'rows[i]', builder)));
    // The packaged 4.6 preview first creates the missing XML parent, then each
    // segment at its respective Iterator index.
    const xmlGuards = [
        "if (typeof(tmp.group[0]) == 'undefined') {",
        "createSegment('group', tmp);",
        "}",
        "if (typeof(tmp.group.OBX[i]) == 'undefined') {",
        "createSegment('OBX', tmp.group, i);",
        "}",
        "if (typeof(tmp.group.OBX[i].value[j]) == 'undefined') {",
        "createSegment('value', tmp.group.OBX[i], j);",
        "}"
    ];
    assert.ok(script.includes(xmlGuards.join('\n')));

    // Execute the ordinary object branch with an initially empty output.
    const tmp = {};
    const run = new Function('tmp', 'rows', 'getArrayOrXmlLength', 'validate', script);
    run(tmp, [['one', 'two'], ['three']], value => value.length, value => value);
    assert.deepEqual(tmp.group.OBX, [
        { value: [{ text: 'one' }, { text: 'two' }] },
        { value: [{ text: 'three' }] }
    ]);
});
