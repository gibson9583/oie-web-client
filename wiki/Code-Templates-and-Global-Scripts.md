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
selected library. Imports without stable IDs require extra care after partial or
ambiguous failures; use the retained recovery payload instead of parsing the
file again and generating new IDs.

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

Import replaces the complete global script set. Export before making changes,
and treat timeout/5xx responses as potentially committed until a server refresh
proves otherwise.

