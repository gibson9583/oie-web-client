// Package once, verify before testing/publishing, and retain the source identity.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = ['oie-webadmin-node.tar.gz', 'oie-webadmin.war'];
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');

export function releaseVersion(repo, tag) {
    const lock = json(path.join(repo, 'package-lock.json'));
    const versions = [json(path.join(repo, 'package.json')).version,
        json(path.join(repo, 'web-administrator/package.json')).version,
        lock.version, lock.packages[''].version, lock.packages['web-administrator'].version];
    if (!versions[0] || versions.some(version => version !== versions[0])) {
        throw new Error(`Root, app and lockfile versions disagree: ${versions.join(', ')}`);
    }
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(versions[0])) throw new Error('Invalid release version');
    if (tag && tag !== `v${versions[0]}`) throw new Error(`Tag ${tag} must be v${versions[0]}`);
    return versions[0];
}

export function verifyArtifacts(directory, expectedSha, expectedVersion) {
    const receipt = json(path.join(directory, 'release-receipt.json'));
    if (receipt.schema !== 1 || !/^[a-f0-9]{40}$/.test(expectedSha) || receipt.sourceSha !== expectedSha) {
        throw new Error('Artifact source SHA does not match the validated commit');
    }
    if (receipt.version !== expectedVersion) throw new Error('Artifact version does not match the release');
    if (JSON.stringify(Object.keys(receipt.artifacts || {}).sort()) !== JSON.stringify([...artifacts].sort())) {
        throw new Error('Unexpected artifact set');
    }
    for (const name of artifacts) {
        if (sha256(path.join(directory, name)) !== receipt.artifacts[name]) throw new Error(`Checksum mismatch: ${name}`);
    }
    return receipt;
}

function pack(directory, sourceSha, version) {
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    if (git('rev-parse', 'HEAD') !== sourceSha || git('status', '--porcelain')) {
        throw new Error('Release packaging requires a clean checkout of the requested source SHA');
    }
    const info = json(path.join(root, 'web-administrator/build-info.json'));
    if (info.commit !== sourceSha || info.version !== version || info.dirty) throw new Error('Build identity is stale or dirty');
    const temporary = mkdtempSync(path.join(os.tmpdir(), 'webadmin-artifacts-'));
    try {
        const stage = path.join(temporary, 'runtime');
        mkdirSync(stage);
        // Allowlist deployment inputs. Never ship local configuration, custom
        // plugins, .git, test evidence, credentials or development dependencies.
        for (const name of ['package.json', 'package-lock.json', 'LICENSE', 'packages',
            'web-administrator/package.json', 'web-administrator/build-info.json',
            'web-administrator/server', 'web-administrator/client', 'web-administrator/plugins']) {
            cpSync(path.join(root, name), path.join(stage, name), { recursive: true, filter: file => {
                const base = path.basename(file);
                return !['node_modules', 'custom-plugins', '.DS_Store'].includes(base)
                    && !base.endsWith('.test.js') && !base.endsWith('.map')
                    && (!/\.tsx?$/.test(base) || base.endsWith('.d.ts'));
            } });
        }
        if (!existsSync(path.join(stage, 'web-administrator/client/dist/index.html'))) throw new Error('Build the Node client before packaging');
        mkdirSync(directory, { recursive: true });
        execFileSync('tar', ['-czf', path.join(directory, artifacts[0]), '-C', stage, '.']);
        cpSync(path.join(root, 'web-administrator/dist/oie-webadmin.war'), path.join(directory, artifacts[1]));
        const warCheck = path.join(temporary, 'war');
        mkdirSync(warCheck);
        execFileSync('jar', ['--extract', '--file', path.join(directory, artifacts[1]), 'webadmin/config.json'], { cwd: warCheck });
        const warInfo = json(path.join(warCheck, 'webadmin/config.json'));
        if (warInfo.version !== version || warInfo.build?.commit !== sourceSha || warInfo.build?.dirty) {
            throw new Error('WAR identity does not match the Node build');
        }
        const receipt = { schema: 1, sourceSha, version, node: process.version,
            artifacts: Object.fromEntries(artifacts.map(name => [name, sha256(path.join(directory, name))])) };
        writeFileSync(path.join(directory, 'release-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
        for (const name of artifacts) writeFileSync(path.join(directory, `${name}.sha256`), `${receipt.artifacts[name]}  ${name}\n`);
        verifyArtifacts(directory, sourceSha, version);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [command, directory = 'release-artifacts'] = process.argv.slice(2);
    const version = releaseVersion(root, process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined);
    const sourceSha = process.env.BUILD_COMMIT || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    if (command === 'pack') pack(path.resolve(directory), sourceSha, version);
    else if (command === 'verify') verifyArtifacts(path.resolve(directory), sourceSha, version);
    else if (command !== 'versions') throw new Error('Usage: release-artifacts.mjs versions|pack|verify [directory]');
    console.log(`${command}: ${version} ${sourceSha}`);
}
