# Web Administrator Plugin Development

The web administrator mirrors the engine's extension philosophy: the Swing
client loads `ClientPlugin` classes declared in `plugin.xml`; the web
administrator loads JavaScript modules declared in `plugin.json`. Built-in
views register through the **same registries** plugins use, so a plugin can do
anything a core view can.

> **Plugins are React.** Every plugin's UI is authored in React against the
> host's own React instance (`platform.React`), and registries hold a
> **`component`** (a React component). See
> [Writing plugins in React](#writing-plugins-in-react) for the contract.

## Adding a web UI: three starting points

**A — You already have an engine extension (Java + Swing).** The common case,
and the cheapest. Your plugin's server side already exists as an engine
extension with REST servlets (and a Swing `ClientPlugin` panel). To bring it to
the web administrator you write **only the web UI half** — a React connector
panel, settings tab, or view that calls your *existing* engine endpoints at
`/api/extensions/<path>`. No new server code, no second copy of your logic. The
web UI can **replace** the Swing panel or **run side by side** with it (the
engine doesn't care which administrator a user opens), so you can ship the web
UI incrementally while the Swing client keeps working. The bundled `server-log`,
`datapruner`, `httpauth`, and `mllpmode` plugins — and the third-party SQS
connector and TLS Manager plugins — are all this shape. See
[Pairing with engine-side extensions](#pairing-with-engine-side-extensions) and
[Adding UI for custom engine connectors](#adding-ui-for-custom-engine-connectors).

**B — A brand-new plugin with an engine (Java) backend.** Build the engine
extension from scratch — the connector, servlet, or service that runs **in the
engine** — and pair it with a UI. The UI can be **web** (a React plugin like the
ones here), **Swing** (a classic `ClientPlugin`), or **both** at once: they're
independent clients of the same engine extension, so you can ship one and add
the other later. This is the classic full-plugin shape; everything in **A**
applies the moment the engine half exists. Ship the engine half as a normal
engine extension and the web half as a web admin plugin with the same name —
optionally [bundling the web UI inside the engine extension zip](#shipping-the-web-ui-inside-the-engine-extension)
so a single install delivers both.

**C — Pure web plugin, no Java (`server.js`).** *New.* A plugin can now ship its
own **Node/Express backend** (`server.js`, mounted at `/plugin-api/<id>`) right
inside the web administrator. That means a plugin needing server-side logic no
longer requires an engine (Java) extension at all: a React frontend **plus** a
`server.js` backend is a fully self-contained, **pure-JavaScript plugin** —
something that wasn't possible before, when *any* server-side behaviour meant
authoring and deploying a Java engine extension. Use it for web-only tooling,
talking to other backends, or anything that doesn't belong in the engine. See
[Server side](#server-side).

Most plugins are **A** or **B** (logic that belongs in the engine, reachable by
either administrator). Reach for **C** only when you genuinely need server code
that has no place in the engine.

## Anatomy of a plugin

```
plugins/
└── my-plugin/
    ├── plugin.json          # manifest (required)
    ├── server.js            # optional Node/Express extension
    └── web/
        ├── plugin.jsx       # browser entry — React SOURCE you author
        ├── plugin.js        # COMPILED output (the served entry; what plugin.json points to)
        └── ...              # any other assets, served at /plugins/my-plugin/...
```

You author **`plugin.jsx`**; a build step compiles it to **`plugin.js`** (the
served entry). The browser can't run JSX — it loads the compiled `.js`, which is
served raw and dynamically `import()`-ed at runtime (so it shares the one running
framework instance instead of bundling its own). See
[Building the browser entry](#building-the-browser-entry).

`plugin.json`:

```json
{
    "id": "my-plugin",
    "name": "My Plugin",
    "version": "1.0.0",
    "author": "You",
    "description": "What it does",
    "enabled": true,
    "client": { "entry": "web/plugin.js" },
    "server": { "entry": "server.js" }
}
```

Drop the folder into `plugins/` (or any configured `pluginDirs` entry) — with a
built `web/plugin.js` present (see [Building the browser entry](#building-the-browser-entry)) —
and **refresh the browser**. Plugin directories are re-scanned on every load, so
no web administrator restart is needed; the running tab only picks up the change
on refresh (it loads plugins once at boot). The exception is a plugin's optional
`server.js`: new ones mount on first discovery, but *updating* an already-loaded
server entry requires a restart (Node module cache). Load status appears under
**Extensions → Web Administrator Plugins**.

> ⚠️ **Install only trusted plugins.** A plugin runs code in the browser, and an
> optional `server.js` runs code in the web administrator's Node process
> (mounted at `/plugin-api/<id>`, with this server's filesystem and config in
> reach). Treat installing a plugin as running its code — install only from
> sources you trust. This is the same trust model as the Swing client's
> `plugin.xml`/`*Classes` extensions, which load Java into the client/server.
> Note that `pluginDirs` may point at the engine's `extensions/` tree, so an
> installed engine extension carrying a `webadmin/` folder is loaded too.

## How the engine's own extensions are packaged (same as yours)

Every extension in an engine install — including all the "built-in" ones
(`datapruner`, `serverlog`, `dashboardstatus`, the `datatype-*` set, `mllpmode`,
and the connectors themselves) — uses the identical packaging: a folder under
`extensions/` containing `plugin.xml` (and/or `source.xml`/`destination.xml`)
plus its `*-client.jar`/`*-server.jar`/`*-shared.jar` libraries, declaring
`<serverClasses>`, `<clientClasses>`, `<library>` entries (CLIENT/SERVER/SHARED
jars) and optional `apiProvider` REST servlets. In the engine
source they are ordinary packages under `server/src/com/mirth/connect/plugins/`
and `.../connectors/`. Third-party extensions are first-class citizens of the
same mechanism — the SQS connector repo is representative of how the bundled
ones are built.

## Swing extension points → web admin equivalents

| Swing plugin class | Bundled engine example | Web admin equivalent |
|---|---|---|
| `ClientPlugin` (full view + tasks) | Global Map Viewer | `registerNavItem` + `registerView` |
| `DashboardTabPlugin` | `serverlog` (Server Log), `dashboardstatus` (Connection Log) | `registerDashboardTab` — see `plugins/server-log`, `plugins/connection-status` |
| `DashboardColumnPlugin` | `dashboardstatus` (Connection column) | `registerDashboardColumn` — see `plugins/connection-status` |
| `SettingsPanelPlugin` | `datapruner` (Data Pruner tab) | ships as the `datapruner` web plugin calling `registerSettingsPanel` |
| `ChannelTabPlugin` | (commercial, e.g. history tabs) | `registerChannelTab` |
| `TransformerStepPlugin` / `FilterRulePlugin` | mapper, messagebuilder, javascriptstep, xsltstep, destinationsetfilter, scriptfilestep, iterator; rulebuilder, javascriptrule, scriptfilerule | bundled as the `transformer-steps` web plugin calling `registerStepType` / `registerRuleType` |
| `AttachmentViewer` | `imageviewer`, `pdfviewer`, `dicomviewer`, `textviewer` | each ships as a web plugin (`plugins/attachment-*`) calling `registerAttachmentViewer`; the message browser picks the first whose `canHandle(attachment)` matches |
| `ConnectorSettingsPanel` | every connector (tcp, http, file, …) | each ships as a web plugin (`plugins/connector-*`) calling `registerConnectorPanel`; panels live in the shared connector library (`client/connectors/*.js` + `forms.js`). See `plugins/sqs-connector` in the SQS repo for a third-party one |
| `ConnectorPropertiesPlugin` | `httpauth` (HTTP Authentication), SSL managers | `httpauth` ships as a web plugin (`plugins/httpauth`) calling `registerConnectorPropertiesPanel`; renders as the "Authentication" panel on HTTP Listener sources |
| `DataTypeClientPlugin` | `datatypes/*` (HL7 v2, XML, …) | each ships as a web plugin (`plugins/datatype-*`) calling `registerDataType`; `client/datatypes/index.js` is just the registry read-side (`dataTypeDef` / `dataTypeList`), and `props-editor.jsx` renders any registered type |
| `TransmissionModePlugin` | `mllpmode` (MLLP framing) | `registerTransmissionMode` — Basic is built in; `mllpmode` ships as a plugin. TCP's Transmission Mode dropdown + ⚙ settings dialog + Sample Frame are driven by the registry |
| `ResourceClientPlugin` | `directoryresource` (Directory resource type) | `registerResourceType` — the Settings → Resources panel is generic; `directoryresource` ships as a plugin providing the Directory type editor |
| `ChannelColumnPlugin` / `ChannelPanelPlugin` / `ChannelWizardPlugin` / `TaskPlugin` / `MultiFactorAuthenticationClientPlugin` | various | not yet — ask if you need one |

### Bundled web plugins

Like the Swing client, the web administrator does **not** privilege its built-in
features — they ship as plugins under `plugins/`, loaded through the same
mechanism a third-party plugin uses. The core client is a thin shell plus the
shared frameworks they build on (the connector toolkit `client/connectors/forms.js`,
the data-type properties renderer `client/datatypes/props-editor.jsx`, the form
builder, etc.). Current set:

- **Connectors** (`connector-*`): vm, tcp, http, file, database, javascript, smtp, ws, dicom, jms, document
- **Data types** (`datatype-*`): hl7v2, hl7v3, xml, json, raw, delimited, edi, ncpdp, dicom
- **Transformer steps & filter rules** (`transformer-steps`): mapper, messagebuilder, javascriptstep, xsltstep, destinationsetfilter, scriptfilestep, iterator; rulebuilder, javascriptrule, scriptfilerule
- **Dashboard tabs/columns**: `server-log`, `global-maps`, `connection-status`
- **Attachment viewers** (`attachment-*`): imageviewer, pdfviewer, textviewer, dicomviewer
- **Settings panel**: `datapruner`
- **Connector properties**: `httpauth`, `tls-manager`
- **Transmission mode**: `mllpmode` (Basic is built in)
- **Resource type**: `directoryresource`

The shared frameworks stay in `client/` and are imported by bundled plugins via
absolute URL (e.g. `/connectors/forms.js`, `/core/ui.js`) — the web equivalent
of a Swing extension depending on `mirth-client-core`.

Server-side plugin classes (`ServicePlugin`, `ChannelPlugin`,
`DataTypeServerPlugin`, `AuthorizationPlugin`, `ResourcePlugin`, …) run inside
the engine regardless of which administrator you use; when they expose REST
servlets (`apiProvider`), the web admin reaches them at
`/api/extensions/<path>` exactly like the bundled Server Log plugin does.

## Building against the `@oie/*` packages

A plugin reaches the web-admin framework through three published packages:

| Package | What it is | Swing analogue |
|---|---|---|
| [`@oie/web-api`](../../packages/web-api) | Engine REST client + model helpers (`api`, `asList`, `uuid`) | `mirth-client-core` server API |
| [`@oie/web-ui`](../../packages/web-ui) | DOM toolkit, `DataTable`, dialogs, forms, code editor, columns | the Swing widget toolkit |
| [`@oie/web-shell`](../../packages/web-shell) | The `platform` extension points you register through | `ClientPlugin` SPI |

```jsx
import { platform } from '@oie/web-shell';
const React = platform.React;          // share the host's React (see "Writing plugins in React")

function MyView() {
    return <div className="view"><h1>Hello from a plugin</h1></div>;
}

export function register() {
    platform.registerNavItem({ id: 'my-plugin', label: 'My Plugin', icon: 'plug',
        path: '/my-plugin', section: 'Engine', order: 99 });
    // reactView() wraps a component as a routed-view handler.
    platform.registerView('/my-plugin', platform.reactView(MyView), { title: 'My Plugin' });
}
```

### Two import styles, one runtime instance

There are two ways to pull in the framework, and **both resolve to the same
single shell instance at runtime**:

- **`@oie/*` bare specifiers** — for plugins developed as their own repo/package.
  You get `npm install`, type inference, lint, and bundler support. At runtime
  the page's **import map** rewrites `@oie/web-ui` → `/core/pkg-ui.js` (the
  shell's already-loaded copy).
- **Absolute URLs** (`/core/ui.js`, `/connectors/forms.js`) — the original style,
  resolving against `client/` as the web root. Still fully supported for the
  framework imports.

Either way the plugin's JSX is compiled to `web/plugin.js` first (React comes
from `platform.React`, not an import) — see
[Building the browser entry](#building-the-browser-entry).

The single-instance rule is what makes registrations stick: your
`platform.registerView(...)` must mutate the **shell's** registry. That's why you
must **never deep-import** (`@oie/web-ui/dist/...`) or bundle a second copy of the
framework into your plugin — a duplicate registers into a dead registry and
silently does nothing. The `@oie/eslint-config` rule below flags the static
imports that would do this.

### Lint config

Add [`@oie/eslint-config`](../../packages/eslint-config) so the build fails when a
plugin's **static imports** reach past the public API into shell internals
(`client/core`, `client/connectors`, `client/views`, the `/core/*` absolute-URL
form) or a package's deep paths. It's a lint-time guard over `import` statements —
it can't catch a dynamic `import()` of a computed path, so still treat `@oie/*` as
the only entry by convention:

```js
// eslint.config.js
import oie from '@oie/eslint-config';
export default oie;
```

It also enables `no-undef` / `no-unused-vars` — the class of mistake `node --check`
misses in ES modules (e.g. an unbalanced paren).

## Browser side

`web/plugin.js` is dynamically imported and must export:

```js
export function register(platform) { ... }
```

> The `platform` argument and the `@oie/web-shell` `platform` export are the same
> object — use whichever reads better. `@oie/*` imports additionally give you
> `api`/`h`/etc. directly, equivalent to `platform.api` / `platform.ui.h`.

### Writing plugins in React

Plugin UI is **React**, sharing the host app's single React instance. The rule:

```jsx
import { platform } from '@oie/web-shell';
const React = platform.React;          // the host's React — NOT an `import 'react'`
```

- **Get React from `platform.React`**, at module scope, before any JSX. Do **not**
  `import React from 'react'` or bundle your own copy — a second React instance
  breaks hooks/context and registers into a dead tree. (`platform.React` is set by
  the shell at boot, before any plugin loads.) Once `React` is in scope you write
  ordinary JSX and use `React.useState`/`useEffect`/`useRef`/etc.
- **Registries hold a `component`.** Each extension point below takes a React
  component (or, for per-row dashboard columns, `cell` functions that *return*
  JSX). The host renders it in-tree — you never touch a DOM node or `appendChild`.
- **The descriptor is mostly plain data.** `component(ctx)` is a React function
  component that receives `ctx` as **props** and **returns JSX**; everything else
  on the descriptor (`defaults`, `create`, `canHandle`, `isSupported`,
  `propertiesClass`, transmission `apply`/`sampleFrame`) is plain data/logic.
  Imperative helpers are fine to *call* from handlers —
  `platform.ui.modal/confirmDialog/toast`, `platform.api.*`.
- **Styling.** Use **Tailwind v4 utilities** (`bg-bg2`, `text-text-dim`,
  `text-accent`, `border-line`, `flex`, `gap-2`, `mt-[14px]`, …) — generated from
  the design-token CSS variables, so light/dark theming is automatic, no `dark:`
  variants — plus the app's **component classes** (`.btn`/`.btn-primary`,
  `.panel`/`.panel-header`/`.panel-body`, `.dt`, `.field`, `.tag`, `.pip`,
  `.modal`, `.toast`, `.view`, `.mono`, `.hint`, …). For a horizontal radio group
  use `.radio-group.inline-row`.
  > **Separately-built plugins** (compiled in their own repo) can use the
  > component classes and the *common* utilities the host already emits, but the
  > host's Tailwind build only generates utilities it sees in **host** source —
  > so for arbitrary/uncommon ones (e.g. `w-[420px]`) use inline `style` or ship
  > your own Tailwind-generated CSS (scan your source, map the design tokens via
  > `@theme inline`). In-tree plugins (`plugins/**`) are scanned by the host
  > build, so any utility works.

The bundled plugins are the reference implementations — read
`plugins/connection-status/web/plugin.jsx` (a dashboard tab component + column
`cell`/`connectorCell`) and `plugins/global-maps/web/plugin.jsx` (a polled tab
with a JSX table + modal).

### Building the browser entry

The browser loads `web/plugin.js`; you author `web/plugin.jsx`. Compile JSX to
`React.createElement` with React taken from `platform.React` (so it stays out of
your bundle), keeping `@oie/*` external:

- **First-party** plugins (in this repo's `plugins/`) are built automatically by
  `npm run build` (which runs `tools/build-plugins.mjs`, esbuild). Just write the
  `.jsx`; the `.js` is generated.
- **Third-party** plugins ship a **pre-built `web/plugin.js`** in their zip (the
  repo's builder only scans its own `plugins/`). Compile with esbuild (or any
  bundler) using the same settings:

  ```js
  // build.mjs
  import { build } from 'esbuild';
  await build({
      entryPoints: ['web/plugin.jsx'],
      outfile: 'web/plugin.js',
      bundle: true, format: 'esm', target: 'es2022',
      jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment',
      external: ['@oie/web-api', '@oie/web-ui', '@oie/web-shell'],
  });
  ```

### Extension points (Swing equivalents in parentheses)

```jsx
import { platform } from '@oie/web-shell';
const React = platform.React;

// Full routed view + rail navigation (ClientPlugin)
platform.registerNavItem({ id, label, icon, path, section, order });
platform.registerView('/my-path/:param?',
    platform.reactView(({ params, query }) => <div className="view">…</div>),
    { title: 'My View' });

// Dashboard tab below the status table (DashboardTabPlugin)
platform.registerDashboardTab({ id, label, order,
    component: ({ selection }) => <div className="dt-wrap">…</div> });

// Extra dashboard column (DashboardColumnPlugin) — cell/connectorCell RETURN JSX
// (per-row, so not a single component).
platform.registerDashboardColumn({ id, label, order,
    cell: (status) => <span>…</span>,            // channel row
    connectorCell: (child) => <span>…</span> });  // connector child row

// Tab inside the channel editor (ChannelTabPlugin)
platform.registerChannelTab({ id, label, order,
    component: ({ channel, onChange }) => <div>…</div> });

// Tab in Settings (SettingsPanelPlugin). The component declares its task pane by
// calling ctx.setTasks(title, items) (from an effect) — same callback as before.
platform.registerSettingsPanel({ id, label, order,
    component: ({ platform, setTasks }) => <div className="view">…</div> });

// Message attachment renderer (AttachmentViewer)
platform.registerAttachmentViewer({ id,
    canHandle(attachment) { return attachment.type === 'application/dicom'; },
    component: ({ attachment, channelId, messageId }) => <div>…</div> });

// Transformer step / filter rule editors (TransformerStepPlugin / FilterRulePlugin)
platform.registerStepType('com.example.MyStep', {
    label: 'My Step',
    create() { return { __type: 'com.example.MyStep', name: 'New Step', enabled: true }; },
    // ctx: { element, platform, onChange }. Mutate `element` in place, then onChange().
    component: ({ element, platform, onChange }) => <div>…</div> });
platform.registerRuleType('com.example.MyRule', { /* same contract */ });

// Connector property panel (ConnectorSettingsPanel) — e.g. for a custom connector.
// `component` gets { properties, connector, channel, onChange }; mutate `properties`
// in place + call onChange(). Build the form with <ConnectorForm fields={…}/> (and
// <PollSection/> for poll sources) from @oie/web-ui — see the SQS worked example.
platform.registerConnectorPanel('My Listener', 'SOURCE', {
    defaults(version) { return { '@class': 'com.example.MyReceiverProperties', '@version': version /* … */ }; },
    component: ({ properties, connector, channel, onChange }) => <div>…</div> });

// Custom data type registration. Data types are DATA-ONLY: a schema of groups +
// fields + defaults(version). The shared central editor (client/datatypes/
// props-editor.jsx) renders any registered type from this data — a data type does
// NOT supply its own component.
platform.registerDataType('MYTYPE', { name: 'MYTYPE', label: 'My Type', order: 99,
    propertiesClass: 'com.example.MyDataTypeProperties',
    groups: [{ key: 'serialization', label: 'Serialization', class: 'com.example…',
        fields: [{ key: 'stripNamespaces', label: 'Strip Namespaces', type: 'checkbox', default: true }] }],
    defaults(version) { /* the engine properties object */ return { /* … */ }; } });

// Extra settings section on existing connectors (ConnectorPropertiesPlugin) —
// the pattern used by SSL-style plugins that extend HTTP/TCP connectors.
// Every connector carries connector.properties.pluginProperties, a set of
// plugin-contributed objects JSON-keyed by their Java class name; this panel
// edits exactly one of those entries and appears on whichever connectors
// isSupported() approves (alongside, not replacing, the main panel).
platform.registerConnectorPropertiesPanel({
    id: 'my-ssl',
    title: 'SSL Settings',
    propertiesClass: 'com.example.ssl.SSLConnectorPluginProperties',
    isSupported: (transportName, mode) =>
        ['HTTP Sender', 'TCP Sender', 'TCP Listener', 'HTTP Listener'].includes(transportName),
    defaults: (version) => ({ '@version': version, enabled: false, protocols: null /* …every Java field… */ }),
    component: ({ getEntry, setEntry, connector, channel, onChange }) => {
        // getEntry() → current entry or null; setEntry(obj|null) creates/removes
        // it while preserving sibling plugin entries (e.g. HTTP auth).
        return <div>…</div>;
    }
});

// Transmission mode for framed connectors like TCP (TransmissionModePlugin).
// A transmission mode has NO React component — its whole surface is the three
// callbacks: apply()/sampleFrame() are pure (the connector reads them), and the
// ⚙ settings dialog stays an imperative modal (open it via platform.ui.modal).
// Each mode edits connector.properties.transmissionModeProperties.
platform.registerTransmissionMode('MLLP', {
    label: 'MLLP', order: 10,
    apply(tm) { tm.pluginPointName = 'MLLP'; tm.startOfMessageBytes = '0B'; tm.endOfMessageBytes = '1C0D'; },
    sampleFrame(tm) { return '<VT> Message Data <FS><CR>'; },   // preview text
    openSettings(tm, onChange) { /* platform.ui.modal editing the mode's properties */ }
});

// Resource type for Settings → Resources (ResourceClientPlugin). The Resources
// panel is generic; each type supplies its factory + detail editor component.
platform.registerResourceType('Directory', {
    label: 'Directory',
    propertiesClass: 'com.mirth.connect.plugins.directoryresource.DirectoryResourceProperties',
    detailHeader: 'Directory Settings',
    create({ version, containerIsArray }) { return { /* new resource object */ }; },
    component: ({ entry, locked, platform, refreshTable }) => <div>…</div>   // detail editor
});
```

### Platform services

| API | Purpose |
|---|---|
| `platform.React` | The host's React instance — `const React = platform.React` at module scope, then write JSX. Sharing it is mandatory (one instance app-wide); never `import 'react'`. |
| `platform.reactView(Component)` | Wraps a React component as a routed-view handler for `registerView(path, platform.reactView(Component), { title })`. The component gets `{ params, query }` props. |
| `platform.api` | Full engine REST client (`api.channels`, `api.messages`, `api.status`, … plus raw `api.get/post/put/del`). All calls share the user's session. |
| `platform.ui` | DOM toolkit: `h()`, `DataTable`, `tabs()`, `modal()`, `confirmDialog`, `promptDialog`, `toast`, `contextMenu`, form helpers, `downloadFile`, `pickFile`, `fmtDate`, `icon(name)`. `fmtDate` renders every timestamp in the user's chosen time zone (the topbar Server/Local/UTC toggle, `core/timezone.js`) — use it for all displayed dates. |
| `platform.columns` | Resizable + reorderable columns for hand-built `table.dt` grids: `createColumnManager(key, defaultWidths)` + `decorateColumns(table, opts)`. See [Resizable / reorderable columns](#resizable--reorderable-columns). |
| `platform.oie` | Model helpers: `elementsToArray`/`arrayToElements` (XStream polymorphic lists), `newChannel`, `statePip`, `uuid`. (Data types are no longer here — they come from the registry via `dataTypeDef`/`dataTypeList` in `/datatypes/index.js`.) |
| `platform.dataTypes()` / `platform.transmissionModes()` / `platform.resourceTypes()` | Read the registered data types / transmission modes / resource types (each populated by a plugin). |
| `platform.createCodeEditor({ value, language, readOnly, minHeight, onChange })` | Code editor component — upgrades to Monaco when reachable (Rhino-tuned: User API IntelliSense, in-scope code-template completions, engine-backed validation + Format Document), else a plain textarea. `platform.setCodeEditorFactory` swaps the implementation app-wide. |
| `platform.router` | `navigate(path)`, `currentPath()` |
| `platform.store` / `platform.events` | Shared state (`getState('user')`, `'serverVersion'`, `'webPlugins'`, `'webadminConfig'`) and pub/sub bus |

### Resizable / reorderable columns

`platform.columns` (core module `core/columns.js`) makes any **imperatively
built** `table.dt` grid's columns drag-to-reorder, drag-to-resize, and
double-click-to-auto-fit, with the order and widths persisted per table in
`localStorage`.

> In a React plugin, render a plain JSX `<table className="dt">` for most tables.
> To add the resizable/reorderable affordances on top, mount the decorator from a
> ref: `const ref = React.useRef(); React.useEffect(() => decorateColumns(ref.current, …), [])`
> and put the `ref` on the `<table>`. (The host's own grids use the React
> `<TreeTable>` component instead — it bakes these affordances in — but that's
> internal and not exposed to plugins.) The imperative recipe below is for the
> absolute-URL / non-React authoring style.

Build your header/body rows in a **fixed canonical column order**, then call
`decorateColumns` after the table is in the DOM — it switches the table to fixed
layout with a `<colgroup>`, permutes each row's cells into the saved order, draws
the affordances, and leaves the **last column auto-width** so it fills the
container.

```js
const colMgr = platform.columns.createColumnManager('my-table', {
    id: 80, name: 240, info: 200          // default widths per data-column key
});

function render() {
    const table = h('table.dt',
        h('thead', h('tr', h('th', 'Id'), h('th', 'Name'), h('th', 'Info'))),
        h('tbody', rows.map(r => h('tr', h('td', r.id), h('td', r.name), h('td', r.info)))));
    host.appendChild(table);
    platform.columns.decorateColumns(table, {
        manager: colMgr,
        presentKeys: ['id', 'name', 'info'],   // canonical order of the data columns
        pinned: 0,                              // # of leading fixed columns (e.g. an expand twisty)
        pinnedWidths: [],                       // widths for those pinned columns
        onChange: render                        // re-render after a reorder
    });
}
```

Notes:
- Every rendered row (header + body) must have the same cell count: `pinned`
  leading cells then one cell per `presentKeys` entry, in canonical order. Rows
  with a different shape (e.g. a `colSpan` empty-state row) are skipped.
- For live-updating tables, rebuild the whole table (thead + tbody) each refresh
  and call `decorateColumns` again — don't decorate a header twice (it would
  double-permute).
- Cells clip (`overflow: hidden` / ellipsis) so a narrowed column never grows the
  row height. Keep flex cell content on a single line (`flex-wrap: nowrap`).

### Rules of the road

1. **Round-trip engine objects.** GET → mutate → PUT the same object. Never
   delete `@class`/`@version` keys or fields you don't understand — they belong
   to the engine model or to server-side plugins.
2. Engine lists may arrive as a bare object when they have one element — use
   `platform.api.asList(value, key)`.
3. Style with Tailwind utilities + the app's component classes (see *Writing
   plugins in React* above) so plugins match both themes — noting the
   separately-built-plugin caveat (only host-emitted utilities are available
   unless the plugin ships its own CSS).

## Server side

`server.js` (CommonJS) lets a plugin add endpoints on the **web administrator's
own Node server** — *no engine (Java) extension required*. This is the piece that
makes a **pure-JavaScript plugin** possible: a React frontend plus a `server.js`
backend, fully self-contained. Before this, any server-side behaviour had to be
written and deployed as a Java engine extension; now a plugin can own its
backend in Node:

```js
module.exports = function register(router, { config, manifest, log }) {
    router.get('/status', (req, res) => res.json({ ok: true }));
};
```

The router mounts at `/plugin-api/<id>/`. Use it for things the browser can't
do directly (filesystem, other backends, secrets). Requests to `/api/...` are
proxied to the engine and carry the browser's engine session; `/plugin-api`
endpoints are **not** authenticated by the engine — add your own checks if you
expose anything sensitive.

> **`server.js` runs arbitrary Node in the web admin process** (it can read this
> host's filesystem and config). Only install plugins from trusted sources — see
> the "Install only trusted plugins" note above. For most needs prefer an engine
> extension's REST servlet (reachable at `/api/extensions/<path>`, the way the
> bundled `server-log` plugin works), which runs in the engine with its auth.

## Adding UI for custom engine connectors

Engine-side plugins can add entirely new connector types (a `source.xml` /
`destination.xml` descriptor plus a shared `ConnectorProperties` class). The
channel editor's Connector Type select lists every type the engine reports
(`GET /extensions/connectors`), but types without a web panel are labeled
"(no web editor)" and cannot be *selected* — the web administrator can't
invent the engine's `@class` properties object. Existing channels that
already use such a type still render through the generic JSON fallback panel.
To make a custom connector fully editable, ship a companion web admin plugin
that registers a connector panel.

> **A connector's web half is only a property panel.** The connector itself
> (e.g. the AWS SQS transport) is an *engine* extension — Java that runs in the
> engine regardless of which administrator you use. The web plugin just renders
> the settings form. That's why its toolkit lives in `@oie/web-ui` (the form
> builder and connector-panel helpers), not in any "connectors" package.

The SQS connector is the worked example. Its panel takes React from
`platform.React` and imports the form helpers from `@oie/web-ui`; the host page's
import map resolves that to the shell's loaded copy at runtime, so **React and the
framework stay out of the plugin's bundle** — only the panel's own JSX is compiled
to `web/plugin.js`, which ships inside the engine extension zip:

```jsx
// sqs-source-connector .../webadmin/web/plugin.jsx (abridged) — compiled to plugin.js
import { platform } from '@oie/web-shell';
import { ConnectorForm, PollSection, defaultPollProperties, defaultSourceProperties } from '@oie/web-ui';
const React = platform.React;

const awsFields = () => [ /* schema-driven field defs: queueUrl, region, authType, … */ ];

const sqsReader = {
    defaults(version) {
        return {
            // FQCN of the engine plugin's shared properties class
            '@class': 'com.mirth.connect.connectors.sqs.SqsReceiverProperties',
            '@version': version,
            pluginProperties: null,
            pollConnectorProperties: defaultPollProperties(version),
            sourceConnectorProperties: defaultSourceProperties(version),
            queueUrl: '', region: '', authType: 'DEFAULT', /* … every Java field … */
        };
    },
    // <ConnectorForm> consumes the same field-schema array the old buildForm did
    // and mutates `properties` in place; <PollSection> renders the poll schedule.
    component: ({ properties, onChange }) => (
        <div>
            <ConnectorForm properties={properties} onChange={onChange}
                fields={[ ...awsFields(), { section: 'Receive Settings' } /* … */ ]} />
            <PollSection properties={properties} onChange={onChange} />
        </div>
    )
};

export function register(platform) {
    platform.registerConnectorPanel('SQS Reader', 'SOURCE', sqsReader);
}
```

> `@oie/web-ui` provides connector-panel building blocks (the
> `default*Properties` shape helpers above, plus form helpers). The bundled
> connector panels under `client/connectors/` are the reference for laying out a
> full connector form in React.

### Shipping the web UI inside the engine extension

Instead of a separate install, an engine extension carries its web admin plugin
in a `webadmin/` folder inside the extension zip (`<extension>/webadmin/plugin.json`
+ assets).

**Install through the UI** (one action, decoupled): **Extensions → Install
Extension** uploads the zip to the *web administrator*, which forwards it to the
engine's installer (the engine enforces `EXTENSIONS_MANAGE`) and, on success,
extracts the `webadmin/` half into its **own `pluginDir`**. **Restart the engine**
(for the engine half), then **refresh the browser** (the web half is hot-scanned
from `pluginDir`). The web admin owns its plugins in `pluginDir` and does **not**
read the engine's filesystem.

The loader checks each search dir for `plugin.json` directly (native layout) or
under `webadmin/` (engine-extension layout); duplicate ids load first-found. To
*also* surface the web halves of extensions installed **directly into an engine**
(not through this UI), add that engine's `extensions/` dir explicitly —
`config.json` `"pluginDirs": ["/path/to/oie/extensions"]` or
`WEBADMIN_PLUGIN_DIRS=/path/to/oie/extensions`. (`engineHome` does **not** add it;
that setting drives only the datatype serializer bridge.)

**Building the webadmin half in Maven.** Since `web/plugin.js` is now a compiled
artifact (from `web/plugin.jsx`), build it before packaging. Either commit the
built `web/plugin.js` (your `maven-resources` copy picks it up), or wire
`frontend-maven-plugin` to build it during `mvn package` (runs in
`generate-resources`, before the `webadmin/` copy) — and exclude the build
tooling from the copied resources:

```xml
<plugin>
  <groupId>com.github.eirslett</groupId>
  <artifactId>frontend-maven-plugin</artifactId>
  <version>1.15.1</version>
  <configuration><workingDirectory>webadmin</workingDirectory>
    <installDirectory>${project.build.directory}</installDirectory></configuration>
  <executions>
    <execution><id>install-node-and-npm</id><phase>generate-resources</phase>
      <goals><goal>install-node-and-npm</goal></goals>
      <configuration><nodeVersion>v20.18.0</nodeVersion></configuration></execution>
    <execution><id>npm-install</id><phase>generate-resources</phase>
      <goals><goal>npm</goal></goals><configuration><arguments>install</arguments></configuration></execution>
    <execution><id>npm-build-webadmin</id><phase>generate-resources</phase>
      <goals><goal>npm</goal></goals><configuration><arguments>run build</arguments></configuration></execution>
  </executions>
</plugin>
<!-- on the webadmin copy-resources <resource>, exclude: node_modules/**,
     package.json, package-lock.json, web/build.mjs, web/plugin.jsx -->
```

Three things must line up with the engine plugin:

1. **Transport name** — the first argument to `registerConnectorPanel` must
   equal the `<name>` in the engine descriptor (`source.xml`/`destination.xml`),
   which is also what `ConnectorProperties.getName()` returns and what the
   channel stores in `connector.transportName` (`"SQS Reader"` above).
2. **`defaults(version)` must mirror the Java properties class** — same
   `@class` (the `sharedClassName` FQCN), every field the Java constructor
   initializes with the same default values, and the built-in sub-objects
   (`sourceConnectorProperties` / `pollConnectorProperties` /
   `destinationConnectorProperties`) when the Java class implements the
   corresponding interface. The connector-panel helpers in `@oie/web-ui`
   (`defaultSourceProperties`, `defaultPollProperties`,
   `defaultDestinationProperties`) produce those shapes.
3. **Take React from `platform.React` and the framework from `@oie/web-ui`** —
   the host page's import map resolves `@oie/*` to the shell's loaded copy at
   runtime, so React and the framework are **never bundled** into the plugin. The
   plugin's own JSX **does** need compiling to `web/plugin.js` (the served entry)
   — ship that pre-built `.js` in the zip (see
   [Building the browser entry](#building-the-browser-entry)).

The web panel registration alone makes the type selectable; if the engine
plugin isn't installed, saving/deploying a channel that uses it will fail on
the engine side.

## Pairing with engine-side extensions

An engine plugin that registers its own REST servlet (via `apiProviders` in its
`plugin.xml`) is reachable from the browser at `/api/extensions/<path>` —
exactly how the bundled `server-log` plugin reads
`GET /api/extensions/serverlog`. Ship the engine half as a normal engine
extension and the UI half as a web admin plugin with the same name.
