import { test, expect } from './base.js';
import { mockEngine, fixtureXml } from './mock.js';
import { makeChannel } from './connector-fixtures.js';

const ID = 'single-channel-xml';
const read = async (page: any) => page.evaluate(async (id: string) => {
    const { channels } = await import(String('/core/api.js'));
    return channels.get(id);
}, ID);

function fixture() {
    const channel = makeChannel(ID);
    channel.name = 'Single XML channel';
    channel.preprocessingScript = '';
    channel.sourceConnector.transformer.inboundProperties = {
        '@class': 'com.mirth.connect.plugins.datatypes.raw.RawDataTypeProperties',
        batchProperties: { '@class': 'com.mirth.connect.plugins.datatypes.raw.RawBatchProperties', batchScript: 'null', splitType: 'JavaScript' }
    };
    channel.sourceConnector.transformer.outboundTemplate = { '@encoding': 'base64', $: 'bnVsbA==' };
    return channel;
}

test('unambiguous XML retains ordinary object prototypes and safe own field names', async ({ page }) => {
    // No ambiguous known String fields: this exercises the branch that does
    // not clone the model during exact-text recovery. Assert in the browser,
    // before Playwright's return-value serialization could hide prototypes.
    const xml = `<channel version="4.6.0"><id>${ID}</id><revision>1</revision>
        <name>Unambiguous channel</name><preprocessingScript>return message;</preprocessingScript>
        <properties><entry><name>first</name></entry><entry><name>second</name></entry>
        <__proto__><kept>true</kept></__proto__><constructor>configured</constructor></properties></channel>`;
    let requests = 0;
    await mockEngine(page, { [`GET /channels/${ID}`]: () => { requests++; return xml; } });
    await page.goto('/channels');
    const result = await page.evaluate(async id => {
        const { channels } = await import(String('/core/api.js'));
        const channel = await channels.get(id);
        const objects: any[] = [];
        const visit = (value: any) => {
            if (!value || typeof value !== 'object') return;
            if (!Array.isArray(value)) objects.push(value);
            for (const child of Object.values(value)) visit(child);
        };
        visit(channel);
        return {
            ordinary: objects.every(value => Object.getPrototypeOf(value) === Object.prototype),
            descriptors: Object.getOwnPropertyDescriptor(channel.properties, '__proto__'),
            own: Object.hasOwn(channel.properties, '__proto__'),
            constructor: channel.properties.constructor,
            polluted: Object.hasOwn(Object.prototype, 'kept'),
            rows: channel.properties.entry.map((entry: any) => entry.name)
        };
    }, ID);
    expect(result).toEqual({ ordinary: true, own: true, constructor: 'configured', polluted: false,
        descriptors: { value: { kept: true }, writable: true, enumerable: true, configurable: true }, rows: ['first', 'second'] });
    expect(requests).toBe(1);
});

test('single-channel reads use one fresh XML response, including after same-revision replacement and writes', async ({ page }) => {
    let channel = fixture();
    const requests: string[] = [];
    const writes: any[] = [];
    await mockEngine(page, {
        [`GET /channels/${ID}`]: (request: any) => { requests.push(request.headers().accept); return fixtureXml('channel', channel); },
        [`PUT /channels/${ID}`]: (request: any) => { channel = request.postDataJSON().channel; writes.push(structuredClone(channel)); return true; },
        'POST /channels': (request: any) => { writes.push(request.postDataJSON().channel); return true; }
    });
    await page.goto('/channels');
    const first = await read(page);
    expect(first.preprocessingScript).toBe('');
    expect(first.sourceConnector.transformer.inboundProperties.batchProperties.batchScript).toBe('null');
    expect(first.sourceConnector.transformer.outboundTemplate).toBe('null');
    expect(requests).toEqual(['application/xml']);

    // The engine accepts supplied metadata and restarts revisions on recreate.
    // These two saved String bodies even have the same primitive JSON null.
    channel.preprocessingScript = 'null';
    const replaced = await read(page);
    expect(replaced.preprocessingScript).toBe('null');
    expect(requests).toEqual(['application/xml', 'application/xml']);
    const saved = await page.evaluate(async id => {
        const { channels } = await import(String('/core/api.js'));
        const current = await channels.get(id);
        current.description = 'Unrelated edit';
        await channels.update(id, current);
        await channels.create({ ...current, id: 'copy' });
        return channels.get(id);
    }, ID);
    expect(saved.preprocessingScript).toBe('null');
    expect(saved.description).toBe('Unrelated edit');
    expect(writes.map(value => value.preprocessingScript)).toEqual(['null', 'null']);
    expect(writes[0].sourceConnector.transformer.outboundTemplate).toEqual({ '@encoding': 'base64', $: 'bnVsbA==' });
    expect(requests).toEqual(Array(4).fill('application/xml'));
});

