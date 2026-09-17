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

First time only: `npx playwright install chromium firefox webkit`.

The default run includes the full `ui` catalog in Chromium and critical release
flows in `firefox` and `webkit`. Use `--project=ui` for the Chromium catalog or
`--project=firefox --project=webkit` for the additional engines. The critical
selection covers editor saves, pending-action dialogs, keyboard accessibility,
downloads, Monaco and textarea fallback, authentication and plugin recovery.
Playwright WebKit coverage does not substitute for a release check in Safari.
On macOS, the step-control test uses Safari's
[Option-Tab keyboard navigation](https://support.apple.com/en-ae/guide/safari/cpsh003/mac).
SSO tests use an owned loopback identity-provider stub with actual HTTP redirects;
engine authentication endpoints remain mocked. Multipart tests inspect the
submitted FormData because WebKit's interception data omits Blob part contents;
live engine contracts are the check for actual multipart delivery.

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
4.6.0 and client 1.0.0 by default; override `E2E_EXPECT_ENGINE_VERSION` or
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
`"METHOD /path"` (no `/api`, optional exact query); `*` matches one path segment. Values:
a string (text/plain), an object/array (JSON), `{ __status, body }` for a
specific status, or an async/sync function `(req) => value` for stateful responses. Match
the **engine wire shape** (single root key, `{ key: [...] }` lists) so the
client's `unwrap`/`asList` parse it.

Unexpected POST/PUT/PATCH/DELETE requests fail the test and report their query
and body. Add a fixture for the actual contract, with request assertions where
the write is under test; do not add a blanket success wildcard. Query-specific
fixtures precede path-only defaults (parameter order is normalized). Returning
`false` is an engine refusal, not an empty successful response. Default channel,
library and identity fixtures target OIE 4.6.0; compatibility tests should opt
into an older engine explicitly. Read-only serialization POSTs default to 501
to exercise the viewer's raw-content fallback.
# Owned OIE 4.6.0 operational contracts

After building Node and WAR, run `python3 tools/engine-contract.py --archive
/path/to/oie_unix_4_6_0.tar.gz --out /path/to/new-evidence-directory` from the
repository root. The runner accepts only the pinned official distribution hash,
creates a fresh loopback engine and Derby database, and runs Node and WAR through
Chromium and WebKit. Add `--plugin /path/to/websupport-<version>.zip` for the
companion API cases. Install those Playwright browsers and Java 17 first; `--java`
can select the Java executable explicitly.

The operational test checks channel CRUD, multipart group/template/library writes,
stale library rejection, core graph GET/PUT retries and silent cycle rejection
with or without Web Support, filter/transformer execution, and exact destination selection.
It invokes the actual Java `Client.processMessage(channelId, RawMessage)` overload
used by Swing and compares normalized connector IDs, statuses and responses with
the web RawMessage request. It then adds a third destination while the web send
dialog is open and verifies that all selected still means all deployed destinations.
The response also proves source-map whitespace and embedded equals signs arrived. An anonymous browser must fail to read or delete the owned channel.
This is a Swing **client contract** comparison, not desktop UI automation.

The runner saves browser results and attachments, engine logs, final API observations,
input hashes and process/cleanup receipts. It stops only its own processes and removes
its isolated engine/database after observation and shutdown, including failed runs.
The pinned input archive is retained once; old cleaned installations are not reusable
runtime evidence. Never point cleanup at a development/reference engine.

For a 0.9.0 → candidate → 0.9.0 rehearsal, also pass `--baseline-war` with the
official v0.9.0 WAR and `--baseline-node` with a built archive from the clean
v0.9.0 tag (including its locked production dependencies). The runner validates
both identities, restarts its engine between phases, and verifies that external
Node configuration and a saved channel/transformer survive unchanged. Each phase
retains its own artifact identity, browser results and engine observations.

CI prepares those pinned inputs once with `tools/prepare-contract-inputs.sh`,
checks out the companion API at an explicit commit, and requires the live engine
matrix before publication. On Linux, `--docker-image` and
`--baseline-docker-image` run the same processing and upgrade contracts against
already-built images using host networking. Containers have a unique ownership
label and CID receipt; only those containers are stopped. An unconfirmed container
identity or failed cleanup prevents claiming a cleaned run. CI tests amd64 and
arm64 before saving and promoting the exact images.
