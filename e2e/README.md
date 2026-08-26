# End-to-end tests

Playwright tests for the web admin's core workflows. Two modes:

- **`ui` (default, mocked)** — `/api/*` is intercepted in the browser
  (`mock.js` + `fixtures.js`), so the suite runs deterministically with **no
  engine**, no credentials, and no cleanup. It exercises everything we own
  end-to-end (real browser + real SPA + real Node server); only the external
  engine is faked. This is the regression guard.
- **`live` (opt-in)** — drives a **real** engine through the proxy. Registered
  only when `E2E_LIVE=1`, so the default run never needs an engine.

## Run

```bash
npm run e2e                 # mocked suite (boots the Node server automatically)
npm run e2e -- --headed     # watch it in a browser
npm run e2e -- login.spec.js
```

First time only: `npx playwright install chromium`.

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
4.6.0 and client 0.8.0 by default; override `E2E_EXPECT_ENGINE_VERSION` or
`E2E_EXPECT_CLIENT_VERSION` only when deliberately validating another release.
Set `E2E_EXPECT_DEPLOYMENT=war` to require the WAR deployment marker.

## Layout

| File | Purpose |
|---|---|
| `playwright.config.ts` (repo root) | `ui` + `live` projects; boots `npm start -w web-administrator` |
| `fixtures.js` | canned engine responses in the XStream wire shapes the client expects |
| `mock.js` | `mockEngine(page, overrides)` route interceptor + `login()` helper |
| `*.spec.js` | mocked workflow tests (login, dashboard + `cards` card view, channels, `channel-wizard`/`alert-wizard` guided builders, …) |
| `live.spec.ts` | opt-in real-engine login + channel CRUD smoke |

## Adding tests / fixtures

`mockEngine` merges your overrides onto the happy-path defaults. Keys are
`"METHOD /path"` (no `/api`, no query); `*` matches one path segment. Values:
a string (text/plain), an object/array (JSON), `{ __status, body }` for a
specific status, or a function `(req) => value` for stateful responses. Match
the **engine wire shape** (single root key, `{ key: [...] }` lists) so the
client's `unwrap`/`asList` parse it.
