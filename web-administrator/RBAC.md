# Role-Based Access Control (RBAC) — menu/permission hooks

The web administrator ports OIE's Swing **`AuthorizationController`** hook so a
third-party RBAC plugin can **hide menu items the current user isn't authorized for**
— left-nav entries, task-pane buttons, and right-click context-menu items.
Built-in routes also check those permissions before loading or mounting a view,
so a restricted bookmark displays **Access denied** without starting the view's
data requests.

With **no RBAC plugin installed the UI is unchanged** (everything is permitted). A
plugin opts in by registering a controller; the controller is asked, per item,
whether the user may see it.

This hook controls discoverability in the browser; it is **not a security
boundary**. Engine or plugin endpoints must independently authorize every
request. Never rely on a hidden task to protect an operation.

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

Semantics (`client/core/authorization.ts`):

- **`checkTask(group, task)` returning `false` hides** the matching nav item, task
  button, and its right-click twin. Any other return value shows it.
- A successfully discovered engine with no authorization controller keeps the
  default unrestricted UI. Untagged items remain visible. A controller that throws
  denies the tagged task; an initialization failure also denies access.
- Discovery must finish before views mount. Discovery or manifest failures block
  startup with a reload action. API 4.9 recognizes `"authorization": true` in a
  manifest so it knows a provider is required even when its module cannot load.
  Providers with another ID must declare it; legacy `id: "rbac"` is recognized
  without a manifest change. Ordinary plugins need no marker.
- Required providers register first, retaining their relative manifest order;
  ordinary plugins then register in their relative order. During registration,
  `platform.checkTask` reflects the installed controller, so plugins can still
  conditionally register their panels or actions. With a required provider,
  checks deny until a controller is installed. Views, navigation and the command
  palette remain unavailable until the whole bootstrap succeeds.
- Missing/incompatible provider modules, failed registration, or registration
  without a valid controller block startup. Ordinary module failures, and
  registration failures that do not modify authorization, stay isolated. An unreadable or
  invalid manifest blocks startup because its provider status is unknown.
- A task without a group is still checked with `''` as its group. Task buttons
  check again on invocation; multi-step handlers must also check after their own
  asynchronous prompts before performing a restricted action.
- **Built-in route entry** uses the same checks, including direct URLs and browser
  history. Nested editors require both their parent view permission and their
  entry action (for example, `view/doShowChannel` and `channel/doEditChannel`).
  Permissions are checked again after a lazy view module finishes loading.
  Create/edit checks follow the matching editor draft and its persistence state;
  `?new=1` alone does not grant creation access to an existing record. Wizard
  checks use decoded route parameters, including encoded aliases of `new`.
  Explicit New commands start a fresh draft; builder handoffs retain the current
  model. If a denied or still-loading destination leaves a dirty draft without
  an editor guard, the shell requires confirmation before replacing or leaving
  that draft. Returning to the same model preserves it.
- **Palette destinations** require the same view/action prerequisites as their
  routes. Commands may declare additional `permissions: [[group, task], ...]`;
  every pair must pass along with the existing `task`/`rbac` pair and any
  `visible()` predicate. Checks run when entries are built and again before
  activation. Template suggestions, search, recents, and their background
  library reads also require route access.
- There is one current controller; a later registration replaces it. Register
  yours in `register(platform)` (which runs during plugin load, before views
  mount).

Failing closed on discovery/controller errors intentionally replaces the old
permissive error behavior. The controller and `register(platform)` signatures
are unchanged, and this changes no engine endpoint or server authorization API.
Older hosts ignore the new marker; an `apiMin` requirement alone cannot give
them required-provider enforcement. Upgrade the host before relying on it.

### Implementing an RBAC plugin

A web plugin is a module exporting `register(platform)` (see `PLUGINS.md`). Drive
`checkTask` from whatever your server tells you about the user's roles:

