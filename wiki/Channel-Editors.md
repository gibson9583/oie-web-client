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

Message trees and engine-side validation require native support or the optional
Web Support plugin. Format Document is performed locally in the browser.

### Iterator behavior compared with Swing 4.6.0

For a Mapper created from an HL7 sample, **Assign To Iterator** offers the same
field paths as Swing. For example, choosing OBX.5 for
`msg['OBX'][0]['OBX.5']['OBX.5.1'].toString()` creates a loop over
`msg['OBX']['OBX.5']`. Its Mapper reads
`msg['OBX']['OBX.5'][i]['OBX.5.1'].toString()` for each value. Choosing an
existing Iterator over the same field produces the same mapping.

When one configured prefix extends the path produced by an earlier prefix, the
editor applies both in list order. For XML cleanup calls such as `.slice(-2)`
and `.replace(/-/g, '')`, the assigned expression can contain `[i][0]`,
as in Swing. For a JSON array of objects, the editor uses `[i]` to select the
current object. It preserves fixed selectors farther down a field or write path.
A literal fallback such as `msg['OBX'][0]['OBX.5'].toString() || 'unknown'`
appears as a single choice when creating a new Iterator. **Cancel** keeps the
step in place.

**Available Variables** inserts a JavaScript map lookup when dragged into a
Mapper. For example, an earlier Mapper with the key `observations` supplies
`$('observations')`. **Map to Variable** on the inbound message root opens a
Mapper with an empty variable name. Enter the key before validating the
transformer. For a field, the editor proposes a tree-derived name and checks
for keys already in use.

If a preceding JavaScript step declares `var label = "column", i = 7;`, you
can change an empty Iterator's index from `i` to `j` and preserve the
script's `i`. Renaming a populated Iterator also updates supported descendant
expressions.
The web editor applies these checks when placing steps and creating tree writes.

- If an Iterator index such as `mapping` would be overwritten by the generated
  Mapper script, the editor asks for a different index before placing the step.
- When a tree drop uses a wildcard namespace and the Iterator names that
  namespace explicitly, the editor warns if it cannot bind the write to the
  current row. The existing draft stays intact. For a loop over
  `msg.env.v::group` with index `i`, enter `msg.env.v::group[i].value` in
  **Message Segment** to update each group's value.

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
