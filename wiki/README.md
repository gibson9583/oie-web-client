# OIE Web Client Wiki

Start with [Home](https://github.com/gibson9583/oie-web-client/wiki/Home). The pages in this directory are written in a
GitHub-Wiki-compatible format and are also readable directly in the repository.

The Wiki documents the OIE Web Client and the first-party functionality shipped
with Open Integration Engine. It intentionally does not document third-party
plugin screens. Screenshots use deterministic mocked engine data and contain no
production data or protected health information.

The Wiki also includes a first-party
[Plugin Development](https://github.com/gibson9583/oie-web-client/wiki/Plugin-Development)
overview. The canonical, versioned developer reference remains
[`web-administrator/PLUGINS.md`](https://github.com/gibson9583/oie-web-client/blob/main/web-administrator/PLUGINS.md).

## Regenerating screenshots

From the repository root:

```bash
npm install
npm run build -w web-administrator
npm run wiki:screenshots
```

The capture runner starts an isolated server on port `3039`, intercepts engine
API calls with the standard Playwright fixtures, and replaces the PNG files in
`wiki/images/`. Set `WIKI_PORT` when that port is unavailable.
