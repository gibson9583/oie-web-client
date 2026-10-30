# Channel Editors

OIE Web Client provides a classic editor and a guided wizard. Both write normal
engine channel models and preserve unknown extension fields.

## Guided channel wizard

![Guided channel wizard](https://raw.githubusercontent.com/wiki/gibson9583/oie-web-client/images/channel-wizard.png)

The wizard steps are:

1. **Basics** — name, description, inbound type, and outbound type.
2. **Dependencies** — code-template libraries, channel dependencies, resources.
3. **Channel Options** — initial state, storage, pruning, metadata, attachments.
4. **Source** — source connector, filter, transformer, and templates.
5. **Destinations** — one or more destination connectors and responses.
6. **Scripts** — deploy, undeploy, preprocessor, and postprocessor scripts.
7. **Review** — verify the complete plan before Create or Create & Deploy.

Visited steps remain selectable. A failed association or dependency write leaves
the wizard open so the incomplete phase can be retried without re-creating the
channel.

## Classic channel editor

![Classic channel editor](https://raw.githubusercontent.com/wiki/gibson9583/oie-web-client/images/channel-editor.png)

The classic editor exposes four tabs:

- **Summary** — identity, enabled state, tags, data types, dependencies, storage,
  pruning, attachments, metadata, and description.
- **Source** — source transport and its listener/polling/reader settings.
- **Destinations** — destination list, transport settings, queueing, response,
  filter, and transformer links.
- **Scripts** — preprocessing, postprocessing, deploy, and undeploy JavaScript.

Use **Validate Connector** before saving when the connector provides validation.
Use **Set Data Types** and **Set Dependencies** to update their shared models.

## Filters and transformers

![Transformer editor](https://raw.githubusercontent.com/wiki/gibson9583/oie-web-client/images/transformer.png)

Filters decide whether a message proceeds. Transformers apply ordered steps such
as JavaScript, Mapper, Message Builder, XSLT, Rule Builder, Iterator, or
Destination Set Filter. The right reference pane provides message functions,
templates, trees when available, and variables created by earlier steps.

Typical transformer workflow:

1. Add or import a step.
2. Give it a descriptive name.
3. Configure the step and inspect the generated script when applicable.
4. Reorder steps deliberately; later steps can depend on earlier variables.
5. Validate before returning to the channel.
6. Save the parent channel.

### Message Trees

The **Message Trees** tab shows a transformer template as a table. Each row
shows a field, its name, and its sample value. Rows that have children start
collapsed.

1. Select **Inbound** (`msg`) or **Outbound** (`tmp`) to choose the template.
2. Type in **Filter fields** to find a field by its ID, name, or value.
3. Select the eye button to hide or show empty fields.
4. Drag a row into a script editor or a text field to insert its accessor.
5. Right-click a row, or select its **⋯** button, for **Map to Variable**,
   **Map to Message**, and **Copy Accessor**. **Map to Variable** is available
   on the inbound template only.

Select a row to show its accessor below the table.

### Mapper and Message Builder steps

A Mapper step reads as `Set <variable> = <value>`. A Message Builder step reads
as `Set <target field> = <value>`. A Builder can edit the inbound message (`msg`)
or the outbound message (`tmp`). In **Target field → Browse…**, use **Message
fields** to choose which tree to browse. Choosing a tree does not change the
saved target; selecting a field does. You can also enter a target expression
directly. Both message trees offer **Map to Message** in their context menus.
The value has four types:

- **Message field**: a path in the inbound message. Select **Browse…** to choose
  it from the message tree.
- **Text**: fixed text. The editor adds the quotes.
- **Variable**: a map variable. Select the map (**Channel**, **Connector**,
  **Global Channel**, **Global**, **Response**, **Source**, **Configuration** or
  **Any map**) and enter the name. The hint shows which step sets it.
- **JavaScript**: any JavaScript expression.

**Default** is always visible. A Message Builder also shows **Step name**.
**More options** contains the Mapper **Store in** selector and replacement rules. Its collapsed summary shows the current map and configured
options. Map visibility and clearing behavior are explained beside the selector.
**String Replacement** applies regular expressions to the value in order. Rows
with a blank regular expression are not saved.

**Browse…** opens the Message Trees table inside the step form. Filter the
table or expand a row, then select a row to use that field. **Message Builder**
targets show **Inbound** and **Outbound**. Select a side to choose the tree.

Field pickers and the Message Trees panel refresh automatically when templates,
data types, or serialization settings change, including imports while the tree
panel is open. Failed field loads offer **Retry fields** without reloading the
page.

JSON numbers, booleans, and null remain visible and searchable in field pickers.

A Message Builder nested inside an Iterator is still a normal Message Builder.
The editor shows its actual parent context and index variable. **Sample N of M**
selects the template repetition that the field picker shows; it never changes the channel's saved index or
paths. Nested iterators show separate sample selectors. Changing an outer sample
resets the inner sample to the first repetition.

Only paths matching the iterator's **Prefix Substitutions** acquire its index
when picked or assigned. Configure outbound prefixes explicitly when the output
must repeat too. Removing a step from an iterator removes inherited indices from
matching complete field paths. Custom expressions stay intact. A warning asks
you to review any expression that still uses a removed or renamed index,
including complete paths outside the configured prefixes.

### Reordering steps

Drag the handle at the start of a row to move a step or rule in its list. This
works in the list and in the **Mapping table**. An Iterator's children move inside
that Iterator.

### Mapping table

Select **Mapping table** above the step list to show the transformer as a table.
The table shows every step in run order. Mapper and Message Builder rows read
**From** and **To**, with field and map names, and show the step name and default.
Other steps stay in run order, in gray, with their type and name.

1. Select a row. The Step tab below edits that step.
2. Select **Add step** to insert a Mapper, Message Builder, JavaScript or other
   step after the selected row. If the selected row is an Iterator, the new step
   goes inside it.
3. Drag the handle at the start of a row to move a step in its list.

An amber tag shows a step that reads a variable before the step that sets it.
A move that causes this asks for confirmation. The table and the list edit the
same steps. The editor keeps your choice of view.

Message trees and engine-side validation require native support or the optional
Web Support plugin. Format Document is performed locally in the browser.

## Concurrency and save conflicts

Editors compare the render-time channel with action-time server state. If another
administrator changed it, review the conflict rather than automatically
overwriting. After a lost response, refresh/reconcile before retrying: the write
may have committed even though the browser did not receive the response.



## Importing connectors, filters, and transformers

Import accepts Swing XML exports and existing web JSON exports. On Destinations,
**Import Connector** adds a destination with a fresh ID and an available name;
existing destinations stay intact. On Source, it replaces the source connector.
Source output data types are kept consistent with destination input types.

Filter, transformer, and response-transformer imports offer **Append** or
**Replace** when rules or steps already exist. Append retains current settings;
Replace loads the complete imported model, including transformer data types,
properties, and message templates. Imported changes remain drafts until the
channel is saved.

Both choices preserve imported expressions, including fixed, numeric, and
indexed Message Builder targets inside iterators. The editor adjusts inherited
indices only after a subsequent change to iterator membership or settings.
