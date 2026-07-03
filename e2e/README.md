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

Start `/oie` and the web admin yourself, then:

```bash
# web admin already running on :3030, proxying to your engine
E2E_USER=admin E2E_PASS=admin npm run e2e:live
```

`reuseExistingServer` makes the `live` project use your already-running dev
server (and thus your real engine). `live.spec.js` is intentionally a minimal
login smoke — extend it with real CRUD/deploy flows when you want higher
fidelity.

## Layout

| File | Purpose |
|---|---|
| `playwright.config.js` (repo root) | `ui` + `live` projects; boots `npm start -w web-administrator` |
| `fixtures.js` | canned engine responses in the XStream wire shapes the client expects |
| `mock.js` | `mockEngine(page, overrides)` route interceptor + `login()` helper |
| `*.spec.js` | mocked workflow tests (login, dashboard + `cards` card view, channels, `channel-wizard`/`alert-wizard` guided builders, …) |
| `live.spec.js` | opt-in real-engine smoke |

## Adding tests / fixtures

`mockEngine` merges your overrides onto the happy-path defaults. Keys are
`"METHOD /path"` (no `/api`, no query); `*` matches one path segment. Values:
a string (text/plain), an object/array (JSON), `{ __status, body }` for a
specific status, or a function `(req) => value` for stateful responses. Match
the **engine wire shape** (single root key, `{ key: [...] }` lists) so the
client's `unwrap`/`asList` parse it.
