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
- **Formatting** — `fmtDate` (timezone-aware), `icon`.

## Code and message editors (API 4.8)

`createCodeEditor(options)` and `platform.createCodeEditor(options)` share the
same factory. Web Client 1.1.0 adds accessible labels, literal message input and
HL7 v2 highlighting:

```ts
import { createCodeEditor } from '@oie/web-ui';

const editor = createCodeEditor({
  value: 'MSH|^~\\&|SENDER|FACILITY', language: 'hl7v2',
  literalInput: true, ariaLabel: 'Inbound Template'
});
// Append editor.el to your view; call editor.dispose() on unmount.
```

`literalInput` disables typing assistance and uses compact line numbers.
`ariaLabel` also names the fallback textarea. For JavaScript editors,
`completionScope: { channelId, context }` selects the channel and engine
`ContextType` used for Reference and code-template completions while focused.

Languages: `javascript` (`js` / `rhino`), `json`, `xml`, `html`, `sql`, `hl7v2`
and `text`. HL7 hovers show field paths and optional engine-supplied names.
The shared editor returns `el`, `getValue()`, `setValue()`, `focus()` and
`dispose()`; Monaco loading is optional. Display values can normalize line
endings, and `setValue()` can notify `onChange` once Monaco is active. See
[Code and message editors](../../web-administrator/PLUGINS.md#code-and-message-editors)
for lifecycle, keyboard and raw-message preservation guidance.

## Connector form additions (API 4.8)

`FormField.onSet(properties, value, previousValue?)` receives the row's
render-time value as its third argument, after the new property value is set.
`RequiredFieldSpec.unset` lets `requireFields()` reject an exact placeholder
such as `Please Select a Driver`. React `ConnectorForm` code fields also accept
`completionScope`. See
[Connector form callbacks and validation](../../web-administrator/PLUGINS.md#connector-form-callbacks-and-validation)
for callback ordering, conditional requirements and an example.

## Runtime model

Like `@oie/web-api`, this resolves at runtime (via the page import map) to the
shell's loaded `/core/pkg-ui.js`, so dialogs, toasts, and the timezone state
your plugin uses are the same instances the shell uses. The package ships
TypeScript declarations generated from the web administrator's TypeScript
sources (`index.d.ts` re-exports `types/`, emitted by
`npm run gen:types -w oie-web-administrator`).

## License

MPL-2.0
