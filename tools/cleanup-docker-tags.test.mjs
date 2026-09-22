import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanupValidatedTags } from './cleanup-docker-tags.mjs';

const image = 'example/web-client';
const repository = 'example/web-client-source';
const now = Date.parse('2026-09-22T20:00:00Z');
const day = 24 * 60 * 60 * 1000;
const tagsUrl = `https://hub.docker.com/v2/namespaces/${image.split('/')[0]}/repositories/${image.split('/')[1]}/tags`;
const runUrl = (id) => `https://api.github.com/repos/${repository}/actions/runs/${id}`;
const deleteUrl = (name) => `https://hub.docker.com/v2/repositories/${image}/tags/${name}/`;
const tag = (name = 'validated-123-1-amd64', overrides = {}) => ({
    name, digest: `sha256:${'a'.repeat(64)}`, tag_last_pushed: new Date(now - 2 * day).toISOString(), ...overrides,
});
const run = (id = 123, overrides = {}) => ({
    id, repository: { full_name: repository }, path: '.github/workflows/ci.yml',
    status: 'completed', run_attempt: 1, ...overrides,
});
const response = (json, status = 200) => new Response(status === 204 ? null : JSON.stringify(json), {
    status, headers: { 'Content-Type': 'application/json' },
});

// Every request is handled locally; an unexpected URL or method fails the test.
function fixture(initialTags = [tag()], overrides = {}) {
    const state = new Map(initialTags.map((entry) => [entry.name, entry]));
    const calls = [];
    const logs = [];
    const fetchImpl = async (url, options = {}) => {
        const method = options.method || 'GET';
        calls.push({ url, method, options });
        assert.equal(options.redirect, 'error');
        assert.ok(options.signal instanceof AbortSignal);
        const custom = overrides[`${method} ${url}`];
        if (custom instanceof Error) throw custom;
        if (custom !== undefined) return typeof custom === 'function' ? custom({ state, calls, options }) : custom.clone();
        if (method === 'POST' && url === 'https://hub.docker.com/v2/auth/token') return response({ access_token: 'hub-access' });
        if (method === 'GET' && url === `${tagsUrl}?page_size=100`) return response({ results: [...state.values()], next: null });
        if (method === 'GET' && url.startsWith(`https://api.github.com/repos/${repository}/actions/runs/`)) {
            return response(run(Number(url.split('/').at(-1))));
        }
        if (method === 'GET' && url.startsWith(`${tagsUrl}/`)) {
            const entry = state.get(url.slice(tagsUrl.length + 1));
            return response(entry || {}, entry ? 200 : 404);
        }
        if (method === 'DELETE' && url.startsWith(`https://hub.docker.com/v2/repositories/${image}/tags/`)) {
            const existed = state.delete(url.split('/').at(-2));
            return response({}, existed ? 204 : 404);
        }
        assert.fail(`Unexpected request: ${method} ${url}`);
    };
    return {
        state, calls, logs, overrides,
        deletes: () => calls.filter(({ method }) => method === 'DELETE'),
        clean: (options = {}) => cleanupValidatedTags({
            image, repository, now, githubToken: 'gh-secret', dockerUsername: 'hub-user',
            dockerToken: 'hub-secret', dryRun: false, fetchImpl, log: (message) => logs.push(message), ...options,
        }),
    };
}

test('deletes exact validated tag names only, preserving release, latest, PR and lookalike tags', async () => {
    const preserved = ['latest', '1.0.0', '1.0', 'pr-42', 'validated', 'validated-123-1',
        'validated-123-1-amd64-extra', 'validated-123-1-ppc64le', 'validated-0123-1-amd64',
        'validated-123-0-arm64', 'validated-123-01-amd64', 'validated-0-1-amd64',
        'xvalidated-123-1-amd64', 'validated-123-1-amd64/other'];
    const names = ['validated-123-1-amd64', 'validated-123-1-arm64'];
    const f = fixture([...preserved, ...names].map((name) => tag(name)));
    assert.deepEqual((await f.clean()).deleted, names);
    assert.deepEqual([...f.state.keys()], preserved);
    assert.equal(f.calls.filter(({ url }) => url === runUrl(123)).length, 1, 'paired architectures share one run lookup');
    assert.deepEqual(f.deletes().map(({ url }) => url), names.map(deleteUrl));
    assert.ok(f.deletes().every(({ options }) => options.headers.Authorization === 'Bearer hub-access'));
    assert.ok(!f.calls.some(({ url }) => url.includes('/manifests/')), 'never delete registry manifests');
    const auth = f.calls.find(({ method }) => method === 'POST');
    assert.deepEqual(JSON.parse(auth.options.body), { identifier: 'hub-user', secret: 'hub-secret' });
    assert.equal(f.calls.find(({ url }) => url === runUrl(123)).options.headers.Authorization, 'Bearer gh-secret');
    assert.ok(f.logs.every((entry) => !/hub-secret|gh-secret|hub-access/.test(entry)));
});

