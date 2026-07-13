# Role-Based Access Control (RBAC) — menu/permission hooks

The web administrator ports OIE's Swing **`AuthorizationController`** hook so a
third-party RBAC plugin can **hide menu items the current user isn't authorized for**
— left-nav entries, task-pane buttons, and right-click context-menu items.

With **no RBAC plugin installed the UI is unchanged** (everything is permitted). A
plugin opts in by registering a controller; the controller is asked, per item,
whether the user may see it.

This mirrors Swing exactly: the identifiers below are the same `(taskGroup, taskName)`
pairs Swing's `Frame.setVisibleTasks` checks (see
`com.mirth.connect.client.ui.AuthorizationController` /
`AuthorizationControllerFactory` and `TaskConstants` in the engine repo).

---

## 1. The hook

```js
platform.setAuthorizationController({
    initialize() { /* optional: called once when registered */ },
    checkTask(taskGroup, taskName) {
        // return false to HIDE the item; anything else (true/undefined) shows it
    },
});
```

Semantics (`client/core/authorization.js`):

- **`checkTask(group, task)` returning `false` hides** the matching nav item, task
  button, and its right-click twin. Any other return value shows it.
- **Fail-open.** A missing controller, an untagged item (no `group`/`task`), or a
  controller that throws all resolve to *visible* — exactly like Swing's
  `DefaultAuthorizationController`. RBAC can only ever *remove* options, never break
  the UI.
- The controller is a **singleton**, set once. Register it in your plugin's
  `register(platform)` (which runs during plugin load, before views mount).

### Implementing an RBAC plugin

A web plugin is a module exporting `register(platform)` (see `PLUGINS.md`). Drive
`checkTask` from whatever your server tells you about the user's roles:

```js
// plugins/rbac/web/plugin.js
export async function register(platform) {
    // Fetch the user's allowed tasks however your backend exposes them.
    const allowed = await platform.api.get('/extensions/rbac/permissions'); // your endpoint
    const permitted = new Set(allowed.map((p) => `${p.group}:${p.task}`));

    platform.setAuthorizationController({
        checkTask(group, task) {
            return permitted.has(`${group}:${task}`);
        },
    });
}
```

The host calls `checkTask` synchronously while rendering, so resolve your permission
data **inside `register` (before returning)** or default-deny only once it's loaded.

---

## 2. Where it's enforced

| Surface | How an item is tagged | File |
| --- | --- | --- |
| **Left nav** (Dashboard, Channels, …) | `registerNavItem({ …, task })` — group is always `view` | `client/react/shell.jsx` (`Nav`) |
| **Task-pane buttons** (React) | `<TaskButton task="…" />`; the pane's `<RailPane group="…">` supplies the group via context | `client/react/ui.jsx` |
| **Task-pane buttons** (imperative, used by Settings) | `taskButton(label, icon, onClick, { task, group })` | `client/core/ui.js` |
| **Right-click context menus** | each item `{ label, task, group, … }`; `contextMenu(x, y, items, group)` can supply a default group for all items | `client/core/ui.js` (`contextMenu`) |

A task button and the context-menu item that performs the same action carry the **same
`(group, task)`**, so denying it hides both — exactly Swing's paired
task/`JPopupMenu` behavior.

---

## 3. Permission catalog

`taskName` — Menu label. Identifiers are verbatim from Swing `TaskConstants`.

### `view` — top-level navigation
- `doShowDashboard` — Dashboard
- `doShowChannel` — Channels
- `doShowUsers` — Users
- `doShowSettings` — Settings
- `doShowAlerts` — Alerts
- `doShowEvents` — Events
- `doShowExtensions` — Extensions

### `dashboard` — Dashboard Tasks (+ status/connector right-click)
- `doRefreshStatuses` — Refresh
- `doSendMessage` — Send Message
- `doShowMessages` — View Messages
- `doRemoveAllMessages` — Remove All Messages
- `doClearStats` — Clear Statistics
- `doStart` — Start · `doPause` — Pause · `doStop` — Stop · `doHalt` — Halt
- `doUndeployChannel` — Undeploy Channel
- `doStartConnector` — Start Connector · `doStopConnector` — Stop Connector

