# Dashboard

The Dashboard is the operational starting point. It combines current channel
state, message statistics, connector state, tags, and first-party monitoring
tabs.

![Dashboard table view](https://raw.githubusercontent.com/wiki/gibson9583/oie-web-client/images/dashboard-table.png)

## Table view

- Expand a channel to inspect its connectors.
- Select one or more channels for lifecycle operations.
- Sort and resize columns; use **View** to control optional columns and cards.
- Filter by channel or tag from the bottom bar.
- Switch current/lifetime statistics when that option is available.

Lifecycle tasks are state-aware. For example, Start appears for stopped or
paused selections, while Pause appears for started selections. Halt is an
emergency action and is intentionally more restrictive than Stop.

## Card view

Choose **Card view** in the Dashboard task pane for a denser at-a-glance layout.

![Dashboard card view](https://raw.githubusercontent.com/wiki/gibson9583/oie-web-client/images/dashboard-cards.png)

Cards preserve group/tag organization, status, message counters, selection, and
the same lifecycle actions as the table. The preference is saved in the browser.

## Monitoring tabs

The lower area hosts first-party operational tabs when their bundled plugins are
loaded:

- **Server Log** — recent engine log records with pause, clear, and log-size
  controls.
- **Connection Log** — connector connection-state changes and details.
- **Global Maps** — current global and global-channel map entries.

These tabs are live operational views, not durable audit history. Use Events for
audited administrative actions and the server’s normal log retention for longer
investigation.

## Common operational workflows

### Start or stop channels

1. Select the target channels.
2. Confirm that every target is in the expected current state.
3. Choose Start, Pause, Stop, Halt, Deploy, or Undeploy as appropriate.
4. Wait for the status refresh before repeating another lifecycle operation.
5. Review the Events screen when an action fails or completes only partially.

### Open messages or edit a channel

Double-click a channel, use its context menu, or select it and choose the task:

- **View Messages** opens the message browser scoped to that channel.
- **Edit Channel**, **Edit Filter**, and **Edit Transformer** open design views.
- **Send Message** opens a controlled message submission dialog.

### Clear statistics or remove messages

These actions create a time boundary. New messages or counters can arrive while
you are deciding what to do, so read the confirmation carefully and do not
blindly repeat an action after a timeout. See
[Operations and Safety](https://github.com/gibson9583/oie-web-client/wiki/Operations-and-Safety).
