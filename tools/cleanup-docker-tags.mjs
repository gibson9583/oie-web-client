import { pathToFileURL } from 'node:url';

const validatedTag = /^validated-([1-9][0-9]*)-([1-9][0-9]*)-(amd64|arm64)$/;
const gracePeriod = 24 * 60 * 60 * 1000;

// Delete Hub tag names only. Registry manifest DELETE would also affect the
// architecture images referenced by published multi-platform release tags.
export async function cleanupValidatedTags({
    image, repository, githubToken, dockerUsername, dockerToken,
    dryRun = true, now = Date.now(), fetchImpl = fetch, log = console.log,
}) {
    const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
    if (!repositoryPattern.test(image) || !repositoryPattern.test(repository)) {
        throw new Error('IMAGE_NAME and GITHUB_REPOSITORY must be owner/repository names');
    }
    if (typeof dryRun !== 'boolean' || !Number.isFinite(now)) throw new Error('Invalid cleanup options');
    if (!dryRun && (!dockerUsername || !dockerToken || !githubToken)) {
        throw new Error('Deletion requires DOCKERHUB_USERNAME, DOCKERHUB_TOKEN and GH_TOKEN');
    }

    async function request(url, options = {}, allowMissing = false) {
        const response = await fetchImpl(url, {
            ...options, redirect: 'error', signal: AbortSignal.timeout(30_000),
        });
        if (allowMissing && response.status === 404) return null;
        if (!response.ok) {
            const hint = options.method === 'DELETE' && response.status === 403
                ? '; DOCKERHUB_TOKEN needs Read, Write, Delete permission' : '';
            throw new Error(`${options.method || 'GET'} ${url}: HTTP ${response.status}${hint}`);
        }
        return response;
    }

    const hubHeaders = { Accept: 'application/json' };
    if (dockerUsername && dockerToken) {
        const response = await request('https://hub.docker.com/v2/auth/token', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier: dockerUsername, secret: dockerToken }),
        });
        const { access_token: token } = await response.json();
        if (typeof token !== 'string' || !token.trim()) throw new Error('Docker Hub returned no access token');
        hubHeaders.Authorization = `Bearer ${token}`;
    }
    const ghHeaders = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (githubToken) ghHeaders.Authorization = `Bearer ${githubToken}`;

    const [namespace, name] = image.split('/');
    const tagsUrl = `https://hub.docker.com/v2/namespaces/${namespace}/repositories/${name}/tags`;
    const tags = new Map();
    const visited = new Set();
    let next = `${tagsUrl}?page_size=100`;
    // Finish pagination before deleting, or deleting page 1 can shift page 2
    // and leave tags behind. Never forward credentials to another origin/path.
    while (next) {
        const url = new URL(next, tagsUrl);
        if (url.origin !== 'https://hub.docker.com' || url.username || url.password
            || url.pathname.replace(/\/$/, '') !== new URL(tagsUrl).pathname
            || visited.has(url.href)) throw new Error('Unsafe or repeated Docker Hub pagination URL');
        visited.add(url.href);
        const page = await (await request(url.href, { headers: hubHeaders })).json();
        if (!Array.isArray(page.results) || (page.next != null && typeof page.next !== 'string')) {
            throw new Error('Invalid Docker Hub tag list');
        }
        for (const tag of page.results) {
            if (typeof tag?.name !== 'string') throw new Error('Invalid Docker Hub tag');
            tags.set(tag.name, tag);
        }
        next = page.next;
    }

    const result = { deleted: [], wouldDelete: [], kept: [] };
    function keep(tag, reason) {
        result.kept.push(tag.name);
        log(`Keep ${tag.name}: ${reason}`);
    }
    function oldEnough(tag) {
        if (typeof tag.tag_last_pushed !== 'string'
            || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(tag.tag_last_pushed)) return false;
        const pushed = Date.parse(tag.tag_last_pushed);
        return Number.isFinite(pushed) && pushed <= now - gracePeriod;
    }

    const runs = new Map();
    const candidates = [];
    // Resolve every prerequisite before starting deletions. An API outage or
    // permission failure must not be mistaken for an inactive run.
    for (const tag of tags.values()) {
        const match = validatedTag.exec(tag.name);
        if (!match) continue;
        if (!oldEnough(tag)) { keep(tag, 'younger than 24 hours or missing push time'); continue; }
        const [, runId, attempt] = match;
        if (!runs.has(runId)) {
            const response = await request(`https://api.github.com/repos/${repository}/actions/runs/${runId}`,
                { headers: ghHeaders }, true);
            runs.set(runId, response ? await response.json() : null);
        }
        const run = runs.get(runId);
        if (!run || String(run.id) !== runId || run.repository?.full_name !== repository
            || run.path !== '.github/workflows/ci.yml' || run.status !== 'completed'
            || !Number.isSafeInteger(run.run_attempt) || BigInt(run.run_attempt) < BigInt(attempt)) {
            keep(tag, 'CI run is unfinished or ownership/attempt could not be verified');
            continue;
        }
        candidates.push(tag);
    }

    for (const tag of candidates) {
        const response = await request(`${tagsUrl}/${tag.name}`, { headers: hubHeaders }, true);
        if (!response) { log(`Already absent: ${tag.name}`); continue; }
        const current = await response.json();
        if (current.name !== tag.name || !oldEnough(current) || typeof current.digest !== 'string' || !current.digest
            || current.digest !== tag.digest || current.tag_last_pushed !== tag.tag_last_pushed) {
            keep(tag, 'tag changed since it was listed');
            continue;
        }
        if (dryRun) {
            result.wouldDelete.push(tag.name);
            log(`Would delete ${image}:${tag.name}`);
        } else {
            // This is the same tag-only endpoint used by docker-cleanup.yml.
            const deleted = await request(`https://hub.docker.com/v2/repositories/${image}/tags/${tag.name}/`,
                { method: 'DELETE', headers: hubHeaders }, true);
            if (deleted) result.deleted.push(tag.name);
            log(`${deleted ? 'Deleted' : 'Already absent'}: ${image}:${tag.name}`);
        }
    }
    log(`Validated tags: ${result.deleted.length} deleted, ${result.wouldDelete.length} would delete, ${result.kept.length} kept`);
    return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const mode = process.env.DRY_RUN ?? 'true';
        if (!['true', 'false'].includes(mode)) throw new Error('DRY_RUN must be true or false');
        await cleanupValidatedTags({
            image: process.env.IMAGE_NAME, repository: process.env.GITHUB_REPOSITORY,
            githubToken: process.env.GH_TOKEN, dockerUsername: process.env.DOCKERHUB_USERNAME,
            dockerToken: process.env.DOCKERHUB_TOKEN, dryRun: mode === 'true',
        });
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
