# @oie/web-api

The OIE engine REST client and model helpers used by the web administrator and
its plugins. This is the **leaf** package — it has no `@oie/*` dependencies.

```js
import api, { asList, uuid } from '@oie/web-api';

const channels = await api.channels.list();
const stats    = await api.statistics.list();
const ids      = asList(someXStreamMap, 'string');
```

## What's in here

- `api` (default export) — the REST surface, grouped by resource
  (`api.channels`, `api.messages`, `api.users`, `api.server`, …). Every call
  goes through the web admin's reverse proxy, which adds the engine's required
  `X-Requested-With` CSRF header.
- Model/serialization helpers — `asList`, `uuid`, and the XStream
  map/list shaping used to talk to the engine.

## Runtime model (important for plugin authors)

At runtime inside the web admin, `@oie/web-api` resolves — via the page's
import map — to the **shell's already-loaded** copy (`/core/pkg-api.js`), so
your plugin shares the shell's single API/session instance. The bundled
`dist/` here exists for build-time resolution and standalone use; never assume
a second copy is created at runtime.

The package ships TypeScript declarations **generated from the client's
TypeScript sources** (`index.d.ts` re-exports `types/`, emitted by
`npm run gen:types -w oie-web-administrator`), so the published types are the
same ones the implementation compiles against. Engine model objects come from
the engine's OpenAPI spec: `npm run gen:schema -w @oie/web-api` regenerates the
canonical `web-administrator/client/core/oie-schema.d.ts` and the package-root
copy, and the next `gen:types` copies it into `types/oie-schema.d.ts`. The wire
shapes (`WireChannel`, `XStreamList`, `XStreamElements`, ...) are declared in
`web-administrator/client/core/wire-types.ts` and re-exported here.

## License

MPL-2.0
