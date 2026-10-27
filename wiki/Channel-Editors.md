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

The classic editor exposes five tabs:

- **Inspector** — a read-only view of the working channel in execution order.
- **Summary** — identity, enabled state, tags, data types, dependencies, storage,
  pruning, attachments, metadata, and description.
- **Source** — source transport and its listener/polling/reader settings.
- **Destinations** — destination list, transport settings, queueing, response,
  filter, and transformer links.
- **Scripts** — preprocessing, postprocessing, deploy, and undeploy JavaScript.

Use **Validate Connector** before saving when the connector provides validation.
Use **Set Data Types** and **Set Dependencies** to update their shared models.

### Channel Inspector

**Inspector** is the first tab. Opening a channel with **Edit Channel** still
starts on **Summary**. Select **Inspect Channel** in Channels or the Dashboard
channel context menu to open Inspector directly. Channels also provides an
**Inspect Channel** task. These actions use the same channel-edit permission as
**Edit Channel**.

Inspector reads the current editor model, including unsaved changes, without
saving or deploying it. Its context line identifies the editor revision and
unsaved changes. Deployment status separately reports whether the channel is
deployed and, when available, how many saved revisions it is ahead of deployment.
Use **Refresh status** to read the status again. A failed or unavailable status
read leaves the local inspection usable.

The engine and shipped Web Support APIs do not expose the deployed channel
configuration. Inspector therefore has no deployed-configuration selector or
configuration diff; a matching saved revision does not mean unsaved editor
changes are deployed.

The story groups deploy and undeploy hooks, then follows receiving,
preprocessing, source filtering, source transformation, destination processing,
postprocessing, and the response to the sender. Queues, storage, pruning, and
custom metadata follow. A destination chain map shows enabled destinations in
their configured order. Chains process independently; destinations within a
chain wait for the previous destination's initial processing. Queued sends can
finish later. Filtering and send errors allow the chain to continue; an error in
the initial filter/transformer stops the remaining destinations in that chain.
When **Include Filter/Transformer** is enabled, queued attempts repeat those
steps. With an Always queue, the filter and transformer also start in the queue;
with an On Failure queue, they run immediately only when an immediate send is
attempted. Later destinations and the sender's response can proceed before
queued work finishes. Disabled destinations remain available in a separate disclosure.
The response section explains when a source queue answers before processing.

Open a rule, step, or script row to read its configuration or numbered code.
Iterator children retain their nesting; disabled rows show that they are skipped.
Iterator rules also show whether any or all iterations must accept, and whether
processing stops as soon as that result is determined.
Mapper and Message Builder replacements are shown in order. XSLT steps include
the source and stylesheet expressions, their literal map reads, and an enabled
custom transformer factory. JavaScript attachment handlers appear before
preprocessing, including their source and literal map references.
Each destination has Filter, Transform, Send, and Handle the response substeps.
Source, destination, and response outbound templates are included even when no
transformer steps are configured. They initialize `tmp`, whose final value
supplies that transformer's output.

Database Reader post-process scripts and SQL appear with their configured
per-row or after-poll timing, including aggregated results. Enabled scripts
also contribute to the map-key reference.
SQL mode's **Once After All Results** update runs after each poll, including
empty or failed polls. JavaScript aggregation applies to a returned `ResultSet`;
a Java `List` dispatches rows individually and skips **Once After All Results**
post-processing while **Aggregate Results** is enabled. Data-type JavaScript
properties retain their source text, including primitive-looking values such as
`false` and `null`.

**Open in Summary**, **Open in Source**, **Open in Destinations**, and
**Open in Scripts** return to the corresponding editable tab. The table of
contents follows the reading position on wider screens.

- **Find in channel** highlights matching settings, rows, and map keys and opens
  matching code rows. Press **Enter** to move through matches and **Escape** to
  clear the search.
- Click a numbered stage's number or heading to fold or unfold its contents.
  These stage states are independent of **Show all code**, **Expand all**, and
  **Collapse all**, which control the code and detail disclosures inside them.
  Find and navigation reveal their target stage; printing always includes all stages.
  Long scripts also provide **Show full script**.
- Map-key buttons link to **Maps and variables**; its writer and reader links
  return to the associated rows. The reference uses enabled steps and scripts.
  Separate destination connector maps still hold separate values even when the
  same key appears in both.
  Long lists of references collapse behind a reference count; open the list to
  follow any writer or reader. Printing includes every reference, with the key
  and map repeated when its reference list continues onto another page.
- **Include global scripts** reads the latest saved global scripts when the
  current user has permission. The context line distinguishes loading,
  inclusion, exclusion, missing permission, and read failure. A failed read offers
  **Retry global scripts**. Unsaved edits in the Global Scripts editor are not
  included.
- **Print** opens a document preview with all details and full scripts, including
  disabled destinations. Use **Print / Save PDF** to print the document or save it
  as a PDF. **Back to Inspector** returns without changing the editor disclosures
  or channel configuration.

This is a static explanation of configuration, not a runtime execution trace.
Map references approximate literal keys, including Mapper variables and calls
such as `$c('key')` and `channelMap.put('key', value)`. Dynamic keys and code
template internals are not resolved. A missing writer does not prove a value is
absent, and routing code can change which destinations an individual message
reaches.

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
