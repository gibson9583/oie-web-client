# OIE Web Administrator

A web-based administrator for **Open Integration Engine** — a browser
replacement for the Swing Administrator client. It can run as its own NodeJS
app or as a WAR inside an existing OIE server, talks to the engine over the REST
API, and is **pluggable**: third-party
developers extend it by dropping a folder into `plugins/` (the web equivalent of
the engine's `plugin.xml` extension model).

Both administrators can be used side by side against the same engine — this app
is read/write through the same `/api` surface the Swing client uses. The
Web Support extension is optional for the base administrator and adds message
trees, engine-side script validation, engine-served plugin UIs, and an embedded
WAR.

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
OIE_URL=https://localhost:8443 npm run dev
# open http://localhost:3030 and sign in with your engine credentials
```

For a production-style local run, use `npm run build` and then `npm start` from
this directory. `npm start` requires the generated `client/dist`; raw `.tsx` and
Tailwind source cannot be served directly without Vite.

## OIE-hosted WAR

Download `websupport-<version>.zip` from the
[Web Support releases](https://github.com/gibson9583/oie-web-support-plugin/releases),
install it through the Swing Administrator, and restart OIE. It installs both the
additional APIs and its embedded WAR.

For a separate WAR, run `npm run build:war` from the repository root. Copy the resulting
`web-administrator/dist/oie-webadmin.war` to `<OIE_HOME>/webapps/`, restart OIE, and open
`https://<host>:8443/oie-webadmin/`. The WAR filename controls the URL context
and may be changed. WAR mode always uses its hosting OIE engine; use the Node or
Docker deployment for multi-engine routing, local plugin directories,
or independent TLS/listener configuration.

## Configuration

Configuration comes from one JSON document, then per-setting environment
variables override it. The document source, in precedence order, is
`WEBADMIN_CONFIG_JSON` (inline JSON), the file named by `WEBADMIN_CONFIG`, or the
optional `config.json` in this directory. An explicitly selected document that
is missing or invalid stops startup instead of silently using defaults.

| Setting | Env var | Default | Description |
|---|---|---|---|
| `port` | `WEBADMIN_PORT` | `3030` | Port the web UI listens on |
| `host` | `WEBADMIN_HOST` | `0.0.0.0` | Bind address |
| `engine.url` | `OIE_URL` | `https://127.0.0.1:8443` | Engine base URL |
| `engine.verifyTls` | `OIE_VERIFY_TLS` | `false` | Verify the engine's TLS cert (engines ship self-signed) |
| `allowedUrls` | — | `[]` | Multi-engine mode: `[{ "name", "url", "verifyTls"? }, …]` becomes an engine picker on the login screen. Empty → single-engine mode |
| `devMode` | `WEBADMIN_DEV_MODE` | `false` | Adds a free-form engine URL field at login (the proxy forwards to whatever is typed — trusted/dev deployments only) |
| `pluginDirs` | `WEBADMIN_PLUGIN_DIRS` | `[]` | Additional **local** plugin directories scanned alongside the bundled `./plugins` (e.g. for local development). The env var uses the platform path-list delimiter (`:` on Unix, `;` on Windows). Extensions installed on the engine are served by the engine, not stored here. |
| `trustedProxies` | `WEBADMIN_TRUSTED_PROXIES` | `[]` | Peer IPs trusted to set `X-Forwarded-For` (a front TLS terminator / reverse proxy); loopback is always trusted. Comma-separated in the env var |
| `codeTemplateCompletions` | `WEBADMIN_CODE_TEMPLATE_COMPLETIONS` | `true` | Offer the channel's own code-template functions as script-editor completions; disable to avoid fetching very large catalogs |
| `tls` | `WEBADMIN_TLS_KEY` / `WEBADMIN_TLS_CERT` / `WEBADMIN_TLS_PASSPHRASE` | `null` | Serve the web UI itself over HTTPS: `{ "key", "cert", "passphrase"? }` (PEM paths). Leave `null` to serve HTTP and terminate TLS in front |

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
Settings → Administrator also stores per-user table density, UI font, and data
font preferences. The preview shows pending theme, density, typeface, and
environment-color changes before Save.

## What's implemented 

- **Dashboard** — live channel/connector statuses and statistics, start/stop/
  pause/resume/halt, undeploy, remove all messages, clear statistics,
  expandable connector rows, plugin dashboard tabs (Server Log included). Two
  interchangeable looks under one nav item: the classic status **table** and a
  modern **card view** (group by channel-group/tag/state, Current vs. Lifetime
  stats, multi-select with a shared task rail + right-click actions, virtualized
  for large channel counts). Switch with the "Card view" / "Table view" task;
  the choice is remembered per browser.
- **Channels** — list with tags/groups, create, import/export (XML and JSON),
  clone, delete, enable/disable, deploy.
- **Channel editor** — Summary (storage mode, pruning, attachments, custom
  metadata columns), Source/Destinations with property panels for every bundled
  connector (Channel, TCP, HTTP, File, Database, JavaScript, JMS, Web Service,
  DICOM readers/writers plus SMTP and Document Writer), destination ordering and
  queue settings, channel Scripts.
- **Guided builders (wizards)** — step-by-step **alternates** to the classic
  channel and alert editors: a chevron stepper (Basics → … → Review), validate-
  as-you-advance, and the same prompt-to-save-on-leave as the classic editors.
  New Channel / New Alert show a chooser (Classic editor vs. Wizard, with a
  rememberable default); either builder can hand its unsaved work to the other
  via the "Classic editor" / "Open in Wizard" task. Full feature parity with the
  classic editors (dependencies, channel options, embedded filter/transformer).
- **Filter / Transformer / Response editors** — JavaScript, Mapper, Message
  Builder, XSLT, Destination Set Filter, External Script, and Iterator steps;
  JavaScript, Rule Builder, External Script, and Iterator filter rules;
  inbound/outbound data types and templates.
- **Script editors** — Monaco-based JavaScript tuned for Rhino: User API
  (`userutil`) IntelliSense, in-scope code-template function completions,
  reserved-variable highlighting, engine-backed validation, and a client-side
  Format Document command (see below). Monaco is bundled and served locally, so
  it works fully air-gapped (no CDN); it falls back to a plain editor only if it
  ever fails to load.
- **Message browser** — search (date, status, text, connector), pagination,
  full content tabs (raw → response), errors, mappings, attachments,
  send/reprocess/remove/export.
- **Compare content** — pick any stored content (message × connector × stage)
  as an anchor, pick a second, and read them side by side in the diff viewer:
  across messages, across a message's destinations, or between two stages of
  one message to see what the pipeline changed. Content is fetched fresh each
  time it is shown and is never written to disk by this feature — no local
  storage, no cache, no message identity in the URL — and it is released when
  the comparison closes, you navigate away, or the session ends (sign-out, idle
  auto-logout, or an expired session).
- **Events**, **Alerts** (triggers, channels, actions; classic editor or guided
  wizard), **Users** (incl.
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
including **strict** HL7 (HAPI) and every data type — the web admin asks the
**connected engine** to serialize the template through its own datatype
serializers (`/datatypes/_serialize`), so the tree is byte-identical to the
runtime `msg`/`tmp`. JavaScript validation works the same way
(`/javascript/_validate`, the engine's own Rhino compiler); Format Document
runs entirely client-side (js-beautify, E4X-safe). There is no local JVM or
engine install to configure — serialization follows whichever engine the
session is connected to. Drag a tree node into a script editor to insert its
accessor at the drop point.

> These endpoints are probed per session: engine-native first, then the
> [Web Support plugin](https://github.com/gibson9583/oie-web-support-plugin)
> (`/api/extensions/websupport/...`), which provides them on a stock engine
> with no engine changes. With neither, message trees, server-side validation,
> and engine-served plugin UIs are disabled with a notice.

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
For production, `npm run build` emits the optimized `client/dist` required by
`npm start`.

Plugins build against the `@oie/*` packages; `npm run lint` at the repo root
enforces that they use only the public API (and flags unused code). The visual
design system lives in `client/css/app.css`: **Tailwind CSS v4** utilities are
generated from the design-token CSS variables (so light/dark theming is
automatic, no `dark:` variants), alongside the app's component classes (`.btn`,
`.panel`, `.dt`, `.tag`, …). See [PLUGINS.md](PLUGINS.md) for plugin styling.

Third-party libraries are loaded one of three ways. Big client libs that plugins
also need are **vendored** to `client/vendor/*` and exposed through the page
import map (`monaco-editor` for the code editor, `js-beautify` for Format
Document, `qrcode-generator`, `@zip.js/zip.js`). App-bundle React deps are
bundled by Vite: `react`, `react-dom`, the `@radix-ui/*` primitives the
shell and views are built on (tabs, dialog, dropdown-menu, popover, collapsible,
radio-group, toast), and `react-day-picker` behind the date/time field
(`client/react/date-time-field.tsx`, which compiles into its own lazy chunk). A plugin's
own npm dependencies are bundled into its `web/plugin.js` by esbuild — e.g. the
DICOM attachment viewer bundles [`dicom-parser`](https://github.com/cornerstonejs/dicomParser)
(MIT) for parsing; pixel data is decoded with the browser's native codecs and
rendered to a `<canvas>`.

Tests: `npm test` here runs the `client/core/*.test.js` unit tests; the
Playwright end-to-end suite and the `@oie/*` type checks run from the repo root
(`npm run e2e`, `npm run typecheck`) — see the [root README](../README.md).