test('editor open and save transfer one channel snapshot per required read', async ({ page }) => {
    let channel = fixture();
    const requests: string[] = [];
    let writes = 0;
    await mockEngine(page, {
        [`GET /channels/${ID}`]: (request: any) => { requests.push(request.headers().accept); return fixtureXml('channel', channel); },
        [`PUT /channels/${ID}`]: (request: any) => { channel = request.postDataJSON().channel; writes++; return true; }
    });
    await page.goto(`/channels/${ID}/edit`);
    await expect(page.locator('.panel input[type=text]').first()).toHaveValue('Single XML channel');
    expect(requests).toEqual(['application/xml']);
    await page.locator('.panel input[type=text]').first().fill('Renamed XML channel');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect.poll(() => writes).toBe(1);
    await expect.poll(() => requests.length).toBe(3); // load, save preflight, accepted-write readback
    expect(requests).toEqual(Array(3).fill('application/xml'));
});

test('read failures and missing channels never reuse an earlier successful response', async ({ page }) => {
    let response: any = fixtureXml('channel', fixture());
    let requests = 0;
    await mockEngine(page, { [`GET /channels/${ID}`]: () => { requests++; return response; } });
    await page.goto('/channels');
    expect((await read(page)).id).toBe(ID);
    for (const [value, expected] of [
        [{ __status: 403, body: 'Permission revoked' }, 'Permission revoked'],
        [{ __status: 503, body: 'Engine unavailable' }, 'Engine unavailable'],
        ['<channel>', 'invalid message XML'],
        [fixtureXml('channel', { ...fixture(), id: 'different' }), 'invalid channel XML'],
    ] as const) {
        response = value;
        const error = await read(page).then(() => '', (error: Error) => error.message);
        expect(error).toContain(expected);
    }
    for (const empty of ['', '<null/>']) { response = empty; expect(await read(page)).toBeNull(); }
    const changed = fixture(); changed.preprocessingScript = 'false';
    response = fixtureXml('channel', changed);
    expect((await read(page)).preprocessingScript).toBe('false');
    expect(requests).toBe(8);
});

test('overlapping reads keep their own snapshot and discard a response from an ended session', async ({ page }) => {
    let count = 0;
    let release = () => {};
    let hold: Promise<void> | undefined;
    await mockEngine(page, {
        [`GET /channels/${ID}`]: async () => {
            const index = ++count;
            const channel = fixture();
            channel.preprocessingScript = index === 1 ? '' : 'null';
            const xml = fixtureXml('channel', channel);
            if (index === 1 || index === 3) await hold;
            return xml;
        }
    });
    await page.goto('/channels');
    hold = new Promise<void>(resolve => { release = resolve; });
    const first = read(page);
    try {
        await expect.poll(() => count).toBe(1);
        expect((await read(page)).preprocessingScript).toBe('null');
    } finally { release(); }
    expect((await first).preprocessingScript).toBe('');

    hold = new Promise<void>(resolve => { release = resolve; });
    const stale = read(page).then(() => '', (error: Error) => error.message);
    try {
        await expect.poll(() => count).toBe(3);
        await page.evaluate(async () => (await import(String('/core/engine-fetch.js'))).discardEngineResponses());
    } finally { release(); }
    expect(await stale).toMatch(/previous session/);
    expect((await read(page)).preprocessingScript).toBe('null');
    expect(count).toBe(4);
});


test('an expired session cannot reuse an earlier channel response', async ({ page }) => {
    let expired = false;
    let requests = 0;
    await mockEngine(page, { [`GET /channels/${ID}`]: () => {
        requests++;
        return expired ? { __status: 401 } : fixtureXml('channel', fixture());
    } });
    await page.goto('/channels');
    expect((await read(page)).id).toBe(ID);
    expired = true;
    const error = await read(page).then(() => '', (error: Error) => error.message);
    expect(error).toContain('Session expired');
    expect(requests).toBe(2);
});
