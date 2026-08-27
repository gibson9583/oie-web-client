# Getting Started

## What you need

- A running Open Integration Engine server.
- A current browser.
- Engine credentials with the permissions needed for your work.
- Node.js 22 LTS for a source deployment, or Docker/JDK as described in
  [Deployment and Configuration](https://github.com/gibson9583/oie-web-client/wiki/Deployment-and-Configuration).

The base administrator works through the engine REST API. The optional
[OIE Web Support plugin](https://github.com/gibson9583/oie-web-support-plugin)
adds byte-exact message trees, engine-side JavaScript validation,
engine-served plugin UIs, and a plugin-managed embedded WAR.

## Start from source

```bash
git clone <repository-url>
cd oie-web-client
npm install
cd web-administrator
cp config.example.json config.json
npm run dev
```

Set `engine.url` in `config.json`, then open `http://localhost:3030`. For a
production-style run, build first with `npm run build` and then use `npm start`.

## Sign in

![Sign-in screen](https://raw.githubusercontent.com/wiki/gibson9583/oie-web-client/images/login.png)

1. Select an engine when the administrator is configured for multiple engines.
2. Enter your normal OIE username and password.
3. Complete any engine-provided secondary-authentication prompt.
4. Accept the login notification when the server requires it.

The browser receives the engine session cookie through the same-origin proxy.
The Node server does not store your password. Use **Logout** when leaving a
shared workstation; closing a tab is not a substitute for signing out.

## First five minutes

1. Open **Dashboard** and confirm the connection indicator is green.
2. Verify the engine name, environment, and version in the title bar.
3. Open **Channels** and select a channel to expose its task pane.
4. Open **Messages** only when your role permits access to message content.
5. Visit **Settings → Administrator** to choose refresh intervals, table
   density, theme, UI font, and data font.

Continue with the [Interface Tour](https://github.com/gibson9583/oie-web-client/wiki/Interface-Tour).