### `channel` — Channel Tasks (Channels view)
- `doRefreshChannels` — Refresh
- `doRedeployAll` — Redeploy All
- `doDeployInDebug` — Debug Channel · `doDeployChannel` — Deploy Channel
- `doEditGlobalScripts` — Edit Global Scripts · `doEditCodeTemplates` — Edit Code Templates
- `doNewChannel` — New Channel · `doImportChannel` — Import Channel
- `doExportAllChannels` — Export All Channels · `doExportChannel` — Export Channel
- `doDeleteChannel` — Delete Channel · `doCloneChannel` — Clone Channel
- `doEditChannel` — Edit Channel
- `doEnableChannel` — Enable Channel · `doDisableChannel` — Disable Channel
- `doViewMessages` — View Messages

### `channelGroup` — Group Tasks (Channels view)
- `doSaveGroups` — Save Group Changes
- `doAssignChannelToGroup` — Assign To Group / Move to Group…
- `doNewGroup` — New Group · `doEditGroupDetails` — Edit Group Details
- `doImportGroup` — Import Group
- `doExportAllGroups` — Export All Groups · `doExportGroup` — Export Group
- `doDeleteGroup` — Delete Group

### `channelEdit` — channel editor
- `doSaveChannel` — Save Changes · `doValidate` — Validate Connector
- `doNewDestination` — New Destination · `doDeleteDestination` — Delete Destination
- `doCloneDestination` — Clone Destination
- `doEnableDestination` — Enable Destination · `doDisableDestination` — Disable Destination
- `doMoveDestinationUp` — Move Dest. Up · `doMoveDestinationDown` — Move Dest. Down
- `doImportConnector` — Import Connector · `doExportConnector` — Export Connector
- `doExportChannel` — Export Channel
- `doValidateChannelScripts` — Validate Script
- `doDebugDeployFromChannelView` — Debug Channel · `doDeployFromChannelView` — Deploy Channel
- `doEditFilter` — Edit Filter · `doEditTransformer` — Edit Transformer ·
  `doEditResponseTransformer` — Edit Response (task pane + destination right-click;
  the Dashboard channel menu's Edit Filter/Transformer items carry this
  `channelEdit` group explicitly, so a Swing policy hiding them applies there too)

### `message` — Message Tasks (message browser)
- `doRefreshMessages` — Refresh · `doSendMessage` — Send Message
- `doImportMessages` — Import Messages · `doExportMessages` — Export Results
- `doRemoveAllMessages` — Remove All Messages · `doRemoveFilteredMessages` — Remove Results
- `doRemoveMessage` — Remove Message
- `doReprocessFilteredMessages` — Reprocess Results · `doReprocessMessage` — Reprocess Message
- `viewImage` — View Attachment · `doExportAttachment` — Export Attachment

### `alert` — Alert Tasks
- `doRefreshAlerts` — Refresh · `doNewAlert` — New Alert
- `doImportAlert` — Import Alert · `doExportAlerts` — Export All Alerts · `doExportAlert` — Export Alert
- `doDeleteAlert` — Delete Alert · `doEditAlert` — Edit Alert
- `doEnableAlert` — Enable Alert · `doDisableAlert` — Disable Alert

### `alertEdit` — alert editor
- `doSaveAlerts` — Save Alert · `doExportAlert` — Export Alert

### `user` — User Tasks
- `doRefreshUser` — Refresh · `doNewUser` — New User · `doEditUser` — Edit User · `doDeleteUser` — Delete User

### `event` — Event Tasks
- `doRefreshEvents` — Refresh · `doExportAllEvents` — Export All Events

### `codeTemplate` — Code Templates
- `doRefreshCodeTemplates` — Refresh · `doSaveCodeTemplates` — Save Changes / Save All
- `doNewCodeTemplate` — New Code Template · `doNewLibrary` — New Library
- `doImportCodeTemplates` — Import Code Templates · `doImportLibraries` — Import Libraries
- `doExportCodeTemplate` — Export Code Template · `doExportLibrary` — Export Library · `doExportAllLibraries` — Export All Libraries
- `doDeleteCodeTemplate` — Delete Code Template · `doDeleteLibrary` — Delete Library
- `doValidateCodeTemplate` — Validate Script

### `script` — Global Scripts
- `doSaveGlobalScripts` — Save Scripts · `doValidateCurrentGlobalScript` — Validate Script
- `doImportGlobalScripts` — Import Scripts · `doExportGlobalScripts` — Export Scripts

