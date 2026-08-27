# Operations and Safety

OIE administration combines normal form edits with destructive, multi-step, and
long-running engine operations. Use these rules in production.

## Before a write

1. Confirm the environment badge and server name.
2. Refresh the target view when another administrator may be active.
3. Verify the exact selected rows, filters, channel IDs, and current states.
4. Back up complete configuration before broad replacement operations.
5. Avoid handling message content outside approved PHI workflows.

## During a write

- Leave the view open while its busy state or recovery prompt is active.
- Do not open a second tab to repeat the same operation.
- Treat a partial-completion summary as authoritative about completed phases.
- Wait for the post-write refresh before starting a conflicting operation.

## Timeouts and network failures

A network error, HTTP 408/429/5xx, or closed browser does not prove the engine
rolled back. The request may have committed before the response was lost.

When the UI reports an unknown outcome:

1. Inspect current engine state independently.
2. Use **Accept/Reconcile Current State** when the operation committed.
3. Use **Verified Committed — Skip** to advance an exact batch cursor.
4. Use **Verified Not Committed — Retry** only after proving the write did not
   happen.
5. Preserve any exact recovery payload/cursor; do not restart an ID-less import.

## Destructive time boundaries

Remove Results, Remove All Messages, Clear Statistics, restore, export, and
server maintenance operate against a time-defined target. Repeating them later
can affect new messages or counters that did not exist during the first request.

## Audit review

Use Events to verify:

- user and extension administration;
- deploy/redeploy/start/stop actions;
- message search, access, export, reprocess, and removal;
- configuration backup/restore and settings changes;
- partial or failed operations.

UI task hiding is not authorization. The engine and every plugin endpoint must
enforce permissions server-side.

