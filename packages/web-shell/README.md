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
- `platform.store` / `platform.router` / `platform.events` — shared app state, routing, and the event bus

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

The package ships hand-authored TypeScript declarations (`index.d.ts`),
including a `Platform` interface you can use to type your `register(platform)`:

```ts
import type { Platform } from '@oie/web-shell';
export function register(platform: Platform) { /* ... */ }
```

## License

MPL-2.0
