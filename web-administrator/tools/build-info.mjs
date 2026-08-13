#!/usr/bin/env node
/*
 * Stamps build-info.json with the identity shown in the About dialog, served in
 * /webadmin/config.json, and printed in the startup banner.
 *
 * The VERSION is package.json's, always — the conventional place, and the one
 * thing a consumer can rely on being a semver. Git only ever supplies build
 * METADATA (which commit, when, was the tree clean), never the version itself:
 * "0.5.0-beta (ab12cd3)" says what you are running AND which build of it.
 *
 * >>> package.json's version is therefore release-critical: bump it in the same
 * commit you cut a vX.Y.Z tag from, or every build of that release will name the
 * previous one. See "Releasing" in the repo README. <<<
 *
 * The commit comes from BUILD_COMMIT (CI and the Dockerfile pass it in, since
 * .git is never in the image build context), else from git on a checkout, else
 * nothing — an install with neither is stamped version-only rather than wrong.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..', 'build-info.json');

const git = (cmd) => {
    try { return execSync(cmd, { cwd: here, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
    catch { return ''; }
};

const version = JSON.parse(readFileSync(resolve(here, '..', 'package.json'), 'utf8')).version;
const commit = process.env.BUILD_COMMIT || git('git rev-parse HEAD') || null;
// A modified tree must not pass for the commit it sits on. Untracked files don't
// count (matching `git describe --dirty`): local notes must not dirty a stamp.
// Only meaningful where git answered — CI builds a clean checkout by definition.
const dirty = !process.env.BUILD_COMMIT && !!commit && !!git('git status --porcelain --untracked-files=no');

/* `npm start` re-runs this (via prestart), which on a deploy that carries no git
   and no build args would otherwise replace a good stamp with a commit-less one.
   Downgrades are refused; a build that knows the commit always wins. */
if (!commit) {
    try {
        const existing = JSON.parse(readFileSync(out, 'utf8'));
        if (existing.commit) {
            console.log(`[build-info] keeping the existing stamp: ${existing.version} (${String(existing.commit).slice(0, 7)})`);
            process.exit(0);
        }
    } catch { /* no previous stamp to keep */ }
}

const info = { version, commit, dirty, date: new Date().toISOString() };
writeFileSync(out, JSON.stringify(info, null, 4) + '\n');
console.log(`[build-info] ${version}${commit ? ` (${commit.slice(0, 7)}${dirty ? '-dirty' : ''})` : ''}`);
