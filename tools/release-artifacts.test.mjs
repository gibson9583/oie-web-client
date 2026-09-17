import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { releaseVersion, verifyArtifacts } from './release-artifacts.mjs';

test('every package and lockfile version must agree with the release tag', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'release-version-test-'));
    try {
        mkdirSync(path.join(root, 'web-administrator'));
        const write = (file, data) => writeFileSync(path.join(root, file), JSON.stringify(data));
        write('package.json', { version: '1.0.0' });
        write('web-administrator/package.json', { version: '1.0.0' });
        const lock = { version: '1.0.0', packages: { '': { version: '1.0.0' }, 'web-administrator': { version: '1.0.0' } } };
        write('package-lock.json', lock);
        assert.equal(releaseVersion(root, 'v1.0.0'), '1.0.0');
        assert.throws(() => releaseVersion(root, 'v0.9.0'), /Tag/);
        for (const location of [lock, lock.packages[''], lock.packages['web-administrator']]) {
            location.version = '0.9.0'; write('package-lock.json', lock);
            assert.throws(() => releaseVersion(root), /disagree/);
            location.version = '1.0.0';
        }
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('promotion rejects wrong commits, versions, missing artifacts and tampered bytes', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'release-receipt-test-'));
    try {
        const sourceSha = 'a'.repeat(40);
        const names = ['oie-webadmin-node.tar.gz', 'oie-webadmin.war'];
        const receipt = { schema: 1, sourceSha, version: '1.0.0', artifacts: {} };
        for (const name of names) {
            writeFileSync(path.join(root, name), name);
            receipt.artifacts[name] = createHash('sha256').update(name).digest('hex');
        }
        const save = () => writeFileSync(path.join(root, 'release-receipt.json'), JSON.stringify(receipt));
        save();
        assert.equal(verifyArtifacts(root, sourceSha, '1.0.0').sourceSha, sourceSha);
        assert.throws(() => verifyArtifacts(root, 'b'.repeat(40), '1.0.0'), /SHA/);
        assert.throws(() => verifyArtifacts(root, sourceSha, '0.9.0'), /version/);
        receipt.artifacts['../unexpected'] = 'untrusted'; save();
        assert.throws(() => verifyArtifacts(root, sourceSha, '1.0.0'), /artifact set/);
        delete receipt.artifacts['../unexpected']; save();
        writeFileSync(path.join(root, names[0]), 'changed after validation');
        assert.throws(() => verifyArtifacts(root, sourceSha, '1.0.0'), /Checksum/);
        rmSync(path.join(root, names[0]));
        assert.throws(() => verifyArtifacts(root, sourceSha, '1.0.0'));
    } finally { rmSync(root, { recursive: true, force: true }); }
});
