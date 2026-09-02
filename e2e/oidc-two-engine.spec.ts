import { test, expect } from './base.js';
import * as http from 'http';
import { type ChildProcess } from 'child_process';
import { CLIENT_SECRET, handleIdp, json, listen, publicProbeBody, readBody, startWebAdmin } from './oidc-harness.js';

/*
 * SSO against a MULTI-ENGINE deployment.
 *
 * oidc-login.spec.ts configures exactly one engine, and with one engine the
 * proxy ignores the routing cookie entirely — so every assertion there passes
 * whatever the callback writes into it. That is not a hypothetical gap: it is
 * why the pre-#54 callback could write `oie-engine=<numeric index>` and ship
 * green, even though in any real multi-engine deployment SSO signs the user in
 * and then loops on a bare login screen (the proxy 421s the index cookie).
 *
 * So this spec configures TWO engines on separate ports and asserts the parts
 * that only exist when there is a choice to get wrong: that the callback routes
 * the session to the engine the user actually picked, by stable key; that the
 * OTHER engine is never touched; and that the shell then boots against the
 * picked engine rather than falling back to the first entry.
 */

let idp: http.Server;
let alpha: http.Server;          // engine one
let bravo: http.Server;          // engine two
let app: ChildProcess;
let appUrl: string;
let idpUrl: string;
let alphaUrl: string;
let bravoUrl: string;

// Which engine each stub saw a login for, so a mis-routed callback is visible.
const logins: { alpha: number; bravo: number } = { alpha: 0, bravo: 0 };

// The IdP on its own port. Both engines point at this one issuer, which is the
// realistic shape: one app registration fronting several engines.
function idpHandler(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (handleIdp(req, res, { issuer: () => idpUrl })) return;
    json(res, 404, { error: 'unexpected idp path ' + String(req.url) });
}

// An engine. `which` tags the session cookie and the counter so the test can
// tell which engine the BFF actually talked to.
function engineHandler(which: 'alpha' | 'bravo') {
    return (req: http.IncomingMessage, res: http.ServerResponse): void => {
        const url = new URL(String(req.url), 'http://engine.invalid');
        if (url.pathname === '/api/extensions/oidcauth/public') {
            return json(res, 200, publicProbeBody(idpUrl));
        }
        if (url.pathname === '/api/users/_login') {
            void readBody(req).then(() => {
                logins[which] += 1;
                return json(res, 200,
                    { 'com.mirth.connect.model.LoginStatus': { status: 'SUCCESS', message: '', updatedUsername: 'jdoe' } },
                    { 'set-cookie': `JSESSIONID=session-${which}; Path=/; HttpOnly` });
            });
            return;
        }
        // The shell's post-login calls. Answering them HERE rather than through
        // mockEngine is what makes the routing observable at all: mockEngine
        // intercepts at page.route('**/api/**') inside the browser, which
        // short-circuits the Node proxy entirely.
        if (url.pathname === '/api/users/current') {
            const authed = /(?:^|;\s*)JSESSIONID=session-(\w+)/.exec(String(req.headers.cookie || ''))?.[1];
            return authed === which ? json(res, 200, { user: { id: 1, username: 'jdoe' } }) : json(res, 401, {});
        }
        // Engine-SOURCED identity, so the status bar names the engine the browser's
        // /api traffic actually reached. currentEngineLabel() derives its half of
        // that string from the routing cookie, so the cookie alone proves nothing;
        // this half can only come from whichever engine the proxy chose.
        if (url.pathname === '/api/server/publicSettings') {
            return json(res, 200, { publicServerSettings: { serverName: `${which} Engine`, environmentName: 'e2e' } });
        }
        // Raw text reads: api.ts fetches these with { raw: true } and returns the
        // body verbatim, so an XStream envelope here would be stored literally
        // (see e2e/fixtures.ts, which documents the same rule).
        if (url.pathname === '/api/server/id') { res.end(`${which}-server-id`); return; }
        if (url.pathname === '/api/server/version') { res.end('4.5.0'); return; }
        if (url.pathname === '/api/server/status') { res.end('RUNNING'); return; }
        // Anything unrecognized is a 404, NOT an empty 200. A catch-all 200 lets
        // the shell boot against a mis-routed proxy, which quietly reduces the
        // assertions below to a check of the server-side hop only.
        //
        // 404 specifically, because it cannot disturb what those assertions read:
        // core/api.ts counts any answer as reachable ("a 500 is an engine with an
        // opinion") and only a rejected fetch or a GATEWAY status (502/503/504)
        // sets conn.state = 'unreachable', which would outrank the `Connected to:`
        // line in the status bar. The shell does 404 on real calls here —
        // /api/webplugins, preference reads, dashboard fetches — and that is fine.
        json(res, 404, { error: `unexpected engine path ${url.pathname}` });
    };
}

