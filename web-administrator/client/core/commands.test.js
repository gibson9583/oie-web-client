import assert from 'node:assert/strict';
import { allCommands, commandPermissions, registerCommand } from './commands.js';
import { entryAllowed } from './command-suggestions.js';
import { NEW_ALERT_TASKS, NEW_CHANNEL_TASKS } from './route-tasks.js';

for (const [task, rbac, permissions] of [
    ['doNewChannel', 'channel', NEW_CHANNEL_TASKS],
    ['doNewAlert', 'alert', NEW_ALERT_TASKS],
]) {
    const unregister = registerCommand({ id: task, label: task, task, rbac, permissions });
    try {
        const command = allCommands().find(entry => entry.id === task);
        const rendered = { permissions: commandPermissions(command) };
        assert.equal(entryAllowed(rendered, () => true), true);
        for (const [deniedGroup, deniedTask] of permissions) {
            const can = (group, name) => group !== deniedGroup || name !== deniedTask;
            assert.equal(entryAllowed(rendered, can), false, `${deniedGroup}/${deniedTask} must block rendered and selected commands`);
        }
    } finally { unregister(); }
    assert.ok(!allCommands().some(entry => entry.id === task));
}

const combined = { permissions: commandPermissions({ task: 'legacy', rbac: 'custom', permissions: [['parent', 'view']] }) };
assert.equal(entryAllowed(combined, group => group !== 'custom'), false, 'additional prerequisites cannot replace the existing task gate');
assert.equal(entryAllowed(combined, group => group !== 'parent'), false, 'the existing task gate cannot replace the additional prerequisite');
assert.deepEqual(commandPermissions({ task: 'legacy' }), [['view', 'legacy']], 'untouched commands keep their default group');
assert.deepEqual(commandPermissions({ permissions: [['parent', 'view']] }), [['parent', 'view']], 'commands may declare prerequisites without a legacy task');
assert.deepEqual(commandPermissions({}), []);
assert.equal(entryAllowed({ permissions: commandPermissions({}) }, () => false), true, 'untagged session commands stay available');
console.log('commands: shared route prerequisites, legacy task composition and action-time checks passed');