```js
// plugins/rbac/web/plugin.ts
export async function register(platform) {
    // Plugin registration is page-scoped, while users can sign out and sign in
    // again without reloading the page. Default-deny while each user's
    // permissions are loading and reject stale responses from an older user.
    let generation = 0;
    let permitted = new Set();
    async function loadFor(user) {
        const mine = ++generation;
        permitted = new Set();
        if (!user) return;
        try {
            const allowed = await platform.api.get('/extensions/rbac/permissions');
            if (mine === generation && platform.store.getState('user') === user) {
                permitted = new Set(allowed.map((p) => `${p.group}:${p.task}`));
            }
        } catch {
            // Remain deny-all. Endpoint authorization remains authoritative.
        }
    }

    platform.setAuthorizationController({
        checkTask(group, task) {
            return permitted.has(`${group}:${task}`);
        },
    });
    platform.store.subscribe('user', (user) => { void loadFor(user); });
    await loadFor(platform.store.getState('user'));
}
```

The host calls `checkTask` synchronously while rendering, so resolve your permission
data **inside `register` (before returning)**. Because plugin registration is
page-scoped, also clear and reload permission state whenever `store.user` changes;
never carry one user's cached permissions into a later soft login.

---

## 2. Where it's enforced

| Surface | How an item is tagged | File |
| --- | --- | --- |
| **Left nav** (Dashboard, Channels, …) | `registerNavItem({ …, task, rbac })` — group defaults to `view`; Code Templates and Global Scripts use `channel` | `client/react/nav-rail.tsx` |
| **Built-in routes** | Navigation task plus any nested route entry tasks; denial replaces the view without mounting it | `client/react/shell.tsx` (`VIEW_ROUTES`) |
| **Command palette** | Command `task`/`rbac` plus all `permissions`; built-in destinations share route prerequisites | `client/core/route-tasks.ts`, `client/react/command-palette.tsx` |
| **Settings tabs** (built-in and plugin) | `settings_<label>/doRefresh` OR `doSave`; no visible tabs displays an access-denied state | `client/react/views/settings.tsx` |
| **Task-pane buttons** (React) | `<TaskButton task="…" />`; the pane's `<RailPane group="…">` supplies the group via context | `client/react/ui.tsx` |
| **Task-pane buttons** (imperative, used by Settings) | `taskButton(label, icon, onClick, { task, group })` | `client/core/ui.ts` |
| **Right-click context menus** | each item `{ label, task, group, … }`; `contextMenu(x, y, items, group)` can supply a default group for all items | `client/core/ui.ts` (`contextMenu`) |

A task button and the context-menu item that performs the same action carry the **same
`(group, task)`**, so denying it hides both — exactly Swing's paired
task/`JPopupMenu` behavior.

The built-in route checks do not automatically protect routes contributed through
`platform.registerView`. Plugins must check their own route permissions before
mounting content or starting requests. Server-side authorization remains required
for every endpoint, including resource-level restrictions within an allowed view.
After permissions recover or change, navigate to the page again (or reload) to
re-evaluate route access. Mounted Settings views, the navigation rail, and the
command palette refresh their available items when the provider publishes a
`webPlugins` notification. Replacing the controller through
`platform.setAuthorizationController` publishes that notification automatically;
changing permission data within an existing controller requires the provider to
publish it. This notification does not automatically reroute the current view.

---

## 3. Permission catalog

`taskName` — Menu label. Identifiers are verbatim from Swing `TaskConstants`.

### `view` — top-level navigation
- `doShowDashboard` — Dashboard
- `doShowChannel` — Channels
- `doShowMessages` — Messages
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
- `doEditGlobalScripts` — Global Scripts navigation
- `doEditCodeTemplates` — Code Templates navigation
- `doRefreshChannels` — Refresh
- `doRedeployAll` — Redeploy All
- `doDeployChannel` — Deploy Channel *(Debug Channel is `channelEdit/doDebugDeployFromChannelView`, in the channel editor)*
- `doNewChannel` — New Channel · `doImportChannel` — Import Channel
- `doExportAllChannels` — Export All Channels · `doExportChannel` — Export Channel
- `doDeleteChannel` — Delete Channel · `doCloneChannel` — Clone Channel
- `doEditChannel` — Edit Channel
- `doEnableChannel` — Enable Channel · `doDisableChannel` — Disable Channel
- `doViewMessages` — View Messages

