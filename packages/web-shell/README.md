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
- `platform.registerSettingsPanel(...)` — informational/config panels in Settings
- `platform.registerConnectorPropertiesPanel(...)` — connector editor panels
- `platform.registerDashboardTask(...)` and related task hooks
- `platform.store` / `platform.router` — shared app state and routing

## Runtime model

`@oie/web-shell` resolves at runtime to the shell's own loaded
`/core/pkg-shell.js`. This is what makes the single-instance guarantee matter:
your `platform.registerView(...)` mutates the **shell's** registries, so the
view actually appears. A bundled second copy would register into a dead
registry and silently do nothing — which is why the runtime resolves through
the page's import map, not the bundled `dist/`.

Types are inferred from the shipped `.js` for now.

## License

MPL-2.0
