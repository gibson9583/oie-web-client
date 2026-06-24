# OIE Web Client

A standalone, web-based administrator for **[Open Integration Engine](https://github.com/openintegrationengine)** (OIE / Mirth Connect) — a browser
replacement for the Swing Administrator client. It runs as its own Node.js app,
talks to any engine over the REST API, and is **pluggable**: extension
developers add features by dropping a folder into `plugins/` (the web equivalent
of the engine's `plugin.xml` extension model).

Both administrators can be used side by side against the same engine — this app
is read/write through the same `/api` surface the Swing client uses, so nothing
about the engine install changes.

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
    ├── server/               Node/Express server, /api reverse proxy, serializer bridge
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
| **OIE / Mirth Connect engine** | any version exposing the REST API | The app is a *client* to a **running** engine — it neither bundles nor starts one. Default `https://localhost:8443`. |
| **JDK 21+** | _optional_ | Only for the exact serializer bridge (`OIE_HOME`, see [Configuration](#configuration)). Without it the app uses built-in JS parsing. |
| **Modern browser** | current Chrome / Edge / Firefox / Safari | ES-module SPA; the Monaco script editor is bundled and served locally (works air-gapped), with a plain-editor fallback. |

Contributors running the end-to-end tests also install Playwright's browser once:
`npx playwright install chromium`.

## Quick start

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
| `pluginDirs` | `WEBADMIN_PLUGIN_DIR` | `./plugins` | Extra plugin directories (e.g. the engine's `extensions/`) |
| `engineHome` | `OIE_HOME` | _(unset)_ | Path to the engine install; enables the exact serializer bridge |
| `codeTemplateCompletions` | `WEBADMIN_CODE_TEMPLATE_COMPLETIONS` | `true` | Offer the channel's own code-template functions as script-editor autocompletions; disable to avoid fetching very large catalogs |

> **Authentication** is the engine's own: the login form posts to
> `/api/users/_login` and the engine's `JSESSIONID` cookie carries the session.
> The Node server stores no credentials; it is a streaming reverse proxy. For
> production, terminate TLS in front of this app.

Setting `engineHome` (a path to an OIE install with a **JDK 21+** available) lets
the server run a warm Java sidecar on the engine's own jars, so message-tree
serialization and JavaScript validation are byte-identical to the runtime. The
sidecar uses `JAVA_HOME` if set, otherwise `java` on the `PATH`. Without it, the
app falls back to built-in JS parsing.

## Troubleshooting setup

| Symptom | Fix |
|---|---|
| `Cannot find package '@oie/web-api'`, a blank page, or bare-import errors | You installed inside a subfolder. Remove `node_modules` and run `npm install` from the **repo root** — workspaces hoist there. |
| Login fails, "engine unreachable", or a `502` | The engine isn't running or `engine.url` is wrong. Confirm `<engine.url>/api/server/version` responds. |
| TLS / certificate errors reaching the engine | Keep `engine.verifyTls` = `false` for a self-signed engine (the default). |
| `EADDRINUSE` / port `3030` already in use | Set `WEBADMIN_PORT` (or `port` in `config.json`). |
| Vite or syntax errors on `npm run dev` / `npm start` | Use Node 20 LTS+ (`node -v`); Node < 18.18 can't run Vite 5 and the test tooling. |
| Message trees or **Format Code** look approximate | Expected without the serializer bridge — set `OIE_HOME` to an engine install and ensure a **JDK 21+** is on `PATH` (or `JAVA_HOME`). |

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