test.beforeAll(async () => {
    const idpStub = await listen(idpHandler);
    idp = idpStub.server; idpUrl = idpStub.url;
    const alphaStub = await listen(engineHandler('alpha'));
    alpha = alphaStub.server; alphaUrl = alphaStub.url;
    const bravoStub = await listen(engineHandler('bravo'));
    bravo = bravoStub.server; bravoUrl = bravoStub.url;

    const started = await startWebAdmin({
        allowedUrls: [{ name: 'Alpha', url: alphaUrl }, { name: 'Bravo', url: bravoUrl }],
        // One IdP registration, so BOTH engines share a client secret — the case
        // where the sealing key alone cannot say which engine a transaction
        // belongs to.
        // Distinct labels: with one shared label the SSO button cannot
        // distinguish "resolved Bravo" from "resolved Alpha while Bravo was
        // selected". providerLabel is per-engine web-tier display config,
        // independent of clientSecret, so this keeps the shared-secret shape.
        oidc: {
            Alpha: { enabled: true, clientSecret: CLIENT_SECRET, providerLabel: 'Alpha SSO' },
            Bravo: { enabled: true, clientSecret: CLIENT_SECRET, providerLabel: 'Bravo SSO' }
        }
    });
    app = started.process; appUrl = started.url;
});

test.afterAll(async () => {
    app?.kill();
    for (const server of [idp, alpha, bravo]) {
        await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    }
});

test.beforeEach(() => { logins.alpha = 0; logins.bravo = 0; });

test.describe('OIDC login, multi-engine', () => {
    test('the SSO affordance follows the selected engine', async ({ page }) => {
        await page.goto(appUrl + '/');
        const picker = page.locator('.login-card select');
        await expect(picker).toBeVisible();
        await expect(picker.locator('option')).toHaveText([/Alpha/, /Bravo/]);
        // Per-engine labels, so this distinguishes "resolved the selected engine"
        // from "resolved some engine" — an index lookup under a k: key yields
        // undefined and no button at all, but a wrong-but-valid lookup would
        // otherwise render an identical one.
        await expect(page.getByRole('button', { name: 'Sign in with Alpha SSO' })).toBeVisible();
        await picker.selectOption('k:bravo');
        await expect(page.getByRole('button', { name: 'Sign in with Bravo SSO' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Sign in with Alpha SSO' })).toHaveCount(0);
    });

    for (const [picked, other] of [['bravo', 'alpha'], ['alpha', 'bravo']] as const) {
        // Both directions, so an implementation that always picks the first entry
        // fails one of them. Without the mirror, "always engines[0]" passes.
        test(`SSO routes the session to ${picked}, the engine the user picked`, async ({ page }) => {
            await page.goto(appUrl + '/');
            await page.locator('.login-card select').selectOption(`k:${picked}`);
            await page.getByRole('button', { name: `Sign in with ${picked === 'alpha' ? 'Alpha' : 'Bravo'} SSO` }).click();
            await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });

            // Server-side hop: the BFF exchanged the code against the picked
            // engine and never touched the other one.
            expect(logins).toEqual({ [picked]: 1, [other]: 0 });
            const routing = (await page.context().cookies()).find((c) => c.name === 'oie-engine');
            expect(decodeURIComponent(routing?.value ?? '')).toBe(`k:${picked}`);
            // Browser hop, independently: the second half of this string comes
            // from the engine's own publicSettings, so it can only read `picked`
            // if the proxy routed the browser's /api traffic there too. The
            // cookie assertion above cannot show this — currentEngineLabel()
            // derives its half from that same cookie.
            const label = picked === 'alpha' ? 'Alpha' : 'Bravo';
            await expect(page.locator('.statusbar')).toContainText(`Connected to: ${label} | e2e - ${picked} Engine as jdoe`);
        });
    }

    test('the callback re-asserts routing even when the browser sent a different engine', async ({ page }) => {
        // Reaching /oidc/start directly skips login.tsx's commitEngineSelection,
        // which writes oie-engine BEFORE the redirect. Without this, the cookie
        // assertions above pass on the client's own pre-write and would not
        // notice the callback failing to write the cookie at all — a real gap,
        // since a second tab can overwrite the cookie mid-flow.
        await page.goto(appUrl + '/');
        await page.context().addCookies([{ name: 'oie-engine', value: 'k%3Aalpha', url: appUrl }]);
        await page.goto(`${appUrl}/oidc/start?engine=k%3Abravo&return=%2F`);
        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });

        expect(logins).toEqual({ alpha: 0, bravo: 1 });
        const routing = (await page.context().cookies()).find((c) => c.name === 'oie-engine');
        expect(decodeURIComponent(routing?.value ?? '')).toBe('k:bravo');
        await expect(page.locator('.statusbar')).toContainText('Connected to: Bravo | e2e - bravo Engine as jdoe');
    });
});
