# Code Templates and Global Scripts

## Code Templates

Code-template libraries organize reusable JavaScript functions and control which
channels receive them.

![Code Templates editor](https://raw.githubusercontent.com/wiki/gibson9583/oie-web-client/images/code-templates.png)

1. Select a library to edit its name, description, and channel association.
2. Select a template to edit code, context set, and template metadata.
3. Validate or format the script.
4. Save all pending library/template changes as one bulk operation.

Import and export can operate on complete libraries or templates within a
selected library. **Import Libraries** adds to the existing collection. Matching
IDs offer **Overwrite**, **Import as Copy**, or keeping the existing item;
conflicting names must be renamed.
Overwriting a library merges its templates and channel associations, preserving
existing templates that are absent from the file. Other libraries are retained.

**Import Code Templates** uses the same template conflict choices. Importing a
template into another library creates a separate ID and keeps the original.

Save pending edits before importing. Both import actions read the current server
collection and use the engine's revision checks to detect intervening edits to
existing libraries and templates before the import saves.
Review conflicts again when retrying. A failed import can have partially saved;
the editor refreshes to show the server's state. Keep the page open when retrying
the same file after a failure so generated copy IDs can be reused.

External change notifications and manual Refresh never justify silently losing
dirty edits. Resolve the prompt or save/reconcile before replacing the editor
state.

## Global Scripts

![Global Scripts editor](https://raw.githubusercontent.com/wiki/gibson9583/oie-web-client/images/global-scripts.png)

Global Scripts contains the server-wide Deploy, Undeploy, Preprocessor, and
Postprocessor scripts. These affect all channels and should be changed under a
controlled deployment process.

1. Refresh to establish the latest server baseline.
2. Edit one script at a time and validate the intended behavior.
3. Save the complete script map.
4. Review Events and relevant channel behavior after deployment.

Import updates the scripts supplied by the file and keeps omitted script drafts.
Save commits the complete script map. Export before making changes,
and treat timeout/5xx responses as potentially committed until a server refresh
proves otherwise.
