# Plugin Development

OIE Web Client exposes the same extension registries used by its bundled
features. A plugin can add first-party-style views, tasks, dashboard content,
settings panels, connector editors, attachment viewers, and other UI without
forking the administrator.

The canonical, versioned developer reference is
[`web-administrator/PLUGINS.md`](https://github.com/gibson9583/oie-web-client/blob/main/web-administrator/PLUGINS.md).
It documents the complete manifest, build, API, packaging, security, and
extension-point contracts. Use that guide as the source of truth when examples
on this overview page and the installed administrator differ.

## Choose a plugin architecture

The web administrator supports three common shapes:

1. **Web UI for an existing engine extension.** Add a React interface that calls
   the extension's existing REST endpoints under `/api/extensions/<path>`. The
   Swing and web interfaces can coexist while sharing one engine backend.
2. **New engine extension with a web UI.** Build the Java connector, servlet, or
   service in OIE and pair it with a web plugin. The package may also retain a
   Swing `ClientPlugin` when both administrators must be supported.
3. **Pure web plugin.** A React frontend can optionally include a Node/Express
   `server.js` backend mounted under `/plugin-api/<id>`. Use this only for logic
   that belongs in the web-administrator process rather than the OIE engine.

## Basic plugin layout

```text
my-plugin/
├── plugin.json
├── server.js            # optional Node/Express backend
└── web/
    ├── plugin.jsx       # source
    └── plugin.js        # compiled module loaded by the browser
```

A minimal manifest identifies the plugin and its browser entry:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "enabled": true,
  "oie": { "apiMin": "4.6" },
  "client": { "entry": "web/plugin.js" }
}
```

The browser loads the compiled ES module and calls its exported `register`
function. Plugin UI is React and must use the host's React instance through
`platform.React`; do not bundle another copy of React or the `@oie/*` framework.

## Public packages

Develop against the public packages instead of importing administrator
internals:

- `@oie/web-api` — OIE REST client and model helpers.
- `@oie/web-ui` — dialogs, forms, tables, editors, and shared UI components.
- `@oie/web-shell` — the platform object and extension registries.
- `@oie/eslint-config` — guards against unsupported deep imports and common
  module errors.

Keep `@oie/web-api`, `@oie/web-ui`, and `@oie/web-shell` external when bundling.
The administrator's import map resolves them to its active runtime instances.

Declare `oie.apiMin` when the plugin depends on a particular public capability.
The host compares it with `platform.apiVersion` and reports an incompatible
plugin under **Extensions → Web Administrator Plugins** instead of importing
code that cannot run.

## Extension points

The platform includes registries for:

- Navigation items and routed views.
- Dashboard tabs and columns.
- Channel-editor and Settings tabs.
- Channel and code-template actions.
- Connector panels and connector-property panels.
- Transformer steps and filter rules.
- Data types, transmission modes, and resource types.
- Message attachment viewers.
- Authorization controllers and extended-login authenticators.

The [complete plugin guide](https://github.com/gibson9583/oie-web-client/blob/main/web-administrator/PLUGINS.md)
contains the current function signatures, React examples, context objects, and
Swing-to-web extension-point mapping.

## Build and installation

Author JSX in `web/plugin.jsx` and compile it to an ES module at
`web/plugin.js`. The plugin guide contains a working esbuild configuration and
explains how to package a web UI inside an engine extension.

For local Node development, place the built plugin in a configured `pluginDirs`
location and refresh the browser. Browser modules are discovered at page load.
Adding a new `server.js` can mount it on discovery, but replacing an already
loaded server module requires restarting the Node administrator.

Engine-hosted plugin UIs require Web Support. See
[Deployment and Configuration](https://github.com/gibson9583/oie-web-client/wiki/Deployment-and-Configuration)
for the deployment modes and companion-extension guidance.

## Security requirements

- Install and run only trusted plugins. Browser modules execute in the signed-in
  administrator, and `server.js` executes inside the Node process.
- Enforce authorization on every server or engine endpoint. Hiding a navigation
  item or task button is not an authorization boundary.
- Follow the administrator's Content Security Policy: no `eval`,
  `new Function`, string-based timers, or injected inline scripts.
- Use the engine-backed script-validation helper when validating Rhino/E4X
  scripts rather than evaluating code in the browser.
- Preserve the host's single React and framework instances; duplicate runtimes
  can break hooks and register against inactive registries.
- Treat patient data, credentials, and engine configuration as sensitive. Do not
  persist them in browser storage or plugin logs.

## Development checklist

Before distributing a plugin:

1. Confirm the manifest and `oie.apiMin` against the canonical guide.
2. Build `web/plugin.js` without bundling React or `@oie/*` packages.
3. Test happy paths, authorization failures, network failures, stale data,
   repeated actions, partial completion, and safe retries.
4. Verify light and dark themes, supported viewport sizes, keyboard access, and
   the host UI/data-font tokens.
5. Test installation, refresh/restart behavior, disable/uninstall, and an older
   host that does not satisfy `apiMin`.
6. Document any engine extension, Web Support, Node, or restart requirement.

For full examples and packaging instructions, continue with the
[Web Administrator Plugin Development guide](https://github.com/gibson9583/oie-web-client/blob/main/web-administrator/PLUGINS.md).
