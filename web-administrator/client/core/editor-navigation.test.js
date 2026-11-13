import assert from 'node:assert/strict';
import {
    parseStepPath,
    resolveChannelEditorTab,
    resolveChannelScriptKey,
    resolveDestinationId,
    resolveStepPath,
} from './editor-navigation.js';

const pluginTabs = [
    { id: 'flow', label: 'Flow' },
    { id: 'audit-history', label: 'Audit History' },
];

// Channel editor tab resolution
assert.equal(resolveChannelEditorTab(undefined, pluginTabs), 'Summary');
assert.equal(resolveChannelEditorTab({}, pluginTabs), 'Summary');
assert.equal(resolveChannelEditorTab({ tab: 'summary' }, pluginTabs), 'Summary');
assert.equal(resolveChannelEditorTab({ tab: 'source' }, pluginTabs), 'Source');
assert.equal(resolveChannelEditorTab({ tab: 'destinations' }, pluginTabs), 'Destinations');
assert.equal(resolveChannelEditorTab({ tab: 'scripts' }, pluginTabs), 'Scripts');
assert.equal(resolveChannelEditorTab({ tab: 'Scripts' }, pluginTabs), 'Scripts');
assert.equal(resolveChannelEditorTab({ tab: 'flow' }, pluginTabs), 'Flow');
assert.equal(resolveChannelEditorTab({ tab: 'Audit History' }, pluginTabs), 'Audit History');
assert.equal(resolveChannelEditorTab({ tab: 'audit-history' }, pluginTabs), 'Audit History');
assert.equal(resolveChannelEditorTab({ tab: 'nonexistent' }, pluginTabs), 'Summary');
assert.equal(resolveChannelEditorTab({ script: 'deploy' }, pluginTabs), 'Scripts');
assert.equal(resolveChannelEditorTab({ metaDataId: '3' }, pluginTabs), 'Destinations');
assert.equal(resolveChannelEditorTab({ metaDataId: '0' }, pluginTabs), 'Source');
assert.equal(resolveChannelEditorTab({ tab: 'summary', script: 'deploy' }, pluginTabs), 'Summary');

// Channel script resolution
assert.equal(resolveChannelScriptKey(undefined), 'deployScript');
assert.equal(resolveChannelScriptKey(''), 'deployScript');
assert.equal(resolveChannelScriptKey('deploy'), 'deployScript');
assert.equal(resolveChannelScriptKey('deployScript'), 'deployScript');
assert.equal(resolveChannelScriptKey('undeploy'), 'undeployScript');
assert.equal(resolveChannelScriptKey('undeployScript'), 'undeployScript');
assert.equal(resolveChannelScriptKey('preprocessor'), 'preprocessingScript');
assert.equal(resolveChannelScriptKey('preprocessingScript'), 'preprocessingScript');
assert.equal(resolveChannelScriptKey('postprocessor'), 'postprocessingScript');
assert.equal(resolveChannelScriptKey('postprocessingScript'), 'postprocessingScript');
assert.equal(resolveChannelScriptKey('POSTPROCESSOR'), 'postprocessingScript');
assert.equal(resolveChannelScriptKey('unknown'), 'deployScript');

// Destination selection resolution
const dests = [{ metaDataId: 1 }, { metaDataId: 3 }, { metaDataId: 5 }];
assert.equal(resolveDestinationId([], '1'), null);
assert.equal(resolveDestinationId(dests, undefined), 1);
assert.equal(resolveDestinationId(dests, ''), 1);
assert.equal(resolveDestinationId(dests, '3'), 3);
assert.equal(resolveDestinationId(dests, '03'), 3);
assert.equal(resolveDestinationId(dests, '999'), 1);
assert.equal(resolveDestinationId(dests, 'abc'), 1);

// Step path resolution
assert.deepEqual(parseStepPath('0'), [0]);
assert.deepEqual(parseStepPath('4'), [4]);
assert.deepEqual(parseStepPath('1.2'), [1, 2]);
assert.equal(parseStepPath(''), null);
assert.equal(parseStepPath('-1'), null);
assert.equal(parseStepPath('abc'), null);
assert.equal(parseStepPath('1..2'), null);

const elements = [
    { name: 'Step 0' },
    { name: 'Iter 1', __children: [{ name: 'Child 1.0' }, { name: 'Child 1.1' }] },
    { name: 'Step 2' },
];
assert.equal(resolveStepPath([], '0'), null);
assert.deepEqual(resolveStepPath(elements, undefined), [0]);
assert.deepEqual(resolveStepPath(elements, ''), [0]);
assert.deepEqual(resolveStepPath(elements, '2'), [2]);
assert.deepEqual(resolveStepPath(elements, '1.1'), [1, 1]);
assert.deepEqual(resolveStepPath(elements, '1.5'), [0]);
assert.deepEqual(resolveStepPath(elements, '99'), [0]);
assert.deepEqual(resolveStepPath(elements, '-1'), [0]);
assert.deepEqual(resolveStepPath(elements, 'bad'), [0]);

console.log('editor-navigation: channel tab, script, destination, and step resolution checks passed');

