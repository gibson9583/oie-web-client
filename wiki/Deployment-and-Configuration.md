# Deployment and Configuration

OIE Web Client supports Node, Docker, and WAR deployments.

## Node

```bash
npm install
cd web-administrator
npm run build
npm start
```

Use `npm run dev` instead during development. The production server requires the
generated `client/dist`; raw TypeScript/Tailwind source is not browser-ready.

## Docker

```bash
docker run --rm -p 127.0.0.1:3030:3030 \
  -e OIE_URL=https://host.docker.internal:8443 \
  gibson9583/oie-web-client:latest
```

The example publishes plain HTTP to host loopback. Terminate TLS or enable the
Node TLS settings before exposing a routable address. When built-in TLS is used
inside Docker, replace the image’s plain-HTTP healthcheck with an HTTPS-aware
probe.

## WAR

```bash
npm run build:war
cp web-administrator/dist/oie-webadmin.war /path/to/OIE/webapps/
```

Restart OIE, then open the context derived from the WAR filename. WAR mode is
single-engine and uses the hosting OIE server. The optional
[Web Support plugin](https://github.com/gibson9583/oie-web-support-plugin/releases)
also provides a plugin-managed embedded WAR.

## Configuration precedence

The Node server loads one JSON document, then applies per-setting environment
overrides. Document precedence is:

1. `WEBADMIN_CONFIG_JSON` — inline JSON.
2. `WEBADMIN_CONFIG` — explicit file path.
3. `web-administrator/config.json` — optional default file.
4. Built-in defaults.

Important settings:

- `engine.url` / `OIE_URL` — default engine.
- `engine.verifyTls` / `OIE_VERIFY_TLS` — validate the engine certificate.
- `allowedUrls` — named engine picker entries.
- `host` / `WEBADMIN_HOST` and `port` / `WEBADMIN_PORT` — listener.
- `tls` / `WEBADMIN_TLS_*` — built-in HTTPS.
- `trustedProxies` / `WEBADMIN_TRUSTED_PROXIES` — forwarding trust boundary.
- `pluginDirs` / `WEBADMIN_PLUGIN_DIRS` — additional local plugin directories.
- `codeTemplateCompletions` — channel-aware code-template completion loading.

An explicitly selected missing or invalid configuration document stops startup.
Do not put secrets in a file that is committed to source control.

## Release tags

- Immutable Docker tags use `X.Y.Z`.
- `X.Y` follows the latest patch within that release line.
- `latest` moves on stable semantic-version releases.
- `main` follows the default branch tip and is not an immutable release.

Prefer immutable tags/digests in production and record the previous deployment
for rollback.

