# End-to-end tests

Playwright tests for the web admin's core workflows. Two modes:

- **`ui` (default, mocked)** — `/api/*` is intercepted in the browser
  (`mock.ts` + `fixtures.ts`), so the suite runs deterministically with **no
  engine**, no credentials, and no cleanup. It exercises everything we own
  end-to-end (real browser + real SPA + real Node server); only the external
  engine is faked. This is the regression guard.
- **`live` (opt-in)** — drives a **real** engine through the proxy. Registered
  only when `E2E_LIVE=1`, so the default run never needs an engine.

## Run

```bash
npm run e2e                 # mocked suite (each worker boots its own Node server)
npm run e2e -- --headed     # watch it in a browser
npm run e2e -- e2e/login.spec.ts
E2E_WORKERS=1 npm run e2e   # serial, e.g. to bisect a flake
```

First time only: `npx playwright install chromium`.

The mocked suite runs in parallel: every worker starts its own web-administrator
on a free port with a **fixed config** (`e2e/base.ts`), so a run is hermetic —
it neither reads your `config.json` nor probes whatever engine you have running,
and it never collides with a dev server on `:3030`. Specs import `test` from
`./base.js`, not from `@playwright/test`; that is what routes `page.goto('/…')`
to the worker's server.

### Live mode

Start OIE and the deployment under test, then:

```bash
# web admin already running on :3030, proxying to your engine
E2E_USER=admin E2E_PASS=admin npm run e2e:live

# Docker/Node on another local port
E2E_BASE_URL=http://localhost:3031 E2E_USER=admin E2E_PASS=admin npm run e2e:live

# WAR mounted in the local OIE servlet container (self-signed TLS is accepted)
E2E_BASE_URL=https://localhost:8443/oie-webadmin E2E_EXPECT_DEPLOYMENT=war \
  E2E_USER=admin E2E_PASS=admin npm run e2e:live
```

`reuseExistingServer` makes the `live` project use the already-running target
and its real engine. The live test logs in, creates an undeployed disposable
channel, reads it from the channel list, and deletes it again. It requires engine
4.6.0 and client 0.9.0 by default; override `E2E_EXPECT_ENGINE_VERSION` or
`E2E_EXPECT_CLIENT_VERSION` only when deliberately validating another release.
Set `E2E_EXPECT_DEPLOYMENT=war` to require the WAR deployment marker.

## Layout

| File | Purpose |
|---|---|
| `playwright.config.ts` (repo root) | `ui` + `live` projects; parallel workers |
| `base.ts` | the `test` specs import: one server per worker, fixed config, per-worker `baseURL` |
| `server-harness.ts` | `startWebAdmin()` — boots a real web-administrator server on a free port |
| `sso.spec.ts` | the engine-hosted OIDC flow, mocked in the browser: provider, engine endpoints, and the ticket login |
| `fixtures.ts` | canned engine responses in the XStream wire shapes the client expects |
| `mock.ts` | `mockEngine(page, overrides)` route interceptor + `login()` helper |
| `*.spec.ts` | mocked workflow tests (login, dashboard + `cards` card view, channels, `channel-wizard`/`alert-wizard` guided builders, …) |
| `live.spec.ts` | opt-in real-engine login + channel CRUD smoke |

## Adding tests / fixtures

`mockEngine` merges your overrides onto the happy-path defaults. Keys are
`"METHOD /path"` (no `/api`, no query); `*` matches one path segment. Values:
a string (text/plain), an object/array (JSON), `{ __status, body }` for a
specific status, or a function `(req) => value` for stateful responses. Match
the **engine wire shape** (single root key, `{ key: [...] }` lists) so the
client's `unwrap`/`asList` parse it.
