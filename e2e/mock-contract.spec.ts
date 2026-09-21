import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

// Exercise the real routing callback directly so the deliberately rejected
// request can be asserted without converting it into a test-runner failure.
async function fixtureRequest(overrides: object, method: string, path: string, body = '') {
    let handler: any;
    let response: any;
    await mockEngine({ route: async (_pattern: string, callback: any) => { handler = callback; } }, overrides);
    const run = () => handler({
        request: () => ({ url: () => `http://fixture/api${path}`, method: () => method, postData: () => body }),
        fulfill: async (value: any) => { response = value; },
    });
    return { run, response: () => response };
}

test('unexpected mutations fail with method, query and request body', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const request = await fixtureRequest({}, method, '/unanticipated?override=true', 'submitted');
        await expect(request.run()).rejects.toThrow(`Unexpected engine mutation: ${method} /unanticipated?override=true\nBody: submitted`);
        expect(request.response().status).toBe(501);
    }
});

test('exact query contracts take precedence and false receipts stay false', async () => {
    const fixtures = {
        'PUT /channels/*?override=false&returnErrors=true': false,
        'PUT /channels/*?override=true&returnErrors=true': true,
    };
    const declined = await fixtureRequest(fixtures, 'PUT', '/channels/test?returnErrors=true&override=false');
    await declined.run();
    expect(declined.response().body).toBe('false');
    const accepted = await fixtureRequest(fixtures, 'PUT', '/channels/test?override=true&returnErrors=true');
    await accepted.run();
    expect(accepted.response().body).toBe('true');
});

test('async fixtures wait for controlled completion and retain partial results', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const request = await fixtureRequest({ 'POST /contract': async (req: any) => {
        expect(JSON.parse(req.postData())).toEqual({ item: 'intent' });
        await gate;
        return { result: { librariesSuccess: false, overrideNeeded: true } };
    } }, 'POST', '/contract', '{"item":"intent"}');
    const pending = request.run();
    await Promise.resolve();
    expect(request.response()).toBeUndefined();
    release();
    await pending;
    expect(JSON.parse(request.response().body)).toEqual({ result: { librariesSuccess: false, overrideNeeded: true } });
});
