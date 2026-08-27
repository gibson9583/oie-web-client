# Messages

The Messages screen searches channel message history and opens connector-level
content. Message bodies can contain PHI, credentials, or other sensitive data;
use the minimum access required by your role.

![Message search and detail](https://raw.githubusercontent.com/wiki/gibson9583/oie-web-client/images/messages.png)

## Search

1. Choose a channel.
2. Add start/end dates, status, text, regex, connector, and advanced metadata
   criteria as needed.
3. Choose a page size and run Search.
4. Expand a message to see source and destination connector rows.

Explicit PHI-oriented searches and message access can be audited by the engine.
Use narrow criteria to reduce both result size and exposure.

## Detail pane

Select a source or destination row to load its content tabs. Depending on the
connector and engine data, tabs can include Raw, Processed Raw, Transformed,
Encoded, Sent, Response, Mappings, Errors, and Attachments. **Copy** uses the
currently visible content.

Message Trees appear when native engine endpoints or Web Support provide exact
serialization. Text formatting is client-side and can be controlled in
Administrator preferences.

## Message tasks

- **Send Message** submits a new message to the selected channel.
- **Import Messages** prepares and submits complete top-level message blocks.
- **Export Results** exports browser or server-side results and records audit
  events around sensitive exports.
- **Reprocess Message/Results** runs existing message data through the channel.
- **Remove Message/Results/All** permanently removes stored message data.
- **Select for Compare** and **Compare to Selection** compare related content.

## Partial and unknown outcomes

Bulk import/reprocess/removal can complete a prefix before a later item fails.
The UI retains recovery state when it cannot prove whether the current request
committed. Follow the offered Reconcile, Verified Committed, Skip, or Verified
Not Committed path; do not restart the whole file or repeat a destructive query
without verifying the engine first.

Exports and downloaded files are outside the application after creation. Store
them according to your organization’s PHI and retention policies.

