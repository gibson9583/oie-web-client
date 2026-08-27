# Settings

Settings is a tabbed administration workspace. Tabs share a settings-wide write
lock so one save or destructive operation can reconcile before another begins.

## Server

![Server settings](https://raw.githubusercontent.com/wiki/gibson9583/oie-web-client/images/settings-server.png)

Server settings include environment identity, SMTP, session/logout behavior,
default metadata, and related engine configuration. The task pane also provides:

- **Backup Config** — download a complete server configuration.
- **Restore Config** — replace server configuration from a selected backup.
- **Clear All Statistics** — reset server-wide counters.
- **Send Test Email** — validate SMTP configuration.

Backup files are sensitive. Restore is application-wide and may replace
channels, alerts, properties, and related state. If its response is ambiguous,
resolve/reconcile it before any later write.

## Administrator

![Administrator preferences and live preview](https://raw.githubusercontent.com/wiki/gibson9583/oie-web-client/images/settings-administrator.png)

Administrator preferences include:

- dashboard refresh interval;
- message/event page sizes;
- message formatting and destructive-action confirmations;
- import/export code-template behavior;
- default channel and alert builders;
- table density;
- theme, environment color, UI font, and data font.

The preview renders pending table density, theme/color, UI typography, and
monospaced table data before Save. Preferences are per user where supported;
saved data-font changes also apply to code editors and other monospaced content.

## Tags

Create color-coded tags and assign channels. Select a tag to edit its name,
color, and membership. Saving replaces the server tag set, so refresh and resolve
concurrent changes before overwriting.

## Configuration Map

Edit key/value/comment entries used by channels and scripts. Values can be
masked because configuration maps often contain credentials or endpoints.
Import/export operates on the complete map; protect exported files.

## Database Tasks

Review available maintenance tasks and their current state before Run or Cancel.
These can be long-running. A timeout does not prove a task failed to start; refresh
task state before retrying.

## Resources

Manage shared resource definitions and defaults used by connectors. Resource
configuration is a full-set write and can contain secrets. Compare action-time
state when another administrator may be editing it.

## Data Pruner

The first-party Data Pruner tab configures message pruning/archive schedules and
manual prune operations when the engine extension is installed. Verify archive
paths, encryption, retention, channel scope, and current task status before a
manual run.
