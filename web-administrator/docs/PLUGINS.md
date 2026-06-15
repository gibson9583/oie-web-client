# Web Administrator Plugin Development

The web administrator mirrors the engine's extension philosophy: the Swing
client loads `ClientPlugin` classes declared in `plugin.xml`; the web
administrator loads JavaScript modules declared in `plugin.json`. Built-in
views register through the **same registries** plugins use, so a plugin can do
anything a core view can.

## Anatomy of a plugin

```
plugins/
└── my-plugin/
    ├── plugin.json          # manifest (required)
    ├── server.js            # optional Node/Express extension
    └── web/
        ├── plugin.js        # optional browser entry (ES module)
        └── ...              # any other assets, served at /plugins/my-plugin/...
```

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

Drop the folder into `plugins/` (or any configured `pluginDirs` entry) and
**refresh the browser** — plugin directories are re-scanned on every load, so
no web administrator restart is needed. The exception is a plugin's optional
`server.js`: new ones mount on first discovery, but *updating* an
already-loaded server entry requires a restart (Node module cache). Load
status appears under **Extensions → Web Administrator Plugins**.

## How the engine's own extensions are packaged (same as yours)

Every extension in an engine install — including all the "built-in" ones
(`datapruner`, `serverlog`, `dashboardstatus`, the `datatype-*` set, `mllpmode`,
and the connectors themselves) — uses the identical packaging: a folder under
`extensions/` containing `plugin.xml` (and/or `source.xml`/`destination.xml`)
plus `libs/*.jar`, declaring `<serverClasses>`, `<clientClasses>`,
`<sharedClasses>` and optional `apiProvider` REST servlets. In the engine
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
| `DataTypeClientPlugin` | `datatypes/*` (HL7 v2, XML, …) | each ships as a web plugin (`plugins/datatype-*`) calling `registerDataType`; `client/datatypes/index.js` is just the registry read-side (`dataTypeDef` / `dataTypeList`), and `props-editor.js` renders any registered type |
| `TransmissionModePlugin` | `mllpmode` (MLLP framing) | `registerTransmissionMode` — Basic is built in; `mllpmode` ships as a plugin. TCP's Transmission Mode dropdown + ⚙ settings dialog + Sample Frame are driven by the registry |
| `ResourceClientPlugin` | `directoryresource` (Directory resource type) | `registerResourceType` — the Settings → Resources panel is generic; `directoryresource` ships as a plugin providing the Directory type editor |
| `ChannelColumnPlugin` / `ChannelPanelPlugin` / `ChannelWizardPlugin` / `TaskPlugin` / `MultiFactorAuthenticationClientPlugin` | various | not yet — ask if you need one |

### Bundled web plugins

Like the Swing client, the web administrator does **not** privilege its built-in
features — they ship as plugins under `plugins/`, loaded through the same
mechanism a third-party plugin uses. The core client is a thin shell plus the
shared frameworks they build on (the connector toolkit `client/connectors/forms.js`,
the data-type properties renderer `client/datatypes/props-editor.js`, the form
builder, etc.). Current set:

- **Connectors** (`connector-*`): vm, tcp, http, file, database, javascript, smtp, ws, dicom, jms, document
- **Data types** (`datatype-*`): hl7v2, hl7v3, xml, json, raw, delimited, edi, ncpdp, dicom
- **Transformer steps & filter rules** (`transformer-steps`): mapper, messagebuilder, javascriptstep, xsltstep, destinationsetfilter, scriptfilestep, iterator; rulebuilder, javascriptrule, scriptfilerule
- **Dashboard tabs/columns**: `server-log`, `global-maps`, `connection-status`
- **Attachment viewers** (`attachment-*`): imageviewer, pdfviewer, textviewer, dicomviewer
- **Settings panel**: `datapruner`
- **Connector properties**: `httpauth`
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

## Browser side

`web/plugin.js` is dynamically imported and must export:

```js
export function register(platform) { ... }
```

### Extension points (Swing equivalents in parentheses)

