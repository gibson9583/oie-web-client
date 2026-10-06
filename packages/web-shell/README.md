# @oie/web-shell

The Shell API — the web administrator's extension points. This is what a plugin
imports to register itself: nav items, views, settings panels, connector
property panels, dashboard tasks, and shared store/router access. Depends on
[`@oie/web-api`](../web-api) and [`@oie/web-ui`](../web-ui).

```js
import { platform } from '@oie/web-shell';
import { h } from '@oie/web-ui';
import api from '@oie/web-api';

export function register() {
  platform.registerNavItem({ id: 'my-plugin', label: 'My Plugin', icon: 'plug',
    path: '/my-plugin', section: 'Engine', order: 99 });

  platform.registerView('/my-plugin', () => ({
    el: h('div.view', h('h1', 'Hello from a plugin'))
  }), { title: 'My Plugin' });
}
```

## Extension points

- `platform.registerNavItem(...)` / `platform.registerView(...)`
- `platform.registerSettingsPanel(...)` — config panels in Settings
- `platform.registerConnectorPanel(...)` / `platform.registerConnectorPropertiesPanel(...)` — connector editor panels
- `platform.registerDashboardTab(...)` / `platform.registerDashboardColumn(...)` — dashboard tabs and columns
- `platform.registerChannelTab(...)`, `platform.registerAttachmentViewer(...)`, `platform.registerStepType(...)` / `registerRuleType(...)`, `platform.registerResourceType(...)`
- `platform.registerReferences(category, items)` / `platform.references()` — add Reference/autocomplete entries and inspect plugin registrations (API 4.8)
- `platform.store` / `platform.router` / `platform.events` — shared app state, routing, and the event bus

## Script references (API 4.8)

Import `ReferenceItem` from `@oie/web-shell` to type registrations. Each item
requires `name` and `code`; optional fields are `description`, `type`
(`FUNCTION`, `DRAG_AND_DROP_CODE` or `COMPILED_CODE`) and `contexts` (engine
`ContextType` names). Omitted contexts apply everywhere; `[]` matches none.
Register once during plugin setup: calls append entries.

`platform.references()` returns `Array<ReferenceItem & { category: string }>`
for plugin registrations across all contexts. Built-in catalog entries and
channel code templates are not included. The array is a copy; treat its entries
as read-only. Use an editor's `completionScope` to select its completion context.

Web Client 1.1.0 implements framework API **4.8.0**, independently of the engine
version. Declare `"oie": { "apiMin": "4.8" }` when using these additions. See
[Script references](../../web-administrator/PLUGINS.md#script-references) and the
[1.1.0 API additions](../../web-administrator/PLUGINS.md#api-additions-in-web-client-110)
for the full contracts, including editor options and channel-tag helpers.

## Plugin UI is React

Most extension points take a React **`component`** (rendered by the shell as
`<Component {...ctx} />`), not an imperative `render(host, ctx)`. Author it
against **`platform.React`** — the shell's single React instance — so hooks and
context work and you don't bundle a second copy:

```js
const { React } = platform;
function MyPanel({ platform }) {
  return React.createElement('div', { className: 'view' }, 'Hello');
}
platform.registerSettingsPanel({ label: 'My Plugin', component: MyPanel });

// A full routed view from a component: wrap it with reactView.
platform.registerView('/my-plugin', platform.reactView(MyPanel), { title: 'My Plugin' });
```

**`registerChannelTab`** takes a `component` too, but also still accepts an
imperative `render(host, ctx)` for back-compat (its host in the channel editor is
vanilla DOM). The one point that is *not* a component is a **dashboard column**:
it's a pair of per-cell renderers (`cell(status)` / `connectorCell(child)`) the
dashboard table calls for every row rather than one mounted component. The
TypeScript declarations (`index.d.ts`) encode which is which.

## Runtime model

`@oie/web-shell` resolves at runtime to the shell's own loaded
`/core/pkg-shell.js`. This is what makes the single-instance guarantee matter:
your `platform.registerView(...)` mutates the **shell's** registries, so the
view actually appears. A bundled second copy would register into a dead
registry and silently do nothing — which is why the runtime resolves through
the page's import map, not the bundled `dist/`.

The package ships TypeScript declarations generated from the web administrator's
TypeScript sources (`index.d.ts` re-exports `types/`, emitted by
`npm run gen:types -w oie-web-administrator`), including a `Platform` interface
you can use to type your `register(platform)`:

```ts
import type { Platform } from '@oie/web-shell';
export function register(platform: Platform) { /* ... */ }
```

## License

MPL-2.0