test('24 hour grace period includes its exact boundary and rejects recent, future or invalid push times', async () => {
    const times = [now - day - 1, now - day, now - day + 1, now + day, 'invalid', null, undefined];
    const entries = times.map((time, index) => tag(`validated-${index + 1}-1-amd64`, {
        tag_last_pushed: typeof time === 'number' ? new Date(time).toISOString() : time,
    }));
    const f = fixture(entries);
    const result = await f.clean();
    assert.deepEqual(result.deleted, entries.slice(0, 2).map(({ name }) => name));
    assert.deepEqual(result.kept, entries.slice(2).map(({ name }) => name));
    assert.equal(f.calls.filter(({ url }) => url.startsWith('https://api.github.com/')).length, 2);
});

test('coercible numeric push times and malformed digests never authorize deletion', async () => {
    for (const tag_last_pushed of [1, 0, '1', '2001', ['2001-01-01'], {}, true]) {
        const entry = tag(undefined, { tag_last_pushed });
        const f = fixture([entry]);
        assert.deepEqual((await f.clean()).kept, [entry.name]);
        assert.equal(f.deletes().length, 0);
    }
    for (const digest of [1, true, {}, [], null, undefined, '']) {
        const entry = tag(undefined, { digest });
        const f = fixture([entry]);
        assert.deepEqual((await f.clean()).kept, [entry.name]);
        assert.equal(f.deletes().length, 0);
    }
});

test('unverified or active GitHub runs never authorize deletion', async (t) => {
    const cases = [
        ['missing', response({}, 404)],
        ['queued', response(run(123, { status: 'queued' }))],
        ['in progress', response(run(123, { status: 'in_progress' }))],
        ['waiting', response(run(123, { status: 'waiting' }))],
        ['wrong id', response(run(124))],
        ['wrong repository', response(run(123, { repository: { full_name: 'other/project' } }))],
        ['missing repository', response(run(123, { repository: null }))],
        ['wrong workflow', response(run(123, { path: '.github/workflows/docker.yml' }))],
        ['missing attempt', response(run(123, { run_attempt: undefined }))],
        ['string attempt', response(run(123, { run_attempt: '1' }))],
        ['fractional attempt', response(run(123, { run_attempt: 1.5 }))],
        ['unsafe attempt', response(run(123, { run_attempt: Number.MAX_SAFE_INTEGER + 1 }))],
        ['attempt not reached', response(run(123, { run_attempt: 0 }))],
    ];
    for (const [name, reply] of cases) await t.test(name, async () => {
        const f = fixture([tag()], { [`GET ${runUrl(123)}`]: reply });
        assert.deepEqual((await f.clean()).kept, [tag().name]);
        assert.equal(f.deletes().length, 0);
        assert.ok(!f.calls.some(({ url }) => url === `${tagsUrl}/${tag().name}`));
    });
});

test('completed later attempts permit older tags, but active reruns and future attempts preserve them', async () => {
    const names = ['validated-123-1-amd64', 'validated-123-2-arm64', 'validated-123-3-amd64'];
    const f = fixture(names.map((name) => tag(name)), { [`GET ${runUrl(123)}`]: response(run(123, { run_attempt: 2 })) });
    const result = await f.clean();
    assert.deepEqual(result.deleted, names.slice(0, 2));
    assert.deepEqual(result.kept, names.slice(2));
    const active = fixture([tag()], { [`GET ${runUrl(123)}`]: response(run(123, { run_attempt: 2, status: 'in_progress' })) });
    assert.deepEqual((await active.clean()).kept, [tag().name]);
    assert.equal(active.deletes().length, 0);
});

test('completed failed or cancelled CI runs can have their abandoned tags removed', async () => {
    for (const conclusion of ['success', 'failure', 'cancelled', 'timed_out']) {
        const f = fixture([tag()], { [`GET ${runUrl(123)}`]: response(run(123, { conclusion })) });
        assert.deepEqual((await f.clean()).deleted, [tag().name]);
    }
});