```js
// Full routed view + rail navigation (ClientPlugin)
platform.registerNavItem({ id, label, icon, path, section, order });
platform.registerView('/my-path/:param?', ({ params, query }) => {
    return { el, teardown };          // el: DOM node; teardown(): clear timers
}, { title: 'My View' });

// Dashboard tab below the status table (DashboardTabPlugin)
platform.registerDashboardTab({ id, label, order,
    render(host, { selection, platform }) {} });

// Extra dashboard column (DashboardColumnPlugin)
platform.registerDashboardColumn({ id, label, order, render(dashboardStatus) {} });

// Tab inside the channel editor (ChannelTabPlugin)
platform.registerChannelTab({ id, label, order,
    render(host, { channel, platform, onChange }) {} });

// Tab in Settings (SettingsPanelPlugin)
platform.registerSettingsPanel({ id, label, order, render(host, { platform }) {} });

// Message attachment renderer (AttachmentViewer)
platform.registerAttachmentViewer({ id,
    canHandle(attachment) { return attachment.type === 'application/dicom'; },
    render(host, { attachment, channelId, messageId, platform }) {} });

// Transformer step / filter rule editors (TransformerStepPlugin / FilterRulePlugin)
platform.registerStepType('com.example.MyStep', {
    label: 'My Step',
    create() { return { __type: 'com.example.MyStep', name: 'New Step', enabled: true }; },
    render(host, { element, onChange }) {} });
platform.registerRuleType('com.example.MyRule', { /* same contract */ });

// Connector property panel (ConnectorSettingsPanel) — e.g. for a custom connector
platform.registerConnectorPanel('My Listener', 'SOURCE', {
    defaults(version) { return { '@class': 'com.example.MyReceiverProperties', '@version': version /* … */ }; },
    render(host, { properties, connector, channel, platform, onChange }) {} });

// Custom data type registration
platform.registerDataType('MYTYPE', { label: 'My Type', propertiesClass: 'com.example…' });

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
    render(host, { getEntry, setEntry, connector, channel, platform, onChange }) {
        // getEntry() → current entry or null; setEntry(obj|null) creates/removes
        // it while preserving sibling plugin entries (e.g. HTTP auth).
    }
});

// Transmission mode for framed connectors like TCP (TransmissionModePlugin).
// The connector renders a Transmission Mode dropdown of all registered modes;
// the active mode's apply()/sampleFrame()/openSettings() drive the UI. Each
// mode edits connector.properties.transmissionModeProperties.
platform.registerTransmissionMode('MLLP', {
    label: 'MLLP', order: 10,
    apply(tm) { tm.pluginPointName = 'MLLP'; tm.startOfMessageBytes = '0B'; tm.endOfMessageBytes = '1C0D'; },
    sampleFrame(tm) { return '<VT> Message Data <FS><CR>'; },   // preview text
    openSettings(tm, onChange) { /* modal editing the mode's properties */ }
});

// Resource type for Settings → Resources (ResourceClientPlugin). The Resources
// panel is generic; each type supplies its factory + detail editor.
platform.registerResourceType('Directory', {
    label: 'Directory',
    propertiesClass: 'com.mirth.connect.plugins.directoryresource.DirectoryResourceProperties',
    detailHeader: 'Directory Settings',
    create({ version, containerIsArray }) { return { /* new resource object */ }; },
    renderDetail(host, { entry, locked, platform, refreshTable }) {}
});
```

### Platform services

