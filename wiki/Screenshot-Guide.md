# Screenshot Guide

Wiki screenshots are generated, not manually staged.

## Capture

```bash
npm install
npm run build -w web-administrator
npm run wiki:screenshots
```

The runner:

- starts the production build on isolated port `3039`;
- forces a single-engine configuration;
- intercepts `/api` with the standard Playwright mock engine;
- uses a 1440×1000 light-theme viewport;
- waits for bundled fonts and disables animations;
- writes 18 PNG files under `wiki/images/`.

Set `WIKI_PORT=3040` to use another port. The captures use synthetic users,
channels, messages, configuration, and extension metadata. Never replace them
with screenshots containing real credentials, endpoints, tokens, PHI, or other
production data.

## Scope policy

Capture only first-party OIE Web Client and first-party OIE extension surfaces.
Do not add third-party plugin screens to this Wiki. When the first-party UI
changes, update the capture flow, regenerate all screenshots, and review every
image before committing.

