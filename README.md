# OIE Web Client

A standalone, web-based administrator for **[Open Integration Engine](https://github.com/openintegrationengine)** (OIE / Mirth Connect) — a browser
replacement for the Swing Administrator client. It runs as its own Node.js app,
talks to any engine over the REST API, and is **pluggable**: extension
developers add features by dropping a folder into `plugins/` (the web equivalent
of the engine's `plugin.xml` extension model).

Both administrators can be used side by side against the same engine — this app
is read/write through the same `/api` surface the Swing client uses. The one
engine-side addition is a drop-in **[web support plugin](#requirements)** (it adds
a few REST endpoints the client needs; it doesn't modify the engine).

```
┌─────────────┐   http :3030    ┌──────────────────┐   https :8443/api   ┌────────────┐
│   Browser   │ ──────────────▶ │   Web Client     │ ──────────────────▶ │   Engine   │
│  (this SPA) │                 │  (Node/Express)  │   reverse proxy     │ (OIE/Mirth)│
└─────────────┘                 └──────────────────┘                     └────────────┘
                                   │  plugins/  (server + browser extensions)
```

## Repository layout

An npm-workspaces monorepo: the application plus the `@oie/*` framework packages
plugin authors build against.

```
oie-web-client/
├── LICENSE
├── README.md                 ← you are here
├── package.json              workspaces + lint / typecheck / e2e scripts
├── e2e/                       Playwright end-to-end tests (mock-by-default; `npm run e2e`)
├── type-tests/                TypeScript checks for the @oie/* public types (`npm run typecheck`)
├── packages/                 @oie/* framework libs (for plugin authors)
│   ├── web-api/              engine REST client + model helpers
│   ├── web-ui/               DOM toolkit, tables, forms, code editor, connector panels
│   ├── web-shell/            platform extension points
│   └── eslint-config/        shared lint config enforcing the @oie/* boundary
└── web-administrator/        ← the application
    ├── client/               browser SPA (ES modules; Vite build, source served in dev)
    ├── server/               Node/Express server, /api reverse proxy, plugin install
    ├── plugins/              bundled web plugins (server + browser extensions)
    ├── PLUGINS.md            plugin development guide (worked examples)
    ├── RBAC.md               role-based access control hooks + permission catalog
    ├── docs/                 parity / feedback notes
    ├── config.example.json   copy to config.json and edit
    └── package.json
```

## Requirements

| Tool | Version | Notes |
|---|---|---|
| **Node.js** | **20 LTS or newer** (18.18+ minimum) | Runs the server, the Vite build, and the tests; bundles a compatible npm. Check with `node -v`. |
| **npm** | **9+** (ships with Node 18+) | This is an npm-**workspaces** monorepo (npm 7+ required). Yarn/pnpm are not used. |
| **OIE / Mirth Connect engine** | **4.6.0** | The app is a *client* to a **running** engine — it neither bundles nor starts one. Default `https://localhost:8443`. This release line targets OIE 4.6.0. |
| **OIE Web Support plugin** | latest | **Required.** Installs the engine REST endpoints the web client uses for byte-exact message-tree serialization and JavaScript validation/formatting — these aren't in the core 4.6.0 engine. Install it into the engine's `extensions/` and restart. → **[gibson9583/oie-web-support-plugin](https://github.com/gibson9583/oie-web-support-plugin)** |
| **Modern browser** | current Chrome / Edge / Firefox / Safari | ES-module SPA; the Monaco script editor is bundled and served locally (works air-gapped), with a plain-editor fallback. |

Contributors running the end-to-end tests also install Playwright's browser once:
`npx playwright install chromium`.

## Quick start

> **Prerequisite — install the web support plugin first.** Your engine needs the
> **[OIE Web Support plugin](https://github.com/gibson9583/oie-web-support-plugin)**
> installed, which adds REST endpoints the web client relies on that aren't in the
> core 4.6.0 engine. Grab its latest release, extract it into the engine's
> `extensions/` (or install via the Swing Administrator), and restart the engine.

> ⚠️ Run `npm install` **at the repository root**. This is an npm-workspaces
> monorepo — installing inside `web-administrator/` will not link the `@oie/*`
> packages and the app won't start.

```bash
# 1) From the repo root — installs every workspace (root, packages/*, web-administrator):
npm install

# 2) Point the app at your engine:
cd web-administrator
cp config.example.json config.json        # then edit "engine.url" to your OIE/Mirth REST URL

# 3) Run it:
npm run dev                               # dev: file-watch + Vite, no build step (recommended while developing)
#   — or —
npm start                                 # serves client/dist if built, otherwise the source directly

# Open http://localhost:3030 and sign in with your engine credentials (e.g. admin / admin).
```

The engine must be **running and reachable** at `engine.url` before you sign in.
OIE/Mirth ships a **self-signed TLS cert**, so `engine.verifyTls` defaults to
`false`; set it `true` only when the engine presents a trusted certificate.

`npm run dev` serves and transforms `client/` source on the fly — no manual build
while developing. `npm run build` emits an optimized `client/dist` that `npm
start` serves when present (otherwise it serves the source directly). Either path
keeps the framework a single shared instance, so runtime-loaded plugins resolve
against the same copy.

## Configuration

Settings load from `web-administrator/config.json` (gitignored — it holds
machine-specific paths), with environment-variable overrides. Start from
[`config.example.json`](web-administrator/config.example.json):

| Setting | Env var | Default | Description |
|---|---|---|---|
| `port` | `WEBADMIN_PORT` | `3030` | Port the web UI listens on |
| `host` | `WEBADMIN_HOST` | `0.0.0.0` | Bind address |
| `engine.url` | `OIE_URL` | `https://localhost:8443` | Engine base URL |
| `engine.verifyTls` | `OIE_VERIFY_TLS` | `false` | Verify the engine's TLS cert (engines ship self-signed) |
| `allowedUrls` | — | `[]` | Multi-engine mode: `[{ "name", "url", "verifyTls"? }, …]` becomes an engine picker on the login screen. Empty → single-engine mode (just `engine.url`, no picker) |
| `devMode` | `WEBADMIN_DEV_MODE` | `false` | Adds a free-form engine URL field at login. The proxy forwards to whatever is typed, so trusted/dev deployments only. (Distinct from `npm run dev`, which is the Vite dev server) |
| `pluginDirs` | `WEBADMIN_PLUGIN_DIRS` | `[]` | Additional **local** plugin dirs scanned alongside the bundled `./plugins` (e.g. for local development). Extensions installed on the engine are served by the engine, not stored here. `:`-separated in the env var |
| `trustedProxies` | `WEBADMIN_TRUSTED_PROXIES` | `[]` | Peer IPs trusted to set `X-Forwarded-For` (a front TLS terminator / reverse proxy). Loopback is always trusted. Comma-separated in the env var |
| `codeTemplateCompletions` | `WEBADMIN_CODE_TEMPLATE_COMPLETIONS` | `true` | Offer the channel's own code-template functions as script-editor autocompletions; disable to avoid fetching very large catalogs |
| `tls` | `WEBADMIN_TLS_KEY` / `WEBADMIN_TLS_CERT` / `WEBADMIN_TLS_PASSPHRASE` | `null` (HTTP) | Serve the UI over **HTTPS** directly — set `{ "key", "cert", "passphrase"? }` to PEM file paths (both key and cert required). Off by default; see [Serving over HTTPS](#serving-over-https) |

### Deployment modes

- **Single engine** (default): set `engine.url`; every login goes to that engine.
- **Multiple engines**: list them in `allowedUrls` — the login screen shows a
  picker and the proxy routes each session to the engine chosen at login:

  ```json
  {
      "allowedUrls": [
          { "name": "Production", "url": "https://oie-prod:8443", "verifyTls": true },
          { "name": "Test", "url": "https://oie-test:8443" }
      ]
  }
  ```

- **Open engine URL** (`devMode: true`): the login screen accepts any engine URL
  typed by the user. The proxy will forward to whatever host is entered — use
  only on trusted networks / developer machines.

How `engine` and `allowedUrls` relate: a non-empty `allowedUrls` **replaces**
the engine list — `engine.url` is not added to the picker automatically, so
include it as an entry if it should be selectable. `engine.verifyTls` remains
the fallback for any entry that omits its own `verifyTls`. The `OIE_URL` /
`OIE_VERIFY_TLS` env vars override only `engine`, never `allowedUrls`.

> **Authentication** is the engine's own: the login form posts to
> `/api/users/_login` and the engine's `JSESSIONID` cookie carries the session.
> The Node server stores no credentials; it is a streaming reverse proxy.

### Serving over HTTPS

By default the app serves plain **HTTP** on `port` (the browser ↔ web-admin hop);
the web-admin ↔ engine hop is already HTTPS. Two ways to encrypt the last hop:

- **Reverse proxy (recommended for production).** Terminate TLS at nginx, Caddy,
  Traefik, or a load balancer in front of the app — you get automatic certificate
  issuance/renewal, HTTP→HTTPS redirect, and HSTS for free. Set `trustedProxies` to
  the proxy's IP so the engine's audit log sees the real client address. With Caddy
  it's essentially `your.host { reverse_proxy localhost:3030 }`.

- **Built-in TLS (handy for standalone installs).** Point the app at a PEM key +
  cert and it serves HTTPS itself — no extra process:

  ```json
  {
      "tls": { "key": "certs/webadmin-key.pem", "cert": "certs/webadmin-cert.pem" }
  }
  ```

  or via env: `WEBADMIN_TLS_KEY` / `WEBADMIN_TLS_CERT` (+ `WEBADMIN_TLS_PASSPHRASE`
  if the key is encrypted). Paths are relative to `web-administrator/` or absolute;
  **both key and cert are required** to enable it. Startup logs `https://…  (TLS)`.
  A self-signed cert works for testing (browsers will warn); use a CA-issued cert
  in production.

Byte-exact message-tree serialization and JavaScript validation come from the
**connected engine** (`/datatypes/_serialize`, `/javascript/_validate`) — no
local JVM or engine install to configure. The client probes for these on each
session: engine-native endpoints first, then the **Web Support plugin**
([oie-web-support-plugin](https://github.com/gibson9583/oie-web-support-plugin)),
which provides them on a stock engine with no engine changes. With neither,
the app still works — message trees, server-side validation, and engine-served
plugin UIs are disabled with a notice. Format Document runs entirely client-side.

## Troubleshooting setup

| Symptom | Fix |
|---|---|
| `Cannot find package '@oie/web-api'`, a blank page, or bare-import errors | You installed inside a subfolder. Remove `node_modules` and run `npm install` from the **repo root** — workspaces hoist there. |
| Login fails, "engine unreachable", or a `502` | The engine isn't running or `engine.url` is wrong. Confirm `<engine.url>/api/server/version` responds. |
| TLS / certificate errors reaching the engine | Keep `engine.verifyTls` = `false` for a self-signed engine (the default). |
| `EADDRINUSE` / port `3030` already in use | Set `WEBADMIN_PORT` (or `port` in `config.json`). |
| Vite or syntax errors on `npm run dev` / `npm start` | Use Node 20 LTS+ (`node -v`); Node < 18.18 can't run Vite 5 and the test tooling. |
| Message trees, Validate Script, or plugin UIs don't work | The connected engine has neither native web-support endpoints nor the [Web Support plugin](https://github.com/gibson9583/oie-web-support-plugin). Install `websupport-<version>.zip` from the Extensions page and restart the engine. |

## Plugins & the Community Store

Nearly every feature is a plugin — connectors, data types, dashboard tabs,
settings panels, and more — and third parties add their own the same way the
bundled ones are built.

The **[OIE Community Store](https://github.com/gibson9583/oie-community-store)** is
the easiest way to find and install plugins that support the web client. It's a
**web-only** feature: browse community plugins, channels, and code templates and
install them straight from the client UI — no manual file copying. Many existing
community plugins have been updated with web client support and are available there
for testing.

Building your own? See
[`web-administrator/PLUGINS.md`](web-administrator/PLUGINS.md) for the extension
points and worked examples.

## Framework packages (`@oie/*`)

Plugins build against published workspace packages instead of reaching into
shell internals:

| Package | Purpose |
|---|---|
| [`@oie/web-api`](packages/web-api) | Engine REST client + model helpers |
| [`@oie/web-ui`](packages/web-ui) | DOM toolkit, tables, forms, code editor, connector-panel helpers |
| [`@oie/web-shell`](packages/web-shell) | `platform` extension points (nav, views, settings, connectors) |
| [`@oie/eslint-config`](packages/eslint-config) | Shared lint config enforcing the public-API boundary |

At runtime the host page's import map resolves `@oie/*` to the shell's loaded
copy, so a plugin shares one framework instance whether it's bundled or served
from an extension zip. Plugins may also import the framework by absolute URL
(`/core/ui.js`); `@oie/*` is preferred for the dev-time types and lint. Run
`npm run lint` at the repo root to enforce the boundary.

## Development

Run from the repo root:

| Command | What it does |
|---|---|
| `npm run lint` | ESLint across the repo, including the `@oie/*` import-boundary rules |
| `npm run typecheck` | `tsc` over `type-tests/` — validates the `@oie/*` public type surface |
| `npm run e2e` | Playwright suite; `/api/*` is mocked in-browser, so it runs with no engine |
| `npm run e2e:live` | The same specs against a real engine (opt-in via `E2E_LIVE=1`) |

## Documentation

- [`web-administrator/README.md`](web-administrator/README.md) — full feature
  overview, look & feel, and engine-API notes.
- [`web-administrator/PLUGINS.md`](web-administrator/PLUGINS.md) —
  plugin development guide with worked examples for every extension point.

## License

See [LICENSE](LICENSE).