### `channelGroup` — Group Tasks (Channels view)
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
- `doSelectForCompare` — Select for Compare · `doCompareWithSelection` — Compare to
  Selection (task pane + the content-tab and row right-click menus). Neither grants
  any access of its own: comparing content is reading message content, which the
  engine authorizes per fetch. Deny them to remove the compare workflow from the UI.
- Plugin actions registered through `platform.registerMessageAction` carry their own
  `task` under this group; the Message Tasks button and the row menu item hide together.

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
- `goToUserAPI` — View REST API
- `goToAbout` — About
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
- **`settings_Data Pruner`** — `doRefresh` (View Settings), `doSave` (Save Settings), `doStart` and `doStop` (Start / Stop). These require scoped mappings because the bare start/stop names also identify channel controls.
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
- **Web-only mutation items with no Swing constant ride an existing task** whose
  permission covers them (the pattern RBAC.md §3 established for the Config Map
  *Add Row*):
  - extensions *Install Extension* → `extensions/doRefreshExtensions` (every
    extensions task maps to `manageExtensions`)
  - settings (Tags) *Add/Edit/Remove Tag* → `settings_Tags/doSave`
  - settings (Configuration Map) row menu *Insert/Delete Row* →
    `settings_Configuration Map/doSave`
  - filter/transformer editor *Add/Delete/Move step, Assign/Remove Iterator,
    Import* → `channelEdit/doSaveChannel` (editing steps is meaningless without
    channel-save rights); *Export/Validate* stay untagged (view affordances)
  - wizard footers (*Create/Save*, *… & Deploy*) and the wizards' leave prompt hide
    Save via `channelEdit/doSaveChannel` / `doDeployFromChannelView` /
    `alertEdit/doSaveAlerts`; the classic channel editor's leave prompt swaps to an
    OK-only notice the same way
- **Web-only view affordances are intentionally left untagged** (pure navigation or
  read-only actions):
  - channel editor: *Back to Channels*, *Open in Wizard* (the wizard's own save
    affordances are gated, above)
  - alert editor: *Back to Alerts*, *Enable*, *Disable*, *Add Action*, *Delete
    Action* (the editor is unreachable without `manageAlerts`)
  - users: *Change Password* (view unreachable without `manageUsers`)
  - events: *Search*

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

The `(group, task)` pair is a typed model — **`TaskRef` in `@oie/web-ui`** — shared by
every actionable surface: `ContextMenuItem` and `taskButton` opts extend it, and
`NavItem`/`DashboardTab` in `@oie/web-shell` carry its `task` field (navigation defaults
to `view`, with an optional `rbac` group override; dashboard tabs use `dashboard`).
`type-tests/` guards the surface.

1. Pick the `(group, task)` — reuse a Swing identifier from the catalog where one fits.
2. **Nav:** add `task: '<doShow…>'` to `registerNavItem({ … })` (group defaults to `view`).
3. **Dashboard tab:** add `task: '<…>'` to `registerDashboardTab({ … })` (group is
   `dashboard`; extension-published task names resolve through the merge).
4. **React task button:** ensure the pane is `<RailPane group="<key>">` and add
   `<TaskButton task="<do…>" … />`.
5. **Imperative task button (Settings):** `taskButton(label, icon, onClick, { task, group })`.
6. **Context-menu item:** add `task`/`group` to the item, or pass a default group as the
   4th arg of `contextMenu(x, y, items, group)`. Tag it with the **same** `(group, task)`
   as its task-button twin so both hide together.

Tests: `client/core/authorization.test.js` (the hook) and `e2e/rbac.spec.ts` (a plugin
denying each built-in route prerequisite, empty and read-only Settings, permission
load failures, navigation races, draft handoffs, encoded wizard aliases, and palette
render/activation checks; the no-controller case stays visible).
