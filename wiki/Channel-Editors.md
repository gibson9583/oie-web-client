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

Message trees and engine-side validation require native support or the optional
Web Support plugin. Format Document is performed locally in the browser.

## Concurrency and save conflicts

Editors compare the render-time channel with action-time server state. If another
administrator changed it, review the conflict rather than automatically
overwriting. After a lost response, refresh/reconcile before retrying: the write
may have committed even though the browser did not receive the response.