| API | Purpose |
|---|---|
| `platform.api` | Full engine REST client (`api.channels`, `api.messages`, `api.status`, … plus raw `api.get/post/put/del`). All calls share the user's session. |
| `platform.ui` | DOM toolkit: `h()`, `DataTable`, `tabs()`, `modal()`, `confirmDialog`, `promptDialog`, `toast`, `contextMenu`, form helpers, `downloadFile`, `pickFile`, `fmtDate`, `icon(name)`. `fmtDate` renders every timestamp in the user's chosen time zone (the topbar Server/Local/UTC toggle, `core/timezone.js`) — use it for all displayed dates. |
| `platform.columns` | Resizable + reorderable columns for hand-built `table.dt` grids: `createColumnManager(key, defaultWidths)` + `decorateColumns(table, opts)`. See [Resizable / reorderable columns](#resizable--reorderable-columns). |
| `platform.mirth` | Model helpers: `elementsToArray`/`arrayToElements` (XStream polymorphic lists), `newChannel`, `statePip`, `uuid`. (Data types are no longer here — they come from the registry via `dataTypeDef`/`dataTypeList` in `/datatypes/index.js`.) |
| `platform.dataTypes()` / `platform.transmissionModes()` / `platform.resourceTypes()` | Read the registered data types / transmission modes / resource types (each populated by a plugin). |
| `platform.createCodeEditor({ value, onChange })` | Code editor component (`platform.setCodeEditorFactory` lets a plugin swap in CodeMirror etc. app-wide) |
| `platform.router` | `navigate(path)`, `currentPath()` |
| `platform.store` / `platform.events` | Shared state (`getState('user')`, `'serverVersion'`, `'webPlugins'`) and pub/sub bus |

### Resizable / reorderable columns

`platform.columns` (core module `core/columns.js`) makes any hand-built
`table.dt` grid's columns drag-to-reorder, drag-to-resize, and double-click-to-
auto-fit, with the order and widths persisted per table in `localStorage`. It is
used by the Dashboard, Channels, Code Templates, Connection Log, and Global Maps
tables.

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
3. Style with the design system (`client/css/app.css` classes and CSS
   variables) so plugins match both themes.

## Server side

`server.js` (CommonJS) lets a plugin add endpoints on the Node server:

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

## Adding UI for custom engine connectors

Engine-side plugins can add entirely new connector types (a `source.xml` /
`destination.xml` descriptor plus a shared `ConnectorProperties` class). The
channel editor's Connector Type select lists every type the engine reports
(`GET /extensions/connectors`), but types without a web panel are labeled
"(no web editor)" and cannot be *selected* — the web administrator can't
invent the engine's `@class` properties object. Existing channels that
already use such a type still render through the generic JSON fallback panel.
To make a custom connector fully editable, ship a companion web admin plugin
that registers a connector panel. The bundled `plugins/sqs-connector/` is the
worked example for the SQS engine connector:

```js
// plugins/sqs-connector/web/plugin.js (abridged)
import { h } from '/core/ui.js';
import { buildForm, pollSection, defaultPollProperties,
         defaultSourceProperties } from '/connectors/forms.js';

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
    render(host, { properties, onChange }) {
        const formHost = h('div');
        host.appendChild(formHost);
        buildForm(formHost, properties, [ /* schema-driven fields */ ], onChange);
        host.appendChild(pollSection(properties, onChange));
    }
};

export function register(platform) {
    platform.registerConnectorPanel('SQS Reader', 'SOURCE', sqsReader);
}
```

### Shipping the web UI inside the engine extension

Instead of a separate install, an engine extension can carry its web admin
plugin in a `webadmin/` folder inside the extension zip
(`<extension>/webadmin/plugin.json` + assets). Point the web administrator's
plugin search path at the engine's extensions directory and it is discovered
automatically:

```bash
WEBADMIN_PLUGIN_DIRS=/path/to/oie/extensions npm start
# or in config.json:  { "pluginDirs": ["/path/to/oie/extensions"] }
```

The loader checks each entry for `plugin.json` directly (native layout) or
under `webadmin/` (engine-extension layout); duplicate plugin ids are loaded
first-found. The SQS connector repo demonstrates the full pattern — one
Maven build produces a zip that serves the engine, the Swing client, and the
web administrator.

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
   corresponding interface. The helpers in `/connectors/forms.js`
   (`defaultSourceProperties`, `defaultPollProperties`,
   `defaultDestinationProperties`) produce those shapes.
3. **Import core modules by absolute URL** — plugin modules are served at
   `/plugins/<id>/...` while the app's `client/` directory is the web root, so
   relative imports won't reach core code. Use `'/connectors/forms.js'`,
   `'/core/ui.js'`, etc. (static or dynamic `import()` both work).

The web panel registration alone makes the type selectable; if the engine
plugin isn't installed, saving/deploying a channel that uses it will fail on
the engine side.

## Pairing with engine-side extensions

An engine plugin that registers its own REST servlet (via `apiProviders` in its
`plugin.xml`) is reachable from the browser at `/api/extensions/<path>` —
exactly how the bundled `server-log` plugin reads
`GET /api/extensions/serverlog`. Ship the engine half as a normal engine
extension and the UI half as a web admin plugin with the same name.
