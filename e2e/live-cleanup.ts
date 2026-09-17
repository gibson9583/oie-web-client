// Shared live-test cleanup uses the application session fence for reads and writes.
export async function matchingChannels(page: any, apiBase: string, name: string, appBase = '') {
    return page.evaluate(async ({ base, channelName, core }: any) => {
        const { engineFetch, assertEngineResponse } = await import(core);
        const response = await engineFetch(`${base}/channels`, {
            headers: { Accept: 'application/json', 'X-Requested-With': 'OpenAPI' }
        });
        if (!response.ok) throw new Error(`Channel cleanup list failed (${response.status})`);
        const body = await response.json();
        assertEngineResponse(response);
        if (!body || (!('list' in body) && !('channel' in body))) throw new Error('Invalid channel cleanup response');
        const raw = body?.list?.channel ?? body?.channel ?? [];
        const channels = Array.isArray(raw) ? raw : [raw];
        return channels
            .filter((candidate: any) => candidate?.name === channelName)
            .map((candidate: any) => ({ id: String(candidate.id), name: String(candidate.name) }));
    }, { base: apiBase, channelName: name, core: `${appBase}/core/engine-fetch.js` });
}

export async function removeMatchingChannels(page: any, apiBase: string, name: string, appBase = '') {
    const matches = await matchingChannels(page, apiBase, name, appBase);
    for (const channel of matches) {
        await page.evaluate(async ({ base, id, core }: any) => {
            const { engineFetch, assertEngineResponse } = await import(core);
            const response = await engineFetch(`${base}/channels/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                headers: { Accept: 'application/json', 'X-Requested-With': 'OpenAPI' }
            });
            if (!response.ok) throw new Error(`Channel cleanup delete failed for ${id} (${response.status})`);
            await response.text();
            assertEngineResponse(response);
        }, { base: apiBase, id: channel.id, core: `${appBase}/core/engine-fetch.js` });
    }
    const residual = await matchingChannels(page, apiBase, name, appBase);
    if (residual.length) throw new Error(`Channel cleanup left ${residual.length} matching channel(s)`);
}
