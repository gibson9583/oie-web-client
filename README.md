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

```
oie-web-client/
├── LICENSE
├── README.md                 ← you are here
└── web-administrator/        ← the application
    ├── client/               browser SPA (plain ES modules, no build step)
    ├── server/               Node/Express server, /api reverse proxy, serializer bridge
    ├── plugins/              bundled web plugins (server + browser extensions)
    ├── docs/                 PLUGINS.md + parity audits
    ├── config.example.json   copy to config.json and edit
    └── package.json
```

## Quick start

```bash
cd web-administrator
npm install
cp config.example.json config.json      # then edit for your engine
npm start
# open http://localhost:3030 and sign in with your engine credentials
```

`npm run dev` restarts the server on changes. The frontend has no build step —
edit files under `client/` and refresh the browser.

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

> **Authentication** is the engine's own: the login form posts to
> `/api/users/_login` and the engine's `JSESSIONID` cookie carries the session.
> The Node server stores no credentials; it is a streaming reverse proxy. For
> production, terminate TLS in front of this app.

Setting `engineHome` (a path to an OIE install with a JVM available) lets the
server run a warm Java sidecar on the engine's own jars, so message-tree
serialization and JavaScript validation are byte-identical to the runtime.
Without it, the app falls back to built-in JS parsing.

## Documentation

- [`web-administrator/README.md`](web-administrator/README.md) — full feature
  overview, look & feel, and engine-API notes.
- [`web-administrator/docs/PLUGINS.md`](web-administrator/docs/PLUGINS.md) —
  plugin development guide with worked examples for every extension point.

## License

See [LICENSE](LICENSE).
