# Users and Extensions

## Users

![Users screen](https://raw.githubusercontent.com/wiki/gibson9583/oie-web-client/images/users.png)

The Users screen lists engine user accounts and exposes New User, Edit User,
Change Password, and Delete User according to engine permissions.

### Create a user

1. Open **New User**.
2. Enter a unique username and profile fields.
3. Set the initial password through the provided password phase.
4. Verify the completed account in the refreshed list.

Account creation and password assignment are distinct server phases. If creation
succeeds but the list/password phase fails, use the recovery prompt; do not
blindly re-create the username or reset a similarly named existing user.

### Edit or delete a user

Select the exact row before opening an action. Reconcile the user inventory after
an ambiguous response. Deleting your own or the last administrative account can
make recovery difficult and may be restricted by the engine.

### Single sign-on accounts

With the engine's `oie-oidc-auth` extension enabled, users who sign in through
your identity provider are created on first sign-in (when JIT provisioning is
on) and are bound permanently to their provider identity; their role is taken
from the provider's claims at every sign-in, so change access at the provider,
not here. Existing local accounts are never taken over by a provider identity of
the same name unless an administrator links them under **Settings → OIDC
Authentication**. SSO accounts have no engine password, so **Change Password** is
not offered to them. SSO is configured entirely on the engine and works in every
deployment of the web administrator, WAR included.

## Extensions

![First-party extension inventory](https://raw.githubusercontent.com/wiki/gibson9583/oie-web-client/images/extensions.png)

The screen has three inventories:

- **Connectors** installed on the engine.
- **Plugins** installed on the engine.
- **Web Administrator Plugins** loaded into the browser application.

Select an engine extension to view properties, enable/disable it, or uninstall
it. **Install Extension** uploads an extension package to the engine. Most engine
extension changes require an engine restart before their runtime or web UI is
available.

Only install packages from trusted sources. A local web plugin can execute in the
browser, and an optional `server.js` runs inside the Node administrator process.
Extension endpoints must enforce authorization independently; hiding a task is
not a security boundary.

This Wiki shows only first-party OIE entries. Third-party extension screens are
outside its scope.

## Developing plugins

Developers can extend the web administrator without modifying its core source.
See [Plugin Development](https://github.com/gibson9583/oie-web-client/wiki/Plugin-Development)
for plugin architectures, public packages, extension points, packaging,
security, API contracts, and build examples.