test('collects every page and verifies every run before any mutation, deduplicating overlapping pages', async () => {
    const first = tag();
    const second = tag('validated-456-1-arm64');
    const page2 = `${tagsUrl}?page=2&page_size=100`;
    const f = fixture([first, second], {
        [`GET ${tagsUrl}?page_size=100`]: response({ results: [first], next: page2 }),
        [`GET ${page2}`]: response({ results: [first, second], next: null }),
    });
    assert.deepEqual((await f.clean()).deleted, [first.name, second.name]);
    const firstDelete = f.calls.findIndex(({ method }) => method === 'DELETE');
    for (const url of [page2, runUrl(123), runUrl(456)]) {
        assert.ok(f.calls.findIndex((call) => call.url === url) < firstDelete);
    }
    assert.equal(f.deletes().length, 2);
});

test('rejects hostile, foreign-path and cyclic pagination before forwarding credentials or deleting', async (t) => {
    const urls = [
        'https://evil.example/steal', '//evil.example/steal',
        'http://hub.docker.com/v2/namespaces/example/repositories/web-client/tags?page=2',
        'https://hub.docker.com/v2/namespaces/other/repositories/project/tags?page=2',
        'https://user:pass@hub.docker.com/v2/namespaces/example/repositories/web-client/tags?page=2',
        `${tagsUrl}/../manifests?page=2`, `${tagsUrl}?page_size=100`,
    ];
    for (const next of urls) await t.test(next, async () => {
        const f = fixture([tag()], { [`GET ${tagsUrl}?page_size=100`]: response({ results: [tag()], next }) });
        await assert.rejects(f.clean(), /Unsafe or repeated/);
        assert.equal(f.calls.length, 2, 'only authentication and the first trusted page were fetched');
        assert.equal(f.deletes().length, 0);
    });
    const page2 = `${tagsUrl}?page=2`;
    const f = fixture([tag()], {
        [`GET ${tagsUrl}?page_size=100`]: response({ results: [tag()], next: page2 }),
        [`GET ${page2}`]: response({ results: [], next: `${tagsUrl}?page_size=100` }),
    });
    await assert.rejects(f.clean(), /Unsafe or repeated/);
    assert.equal(f.deletes().length, 0);
});

test('malformed tag lists and pagination errors abort before mutation', async (t) => {
    for (const page of [{ results: null }, { results: [], next: 42 }, { results: [null] }, { results: [{}] }]) {
        await t.test(JSON.stringify(page), async () => {
            const f = fixture([tag()], { [`GET ${tagsUrl}?page_size=100`]: response(page) });
            await assert.rejects(f.clean(), /Invalid Docker Hub tag/);
            assert.equal(f.deletes().length, 0);
        });
    }
    const page2 = `${tagsUrl}?page=2`;
    const f = fixture([tag()], {
        [`GET ${tagsUrl}?page_size=100`]: response({ results: [tag()], next: page2 }),
        [`GET ${page2}`]: response({}, 503),
    });
    await assert.rejects(f.clean(), /HTTP 503/);
    assert.equal(f.deletes().length, 0);
});

test('a later run lookup failure prevents deletion of earlier verified candidates', async () => {
    for (const failure of [response({}, 403), response({}, 500), new Error('network unavailable')]) {
        const f = fixture([tag(), tag('validated-456-1-arm64')], { [`GET ${runUrl(456)}`]: failure });
        await assert.rejects(f.clean(), /HTTP (403|500)|network unavailable/);
        assert.equal(f.deletes().length, 0);
        assert.equal(f.state.size, 2);
    }
});

test('deletion requires all credentials before any network request', async () => {
    for (const key of ['githubToken', 'dockerUsername', 'dockerToken']) {
        const f = fixture();
        await assert.rejects(f.clean({ [key]: '' }), /Deletion requires/);
        assert.equal(f.calls.length, 0);
    }
});

test('authentication HTTP failures and missing access tokens never progress to listing or deletion', async () => {
    for (const reply of [response({}, 401), response({}, 500), response({}), response({ access_token: '' }), response({ access_token: '   ' })]) {
        const f = fixture([tag()], { 'POST https://hub.docker.com/v2/auth/token': reply });
        await assert.rejects(f.clean(), /HTTP (401|500)|no access token/);
        assert.equal(f.calls.length, 1);
        assert.equal(f.deletes().length, 0);
    }
});

