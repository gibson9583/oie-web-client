# @oie/web-ui

The web administrator's UI framework — the DOM toolkit, data tables, forms,
dialogs, and code editor that plugin views are built from. Depends on
[`@oie/web-api`](../web-api).

```js
import { h, DataTable, modal, field, textInput, toast, taskButton, fmtDate } from '@oie/web-ui';

const table = new DataTable([
  { key: 'name', label: 'Name', render: (r) => r.name }
], { selectable: 'single', emptyText: 'Nothing here' });

modal({ title: 'Hello', body: field('Name', textInput('')), buttons: [{ label: 'Close' }] });
```

## What's in here

- **DOM toolkit** — `h()` hyperscript, `toast`, `contextMenu`, `confirmDialog`,
  `promptDialog`, `modal`.
- **Tables** — `DataTable` with selection, sorting, context menus, and the
  reusable resizable/reorderable/auto-fit **columns** module.
- **Forms** — `field`, `textInput`, `checkbox`, `select`, `taskButton`.
- **Code editor** — the Monaco-backed editor wrapper used by channel scripts,
  code templates, and connector editors.
- **Connector-panel toolkit** — `buildForm`, `pollSection`, `CHARSETS`, and the
  default property shapes (`defaultSourceProperties`, `defaultPollProperties`,
  `defaultDestinationProperties`) for building a connector's settings panel. A
  connector is an engine extension; its web half is only a property panel built
  with these. See the SQS connector for a worked example.
- **Formatting** — `fmtDate` (timezone-aware), icons.

## Runtime model

Like `@oie/web-api`, this resolves at runtime (via the page import map) to the
shell's loaded `/core/pkg-ui.js`, so dialogs, toasts, and the timezone state
your plugin uses are the same instances the shell uses. The package ships
hand-authored TypeScript declarations (`index.d.ts`) for the component surface.

## License

MPL-2.0
