import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const container = 'a'.repeat(64);
const inspectCommand = ['docker', 'inspect', '--format', '{{.State.Running}}', container];
const stopCommand = ['docker', 'stop', '--time', '15', container];
const harness = fileURLToPath(new URL('engine-contract.py', import.meta.url));

// Import the real helper without starting an engine or contacting Docker.
// Python is already required by the contract CI jobs; only stdlib modules are used.
function cleanup({ code = 0, stdout = '', stderr = '', stopError = null, repeat = 1 } = {}) {
    const result = spawnSync('python3', ['-B', '-c', `
import json
import runpy
import subprocess
import sys
from unittest.mock import patch

namespace = runpy.run_path(sys.argv[1])
case = json.load(sys.stdin)
inspected = subprocess.CompletedProcess(case['inspectCommand'], case['code'], case['stdout'], case['stderr'])
stopped = subprocess.CompletedProcess(case['stopCommand'], 0)
if case['stopError']:
    stopped = subprocess.CalledProcessError(1, case['stopCommand'], stderr=case['stopError'])
results = [inspected, stopped] if case['stdout'].strip() == 'true' and not case['code'] else [inspected] * case['repeat']
error = None
with patch('subprocess.run', side_effect=results) as run:
    try:
        for _ in range(case['repeat']):
            namespace['stop_container'](case['container'])
    except subprocess.CalledProcessError as failure:
        error = {'code': failure.returncode, 'command': failure.cmd, 'stderr': failure.stderr}
print(json.dumps({'error': error, 'calls': [{'command': call.args[0], 'options': call.kwargs} for call in run.call_args_list]}))
`, harness], {
        input: JSON.stringify({ container, inspectCommand, stopCommand, code, stdout, stderr, stopError, repeat }),
        encoding: 'utf8',
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
}

test('contract cleanup inspects only the owned ID and stops a running container', () => {
    const result = cleanup({ stdout: 'true\n' });
    assert.equal(result.error, null);
    assert.deepEqual(result.calls, [
        { command: inspectCommand, options: { capture_output: true, text: true } },
        { command: stopCommand, options: { check: true, capture_output: true } },
    ]);
});

test('contract cleanup leaves a stopped container alone', () => {
    const result = cleanup({ stdout: 'false\n' });
    assert.equal(result.error, null);
    assert.deepEqual(result.calls.map(call => call.command), [inspectCommand]);
});

for (const message of [
    `error: no such object: ${container}\n`,
    `Error: No such object: ${container}\n`,
    `ERROR: NO SUCH OBJECT: ${container}\n`,
    `Error response from daemon: No such container: ${container}\n`,
]) {
    test(`contract cleanup tolerates repeated auto-removal: ${message.trim()}`, () => {
        const result = cleanup({ code: 1, stderr: message, repeat: 2 });
        assert.equal(result.error, null);
        assert.deepEqual(result.calls.map(call => call.command), [inspectCommand, inspectCommand]);
    });
}

for (const message of [
    'permission denied while trying to connect to the Docker daemon socket',
    'Cannot connect to the Docker daemon: No such file or directory',
    'Error: No such object: another-container',
    `Error: No such object: ${container}extra`,
    `Error: permission denied\nError: No such object: ${container}`,
    `Error: No such object: ${container}\nError: permission denied`,
]) {
    test(`contract cleanup preserves inspect errors: ${message}`, () => {
        const result = cleanup({ code: 1, stderr: message });
        assert.deepEqual(result.error, { code: 1, command: inspectCommand, stderr: message });
        assert.deepEqual(result.calls.map(call => call.command), [inspectCommand]);
    });
}

for (const message of ['permission denied', `Error response from daemon: No such container: ${container}`]) {
    test(`contract cleanup preserves stop errors, including an inspect/stop race: ${message}`, () => {
        const result = cleanup({ stdout: 'true\n', stopError: message });
        assert.deepEqual(result.error, { code: 1, command: stopCommand, stderr: message });
        assert.deepEqual(result.calls.map(call => call.command), [inspectCommand, stopCommand]);
    });
}