test('dry run checks candidates without deleting, including anonymous public inspection', async () => {
    for (const credentials of [{}, { githubToken: undefined, dockerUsername: undefined, dockerToken: undefined }]) {
        const f = fixture();
        assert.deepEqual(await f.clean({ dryRun: true, ...credentials }), { deleted: [], wouldDelete: [tag().name], kept: [] });
        assert.equal(f.deletes().length, 0);
        assert.equal(f.state.size, 1);
        if ('dockerToken' in credentials) assert.ok(f.calls.every(({ options }) => !options.headers.Authorization));
    }
    const f = fixture();
    assert.deepEqual((await f.clean({ dryRun: undefined })).wouldDelete, [tag().name], 'export defaults to dry run');
});

test('fresh tag reads preserve changed names, digests, timestamps or missing digests', async (t) => {
    const changes = [
        { name: 'latest' }, { digest: `sha256:${'b'.repeat(64)}` }, { digest: null }, { digest: undefined },
        { tag_last_pushed: new Date(now - 3 * day).toISOString() },
        { tag_last_pushed: new Date(now).toISOString() }, { tag_last_pushed: 'invalid' },
    ];
    for (const change of changes) await t.test(JSON.stringify(change), async () => {
        const f = fixture([tag()], { [`GET ${tagsUrl}/${tag().name}`]: response(tag(tag().name, change)) });
        assert.deepEqual((await f.clean()).kept, [tag().name]);
        assert.equal(f.deletes().length, 0);
    });
});

test('concurrently removed tags are harmless at either detail GET or DELETE', async () => {
    const getMissing = fixture([tag()], { [`GET ${tagsUrl}/${tag().name}`]: response({}, 404) });
    assert.deepEqual(await getMissing.clean(), { deleted: [], wouldDelete: [], kept: [] });
    assert.equal(getMissing.deletes().length, 0);
    const remaining = tag('validated-456-1-arm64');
    const deleteMissing = fixture([tag(), remaining], { [`DELETE ${deleteUrl(tag().name)}`]: ({ state }) => {
        state.delete(tag().name);
        return response({}, 404);
    } });
    assert.deepEqual(await deleteMissing.clean(), { deleted: [remaining.name], wouldDelete: [], kept: [] });
    assert.equal(deleteMissing.state.size, 0);
    assert.ok(deleteMissing.logs.some((entry) => entry.startsWith('Already absent:')));
});

test('partial deletion failure is reported and a rerun safely finishes remaining tags', async () => {
    const first = tag();
    const second = tag('validated-456-1-arm64');
    const key = `DELETE ${deleteUrl(second.name)}`;
    const f = fixture([first, second], { [key]: response({}, 500) });
    await assert.rejects(f.clean(), /DELETE .*HTTP 500/);
    assert.deepEqual([...f.state.keys()], [second.name]);
    assert.ok(f.logs.some((entry) => entry === `Deleted: ${image}:${first.name}`));
    delete f.overrides[key];
    assert.deepEqual((await f.clean()).deleted, [second.name]);
    assert.deepEqual(await f.clean(), { deleted: [], wouldDelete: [], kept: [] });
    assert.equal(f.deletes().filter(({ url }) => url === deleteUrl(first.name)).length, 1);
});

test('permission failures explain the required Docker Hub delete permission', async () => {
    const f = fixture([tag()], { [`DELETE ${deleteUrl(tag().name)}`]: response({}, 403) });
    await assert.rejects(f.clean(), /HTTP 403; DOCKERHUB_TOKEN needs Read, Write, Delete permission/);
    assert.equal(f.state.size, 1);
});

test('fresh-read and delete network/server failures propagate without reporting success', async () => {
    for (const method of ['GET', 'DELETE']) for (const failure of [response({}, 503), new Error('connection reset')]) {
        const url = method === 'GET' ? `${tagsUrl}/${tag().name}` : deleteUrl(tag().name);
        const f = fixture([tag()], { [`${method} ${url}`]: failure });
        await assert.rejects(f.clean(), /HTTP 503|connection reset/);
        assert.equal(f.state.size, 1);
        assert.ok(!f.logs.some((entry) => entry.startsWith('Deleted:')));
        if (method === 'GET') assert.equal(f.deletes().length, 0);
    }
});

test('invalid options and unsafe repository names fail before requests', async () => {
    for (const options of [{ dryRun: 'false' }, { now: NaN }, { image: '../unsafe/path' },
        { image: 'https://example.com/repo' }, { repository: 'owner/repo?token=secret' }]) {
        const f = fixture();
        await assert.rejects(f.clean(options), /Invalid cleanup options|owner\/repository names/);
        assert.equal(f.calls.length, 0);
    }
});
