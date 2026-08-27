# Troubleshooting

## The browser cannot connect to the engine

- Confirm the green/red status indicator and configured engine URL.
- Test network/DNS reachability from the Node container or host, not only from
  your workstation browser.
- OIE commonly uses a self-signed certificate. Keep verification disabled only
  for that controlled case; use a trusted certificate in production.
- In Docker on macOS/Windows, the host engine is commonly reached through
  `host.docker.internal`, not container loopback.

## Blank page or bare-import error

Run `npm install` at the repository root. For production, run
`npm run build -w web-administrator` before `npm start -w web-administrator`.
Use Node 22 LTS.

## Login loops or immediately expires

- Verify the engine accepts REST API sessions and its session timeout is sane.
- Check reverse-proxy scheme/host forwarding and cookie handling.
- Clear stale site data only after recording any unsaved/recovery situation.
- Confirm all tabs use the same intended engine and user.

## Message trees, Validate Script, or engine-served plugin UIs are missing

Install the [Web Support plugin](https://github.com/gibson9583/oie-web-support-plugin)
and restart OIE, unless the connected engine already provides the native
endpoints. Format Document remains available because it runs client-side.

## A view is empty or reports a secondary-load failure

Open Events and browser developer tools, then retry Refresh. The UI deliberately
surfaces failures for prerequisites such as dependencies, tags, connector
metadata, or template libraries instead of pretending the set is empty.

## An operation timed out

Do not immediately repeat it. Refresh from an independent view and inspect
Events/current server state. Follow the UI’s reconciliation or verified-outcome
prompt. See [Operations and Safety](Operations-and-Safety.md).

## WAR returns 404

Place the WAR directly in `<OIE_HOME>/webapps/`, restart OIE, and use the context
matching the WAR filename. A copied WAR is not discovered until restart.

## Docker healthcheck fails with built-in TLS

The image’s default healthcheck uses HTTP. Supply an HTTPS-aware healthcheck when
the application itself serves TLS.

## Extension UI does not appear

- Confirm the engine extension is installed and enabled.
- Restart the engine when requested.
- Confirm native web-plugin endpoints or Web Support are available.
- Review the Extensions inventory for API-version or load errors.
- Remember that this Wiki intentionally does not document third-party plugin UIs.

