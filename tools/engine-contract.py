#!/usr/bin/env python3
"""Own an OIE 4.6 installation/Derby database; retain evidence, then remove it.

No existing engine URL, installation or database is accepted. The immutable
distribution is verified before extraction. Use --plugin for the companion ZIP.
"""
import argparse
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import ssl
import subprocess
import sys
import tarfile
import tempfile
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ARCHIVE_SHA = '7c82e79027e671277e1d78d0f7bbb1c53ddf1be476f1e80c2ddbfcf7855900ea'
REPO = Path(__file__).resolve().parent.parent


def digest(file):
    with Path(file).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def port():
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        return probe.getsockname()[1]


def stop(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(30)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(10)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--plugin', type=Path)
    parser.add_argument('--war', type=Path, default=REPO / 'web-administrator/dist/oie-webadmin.war')
    parser.add_argument('--java', default=shutil.which('java'))
    parser.add_argument('--baseline-node', type=Path, help='Built v0.9.0 Node runtime archive, including production dependencies')
    parser.add_argument('--baseline-war', type=Path, help='Official v0.9.0 WAR for upgrade/rollback')
    parser.add_argument('--docker-image', help='Test this already-built image on a Linux host instead of Node/WAR')
    parser.add_argument('--baseline-docker-image', help='Already-built v0.9.0 image for Docker upgrade/rollback')
    args = parser.parse_args()
    if bool(args.baseline_node) != bool(args.baseline_war):
        parser.error('Pass both --baseline-node and --baseline-war')
    if args.docker_image and (sys.platform != 'linux' or (args.baseline_node and not args.baseline_docker_image)):
        parser.error('Docker contracts require Linux and a baseline image when rehearsing upgrades')
    if args.baseline_war and digest(args.baseline_war) != 'f98a25c22504fc4f4e1fa9aeeff6ac601a23df11647ce0eddf5355f9ea31a6e6':
        raise RuntimeError('Baseline WAR must be the official v0.9.0 asset')
    if digest(args.archive) != ARCHIVE_SHA:
        raise RuntimeError('OIE distribution checksum mismatch')
    args.out.mkdir(parents=True, exist_ok=False)
    owned = Path(tempfile.mkdtemp(prefix='webadmin-engine-contract-'))
    receipt = {'archiveSha256': ARCHIVE_SHA, 'warSha256': digest(args.war),
               'pluginSha256': digest(args.plugin) if args.plugin else None,
               'webBuild': json.loads((REPO / 'web-administrator/build-info.json').read_text()),
               'harnessSourceSha': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=REPO, text=True).strip(),
               'ownedRoot': str(owned), 'startedAt': time.time(), 'processes': [], 'cases': []}
    processes = []
    containers = []
    engine = owned / 'oie'
    request = None
    try:
        with tarfile.open(args.archive) as archive:
            archive.extractall(owned, filter='data')
        if (engine / 'appdata/mirthdb').exists():
            raise RuntimeError('Expected a fresh database')
        if args.plugin:
            with zipfile.ZipFile(args.plugin) as archive:
                if any(not name.startswith('websupport/') or '..' in Path(name).parts for name in archive.namelist()):
                    raise RuntimeError('Unexpected Web Support archive paths')
                archive.extractall(engine / 'extensions')
        (engine / 'webapps').mkdir(exist_ok=True)
        http_port, https_port, node_port = port(), port(), port()
        config = engine / 'conf/mirth.properties'
        config.write_text(config.read_text().replace('http.port = 8080', f'http.port = {http_port}')
                          .replace('https.port = 8443', f'https.port = {https_port}')
                          .replace('host = 0.0.0.0', 'host = 127.0.0.1'))
        upstream = f'https://127.0.0.1:{https_port}'
        receipt.update(httpPort=http_port, httpsPort=https_port, nodePort=node_port)

        def spawn(command, cwd, name, env=None):
            with (args.out / f'{name}.log').open('w') as output:
                process = subprocess.Popen(command, cwd=cwd, env=env, stdout=output, stderr=subprocess.STDOUT)
            processes.append(process)
            receipt['processes'].append({'name': name, 'pid': process.pid, 'command': command})
            return process

        def stop_container(container):
            # The ID was created here, written to our unique cidfile and checked
            # against our ownership label. Never select by a shared name/tag.
            result = subprocess.run(['docker', 'inspect', '--format', '{{.State.Running}}', container], capture_output=True, text=True)
            if result.returncode and 'No such' in result.stderr:
                return
            result.check_returncode()
            if result.stdout.strip() == 'true':
                subprocess.run(['docker', 'stop', '--time', '15', container], check=True, capture_output=True)

        def spawn_container(image, phase):
            receipt['containerLaunchPending'] = True
            cidfile = owned / f'{phase}.cid'
            command = ['docker', 'run', '--rm', '--cidfile', str(cidfile), '--network', 'host',
                       '--label', 'org.oie.contract=' + owned.name,
                       '--env', 'WEBADMIN_HOST=127.0.0.1', '--env', f'WEBADMIN_PORT={node_port}',
                       '--env', 'WEBADMIN_CONFIG_JSON=' + node_config.read_text(), image]
            process = spawn(command, REPO, phase + '-docker')
            for _ in range(100):
                if cidfile.exists() and cidfile.read_text().strip():
                    container = cidfile.read_text().strip()
                    label = subprocess.check_output(['docker', 'inspect', '--format', '{{ index .Config.Labels "org.oie.contract" }}', container], text=True).strip()
                    if label != owned.name:
                        raise RuntimeError('Container ownership label does not match')
                    containers.append(container)
                    receipt.setdefault('containers', []).append({'id': container, 'image': image, 'phase': phase})
                    receipt['containerLaunchPending'] = False
                    return process, container
                if process.poll() is not None:
                    raise RuntimeError('Owned Docker process exited before writing its container ID')
                time.sleep(0.1)
            raise RuntimeError('Owned Docker process did not confirm its container ID')

        flags = [line.strip() for line in (engine / 'conf/default_modules.vmoptions').read_text().splitlines() if line.startswith('-')]
        jar = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl._create_unverified_context()), urllib.request.HTTPCookieProcessor(jar))

        def request(path, data=None, method=None, content_type=None):
            headers = {'X-Requested-With': 'OpenAPI', 'Accept': 'text/plain' if path == '/server/version' else 'application/json'}
            if content_type:
                headers['Content-Type'] = content_type
            return opener.open(urllib.request.Request(upstream + '/api' + path, data=data, method=method, headers=headers), timeout=5).read().decode()

        node_config = owned / 'webadmin-config.json'
        node_config.write_text(json.dumps({'engine': {'url': upstream, 'verifyTls': False}}))
        receipt['nodeConfigSha256'] = digest(node_config)
        phases = [('candidate', REPO, args.war)]
        if args.baseline_node:
            baseline = owned / 'baseline-node'
            baseline.mkdir()
            with tarfile.open(args.baseline_node) as archive:
                archive.extractall(baseline, filter='data')
            baseline_info = json.loads((baseline / 'web-administrator/build-info.json').read_text())
            if baseline_info.get('version') != '0.9.0' or baseline_info.get('commit') != 'ed684d26ef570ec4b29b7b7ff0c48d9972c2fe07' or baseline_info.get('dirty'):
                raise RuntimeError('Baseline Node build must identify the clean v0.9.0 source')
            receipt['baselineNodeSha256'] = digest(args.baseline_node)
            receipt['baselineWarSha256'] = digest(args.baseline_war)
            phases = [('baseline', baseline, args.baseline_war), *phases, ('rollback', baseline, args.baseline_war)]
        for phase, node_root, war in phases:
            shutil.copyfile(war, engine / 'webapps/oie-webadmin.war')
            if args.plugin:
                shutil.copyfile(war, engine / 'extensions/websupport/oie-webadmin.war')
            engine_process = spawn([args.java, '-Xmx512m', '-Djava.awt.headless=true', *flags, '-jar', 'mirth-server-launcher.jar'], engine, phase + '-engine')
            for _ in range(120):
                if engine_process.poll() is not None:
                    raise RuntimeError('Owned engine exited before readiness')
                try:
                    login = request('/users/_login', b'username=admin&password=admin', content_type='application/x-www-form-urlencoded')
                    if 'SUCCESS' not in login:
                        raise RuntimeError('Fresh-engine login did not succeed: ' + login)
                    break
                except urllib.error.HTTPError as error:
                    if error.code not in (404, 503):
                        raise
                    time.sleep(1)
                except (OSError, urllib.error.URLError):
                    time.sleep(1)
            else:
                raise RuntimeError('Owned engine readiness deadline expired')
            if request('/server/version').strip() != '4.6.0':
                raise RuntimeError('Unexpected engine version')
            request('/users/1/preferences/firstlogin', b'false', 'PUT', 'text/plain')
            node_env = dict(os.environ, WEBADMIN_PORT=str(node_port), WEBADMIN_HOST='127.0.0.1')
            node_env.pop('WEBADMIN_CONFIG_JSON', None)
            node_env['WEBADMIN_CONFIG'] = str(node_config)
            container = None
            if args.docker_image:
                node_process, container = spawn_container(args.docker_image if phase == 'candidate' else args.baseline_docker_image, phase)
            else:
                node_process = spawn([shutil.which('node'), 'web-administrator/server/index.js'], node_root, phase + '-node', node_env)
            for _ in range(100):
                if node_process.poll() is not None:
                    raise RuntimeError('Owned web administrator exited before readiness')
                try:
                    urllib.request.urlopen(f'http://127.0.0.1:{node_port}/webadmin/config.json', timeout=2).close()
                    break
                except (OSError, urllib.error.URLError):
                    time.sleep(0.2)
            else:
                raise RuntimeError('Owned web administrator readiness deadline expired')
            version = json.loads((node_root / 'web-administrator/package.json').read_text())['version']
            deployments = [('docker', f'http://127.0.0.1:{node_port}')] if args.docker_image else [('node', f'http://127.0.0.1:{node_port}'), ('war', upstream + '/oie-webadmin')]
            for deployment, base in deployments:
                env = dict(os.environ, E2E_LIVE='1', E2E_BASE_URL=base, E2E_OWNED_ENGINE=str(owned),
                           E2E_EXPECT_CLIENT_VERSION=version, E2E_EXPECT_ENGINE_VERSION='4.6.0',
                           E2E_EXPECT_DEPLOYMENT=deployment if deployment == 'war' else '',
                           E2E_WEB_SUPPORT='1' if args.plugin else '0',
                           E2E_UPGRADE_PHASE=phase if args.baseline_node else '',
                           E2E_UPGRADE_STATE=str(args.out.resolve() / 'upgrade-channel.json'),
                           E2E_EXPECT_BUILD_COMMIT=receipt['webBuild'].get('commit', '') if phase == 'candidate' else '',
                           PLAYWRIGHT_JSON_OUTPUT_FILE=str(args.out.resolve() / f'{phase}-{deployment}-results.json'),
                           E2E_ENGINE_URL=upstream, E2E_JAVA=args.java)
                command = ['npx', 'playwright', 'test', '--project=live', '--project=live-webkit', '--workers=1', '--retries=0', '--max-failures=1', '--reporter=list,json',
                           '--output=' + str(args.out.resolve() / (phase + '-' + deployment + '-traces'))]
                if phase != 'candidate':
                    # The 1.0 live-cleanup session helper did not exist in 0.9.
                    # The upgrade contract uses the public API common to both.
                    command.extend(['--grep', 'upgrade and rollback'])
                with (args.out / f'{phase}-{deployment}-browser.log').open('w') as output:
                    result = subprocess.Popen(command, cwd=REPO, env=env, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
                    try:
                        result.wait(600)
                    finally:
                        if result.poll() is None:
                            os.killpg(result.pid, signal.SIGTERM)
                            try:
                                result.wait(15)
                            except subprocess.TimeoutExpired:
                                os.killpg(result.pid, signal.SIGKILL)
                                result.wait(10)
                receipt['cases'].append({'phase': phase, 'deployment': deployment, 'exitCode': result.returncode})
                if result.returncode:
                    raise RuntimeError(f'{deployment} contracts failed; see browser log')
            if digest(node_config) != receipt['nodeConfigSha256']:
                raise RuntimeError('Deployment rewrote its external configuration')
            (args.out / f'{phase}-channels.json').write_text(request('/channels'))
            if phase != phases[-1][0]:
                if container:
                    stop_container(container)
                stop(node_process)
                stop(engine_process)
        receipt['success'] = True
    except BaseException as error:
        receipt.update(success=False, error=repr(error))
        (args.out / 'failure.txt').write_text(traceback.format_exc())
    finally:
        if request:
            for endpoint, name in [('/channels', 'channels'), ('/channelgroups', 'groups'), ('/users', 'users'), ('/server/channelDependencies', 'dependencies'), ('/codeTemplateLibraries', 'libraries')]:
                try:
                    (args.out / f'final-{name}.json').write_text(request(endpoint))
                except Exception as error:
                    receipt.setdefault('observationErrors', []).append(f'{name}: {error!r}')
        # Signal only processes created above; wait before touching their files.
        for container in containers:
            try:
                stop_container(container)
            except Exception as error:
                receipt['success'] = False
                receipt.setdefault('containerCleanupErrors', []).append(f'{container}: {error!r}')
        for process in reversed(processes):
            stop(process)
        for item, process in zip(receipt['processes'], processes):
            item['exitCode'] = process.returncode
        if (engine / 'logs').exists():
            shutil.copytree(engine / 'logs', args.out / 'logs')
        if all(process.poll() is not None for process in processes) and not receipt.get('containerCleanupErrors') and not receipt.get('containerLaunchPending'):
            shutil.rmtree(owned)
            receipt['cleaned'] = True
        receipt['finishedAt'] = time.time()
        (args.out / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
        print(json.dumps(receipt, indent=2))
    return 0 if receipt.get('success') else 1


if __name__ == '__main__':
    raise SystemExit(main())
