import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const harness = fileURLToPath(new URL('engine-contract.py', import.meta.url));
function check(body) {
    const result = spawnSync('python3', ['-B', '-c', `
import runpy
import subprocess
import sys
from unittest import TestCase
from unittest.mock import patch

stop_container = runpy.run_path(sys.argv[1])['stop_container']
container = 'a' * 64
command = ['docker', 'inspect', '--format', '{{.State.Running}}', container]
${body}
`, harness], { encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
}

test('contract cleanup ignores the lowercase missing owned container diagnostic', () => check(`
with patch('subprocess.run', return_value=subprocess.CompletedProcess(command, 1, '', f'error: no such object: {container}')) as run:
    stop_container(container)
    run.assert_called_once_with(command, capture_output=True, text=True)
`));

test('contract cleanup propagates a real Docker daemon error', () => check(`
with patch('subprocess.run', return_value=subprocess.CompletedProcess(command, 1, '', 'Cannot connect to the Docker daemon')):
    with TestCase().assertRaises(subprocess.CalledProcessError) as caught:
        stop_container(container)
    assert caught.exception.stderr == 'Cannot connect to the Docker daemon'
`));
