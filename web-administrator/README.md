# OIE Web Administrator

A standalone, web-based administrator for **Open Integration Engine** — a browser
replacement for the Swing Administrator client. It runs as its own NodeJS app,
talks to any engine over the REST API, and is **pluggable**: third-party
developers extend it by dropping a folder into `plugins/` (the web equivalent of
the engine's `plugin.xml` extension model).

Both administrators can be used side by side against the same engine — this app
is read/write through the same `/api` surface the Swing client uses, so nothing
about the engine install changes.

```
┌─────────────┐   http :3030    ┌──────────────────┐   https :8443/api   ┌────────────┐
│   Browser    │ ──────────────▶ │ Web Administrator │ ──────────────────▶ │   Engine    │
│  (this SPA)  │                 │  (Node/Express)   │   reverse proxy     │ (OIE/Mirth) │
└─────────────┘                 └──────────────────┘                     └────────────┘
                                   │  plugins/  (server + browser extensions)
```

## Quick start

```bash
npm install                              # run once at the repo root — installs all workspaces
cd web-administrator
OIE_URL=https://localhost:8443 npm start
# open http://localhost:3030 and sign in with your engine credentials (admin/admin by default)
```

## Configuration

`config.json` in this directory (optional), overridden by environment variables:

| Setting | Env var | Default | Description |
|---|---|---|---|
| `port` | `WEBADMIN_PORT` | `3030` | Port the web UI listens on |
| `host` | `WEBADMIN_HOST` | `0.0.0.0` | Bind address |
| `engine.url` | `OIE_URL` | `https://localhost:8443` | Engine base URL |
| `engine.verifyTls` | `OIE_VERIFY_TLS` | `false` | Verify the engine's TLS cert (engines ship self-signed) |
| `pluginDir` | `WEBADMIN_PLUGIN_DIR` | `./custom-plugins` | Where **Install Extension** writes a plugin's web half (gitignored). The bundled first-party plugins in `./plugins` are always loaded regardless — that path is hardcoded, not configurable. Set this only to relocate installs. |
| `pluginDirs` | `WEBADMIN_PLUGIN_DIRS` | `[]` | Additional **read-only discovery** directories (e.g. the engine's `extensions/`); scanned for plugins to load but never written to by installs. `:`-separated in the env var |
| `engineHome` | `OIE_HOME` | _(unset)_ | Path to the engine install; enables the exact serializer bridge (below) |
| `codeTemplateCompletions` | `WEBADMIN_CODE_TEMPLATE_COMPLETIONS` | `true` | Offer the channel's own code-template functions as script-editor completions; disable to avoid fetching very large catalogs |

Example `config.json`:

```json
{
    "port": 3030,
    "engine": { "url": "https://oie.example.org:8443", "verifyTls": true }
}
```

> Authentication is the engine's own: the login form posts to
> `/api/users/_login` and the engine's `JSESSIONID` cookie carries the session.
> The Node server stores no credentials; it is a streaming reverse proxy.
> For production, terminate TLS in front of this app (the session cookie should
> not cross the network in clear text).

## Look & feel

The UI follows the classic Administrator layout: stacked task panes on the
left (Engine navigation, contextual "<View> Tasks", Other), channel-group tree
tables with a bottom filter bar, dashboard tabs (Server Log, Connection Log,
Global Maps), and a connection status bar along the bottom. **Light mode**
(default) matches the classic blue-and-white Administrator; **dark mode** is a
steel-blue equivalent — toggle via the sun/moon button in the title bar.

## What's implemented 

- **Dashboard** — live channel/connector statuses and statistics, start/stop/
  pause/resume/halt, undeploy, remove all messages, clear statistics,
  expandable connector rows, plugin dashboard tabs (Server Log included).
- **Channels** — list with tags/groups, create, import/export (XML and JSON),
  clone, delete, enable/disable, deploy.
- **Channel editor** — Summary (storage mode, pruning, attachments, custom
  metadata columns), Source/Destinations with property panels for every bundled
  connector (Channel, TCP, HTTP, File, Database, JavaScript, JMS, Web Service,
  DICOM readers/writers plus SMTP and Document Writer), destination ordering and
  queue settings, channel Scripts.
- **Filter / Transformer / Response editors** — JavaScript, Mapper, Message
  Builder, XSLT, Destination Set Filter, External Script, and Iterator steps;
  JavaScript, Rule Builder, External Script, and Iterator filter rules;
  inbound/outbound data types and templates.
- **Script editors** — Monaco-based JavaScript tuned for Rhino: User API
  (`userutil`) IntelliSense, in-scope code-template function completions,
  reserved-variable highlighting, and engine-backed validation + Format Document
  (through the serializer bridge below). Monaco is bundled and served locally, so
  it works fully air-gapped (no CDN); it falls back to a plain editor only if it
  ever fails to load.
- **Message browser** — search (date, status, text, connector), pagination,
  full content tabs (raw → response), errors, mappings, attachments,
  send/reprocess/remove/export.
- **Events**, **Alerts** (triggers, channels, actions), **Users** (incl.
  password rules), **Settings** (server/SMTP, configuration map, tags,
  database tasks, resources, data pruner), **Code Templates** (libraries +
  editor), **Global Scripts**, **Extensions** (engine connectors/plugins and
  web admin plugins).

Unknown connector types and transformer steps (e.g. from commercial engine
extensions) fall back to a JSON property editor, so nothing is a dead end.

## Engine API notes 

- Requests send `Accept: application/json` and `X-Requested-With` (the engine's
  CSRF guard). The engine's XStream serializer wraps every payload in a single
  root key and renders one-element lists as bare objects — `core/api.js`
  normalizes both, with an XML fallback parser.
- Writes must **round-trip**: GET the object, mutate fields, PUT the same
  object back. `@class`/`@version` keys and unknown fields (from server-side
  plugins) must survive. All built-in views follow this rule.

## Message tree serialization 

The transformer/filter **Message Trees** turn a template into a draggable tree
of accessors (`msg['PID']['PID.5']['PID.5.1']`). To match the engine exactly —
including **strict** HL7 (HAPI) and every data type — set `OIE_HOME` to the
engine install directory. The Node server then runs a warm Java sidecar
(`server/bridge/Serializer.java`) on the engine's **own** jars (no bundled
HAPI) and serializes templates through the engine's real datatype serializers,
so the tree is byte-identical to the runtime `msg`/`tmp`.

```bash
OIE_HOME=/path/to/oie OIE_URL=https://localhost:8443 npm start
```

Requires a JVM on the web-admin host. Without `OIE_HOME` (or a JVM), the app
falls back to built-in JS parsing — exact for XML/JSON and the non-strict HL7
default, approximate for opt-in strict mode. Drag a tree node into a script
editor to insert its accessor at the drop point.

## Plugins

See [PLUGINS.md](PLUGINS.md) — it includes worked examples for every
extension point. Nearly everything ships as a plugin: each connector
(`plugins/connector-*`), data type (`plugins/datatype-*`), the transformer
steps/rules (`plugins/transformer-steps`), and the attachment viewers
(`plugins/attachment-*`) all load through the same mechanism. Notable standalone
plugins:

- `plugins/server-log` — live engine log tab on the dashboard.
- `plugins/connection-status` — Connection column + Connection Log tab.
- `plugins/global-maps` — Global Maps dashboard tab.
- `plugins/datapruner`, `plugins/directoryresource`, `plugins/httpauth`,
  `plugins/mllpmode` — settings/resource panels and connector-option extensions.

Plugins register through the platform extension points and build against the
`@oie/*` framework packages ([`../packages`](../packages)). For a complete
third-party example that ships engine + Swing + web UI in one extension zip, see
the SQS connector repository.

For **role-based access control** — a plugin hiding nav items, task buttons, and
right-click menu items per the user's permissions (the Swing `AuthorizationController`
hook) — see [RBAC.md](RBAC.md), which lists every permission identifier.

## Development

The frontend is ES modules under `client/`. In development, `npm run dev` (from
this directory) runs the Node server with file-watch plus Vite's dev middleware,
serving and transforming source on the fly — no manual build while developing.
For production, `npm run build` emits an optimized `client/dist` that `npm
start` serves when present (otherwise it serves the source directly).

Plugins build against the `@oie/*` packages; `npm run lint` at the repo root
enforces that they use only the public API (and flags unused code). The visual
design system lives in `client/css/app.css`: **Tailwind CSS v4** utilities are
generated from the design-token CSS variables (so light/dark theming is
automatic, no `dark:` variants), alongside the app's component classes (`.btn`,
`.panel`, `.dt`, `.tag`, …). See [PLUGINS.md](PLUGINS.md) for plugin styling.

Tests: `npm test` here runs the `client/core/*.test.js` unit tests; the
Playwright end-to-end suite and the `@oie/*` type checks run from the repo root
(`npm run e2e`, `npm run typecheck`) — see the [root README](../README.md).