### `extensions` — Extensions
- `doRefreshExtensions` — Refresh
- `doEnableExtension` — Enable · `doDisableExtension` — Disable
- `doShowExtensionProperties` — Properties · `doUninstallExtension` — Uninstall

### `other` — the "Other" rail pane
- `goToUserAPI` — View REST API · `goToClientAPI` — View Client API
- `doHelp` — Help · `goToAbout` — About
- `goToMirth` — Visit homepage *(see Outliers)*
- `doReportIssue` — Report Issue · `doLogout` — Logout

### `settings_<Tab>` — Settings (one group per tab)
Shared on every tab: `doRefresh` — Refresh · `doSave` — Save.

- **`settings_Server`** — `doBackup` (Backup Config), `doRestore` (Restore Config), `doClearAllStats` (Clear All Statistics)
- **`settings_Administrator`** — `doSetAdminDefaults` (Restore Defaults)
- **`settings_Tags`** — (Refresh/Save only)
- **`settings_Configuration Map`** — `doImportMap` (Import Map), `doExportMap` (Export Map).
  The in-panel **Add Row** button also rides `doSave` (no separate identifier —
  adding a row is meaningless without save rights)
- **`settings_Database Tasks`** — `doRunDatabaseTask` (Run Task), `doCancelDatabaseTask` (Cancel Task)
- **`settings_Resources`** — `doAddResource` (Add Resource), `doRemoveResource` (Remove Resource), `doReloadResource` (Reload Resource)

---

## 4. Outliers & notes

- **`goToMirth` (group `other`, "Visit homepage")** — a Mirth branding leftover from
  Swing's `TaskConstants`; kept verbatim for 1:1 parity. In OIE the link points at the
  OIE engine repo, so the *name* is historical only. Rename later if Swing parity is
  dropped.
- **`message` uses non-`do…` actions** for two items: `viewImage` (View Attachment)
  and (consistent with Swing) the export actions — these are Swing's literal constant
  values, not a typo.
- **Settings groups are per-tab** (`settings_Server`, `settings_Tags`, …), not a single
  `settings` group, matching Swing's `SETTINGS_<Tab>_KEY`. `Refresh`/`Save` reuse the
  shared `doRefresh`/`doSave` action under each tab's group.
- **Code-templates "Delete"** (tree right-click) is tagged with a *dynamic* task —
  `doDeleteCodeTemplate` when a template is selected, `doDeleteLibrary` for a library —
  because the web admin folds Swing's two delete tasks into one menu item.
- **Web-only items with no Swing task are intentionally left untagged** (so they are
  *not* RBAC-hideable, since there is no canonical permission for them). If you need to
  gate these, add an OIE-specific `task`/`group` to them:
  - channel editor: *Back to Channels*
  - alert editor: *Back to Alerts*, *Enable*, *Disable*, *Add Action*, *Delete Action*
  - users: *Change Password*
  - events: *Search*
  - extensions: *Install Extension*
  - settings (Tags): *Add Tag*, *Remove Tag*

  (*Edit Filter / Transformer / Response* — in the channel editor and on the Dashboard
  channel menu — were previously in this list, but Swing **does** define
  `doEditFilter` / `doEditTransformer` / `doEditResponseTransformer`; they are now
  tagged under `channelEdit`. See the catalog above.)
- **Selection-gated imperative buttons** (Settings → Database Tasks "Run/Cancel Task",
  Resources "Remove Resource") may be `null` once hidden; their visibility helpers
  null-check before touching `classList`. Keep that pattern if you tag more imperative
  task buttons.

---

## 5. Adding RBAC to a new menu item

1. Pick the `(group, task)` — reuse a Swing identifier from the catalog where one fits.
2. **Nav:** add `task: '<doShow…>'` to `registerNavItem({ … })` (group is `view`).
3. **React task button:** ensure the pane is `<RailPane group="<key>">` and add
   `<TaskButton task="<do…>" … />`.
4. **Imperative task button (Settings):** `taskButton(label, icon, onClick, { task, group })`.
5. **Context-menu item:** add `task`/`group` to the item, or pass a default group as the
   4th arg of `contextMenu(x, y, items, group)`. Tag it with the **same** `(group, task)`
   as its task-button twin so both hide together.

Tests: `client/core/authorization.test.js` (the hook) and `e2e/rbac.spec.js` (a plugin
denying a nav item + a task; the no-controller case stays visible).
