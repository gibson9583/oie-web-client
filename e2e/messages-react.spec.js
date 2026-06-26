import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * Focused e2e for the React message browser (web-administrator/client/react/
 * views/messages.jsx). Covers: the paginated results table renders the message
 * id + per-connector source/destination rows, the Message Tasks pane shows the
 * Swing-parity buttons in order, selection gates Remove/Reprocess Message, the
 * status filter dropdown opens, and Send Message opens the editor dialog.
 *
 * The Export Results ZIP flow is covered by export.spec.js (which must keep
 * passing); this spec deliberately does not re-test it.
 */

const CID = 'c-started';

// A message with a source (metaDataId 0) and one destination (metaDataId 1),
// in the XStream Map<Integer,ConnectorMessage> wire shape the client decodes.
const MESSAGE = {
    messageId: '12345',
    channelId: CID,
    serverId: 's1',
    receivedDate: { time: 1700000000000 },
    processed: true,
    connectorMessages: {
        entry: [
            {
                int: 0,
                connectorMessage: {
                    metaDataId: 0,
                    connectorName: 'Source',
                    status: 'RECEIVED',
                    receivedDate: { time: 1700000000000 },
                    raw: { content: 'MSH|^~\\&|SENDER|FAC|RECV|FAC|20231101||ADT^A01|MSG00001|P|2.3' }
                }
            },
            {
                int: 1,
                connectorMessage: {
                    metaDataId: 1,
                    connectorName: 'HTTP Sender',
                    status: 'SENT',
                    receivedDate: { time: 1700000001000 },
                    sendDate: { time: 1700000002000 },
                    sendAttempts: 1,
                    encoded: { content: '<encoded>payload</encoded>', dataType: 'XML' }
                }
            }
        ]
    }
};

const MESSAGE_FIXTURES = {
    // Paginated search: the one message on the first batch, empty after.
    [`GET /channels/${CID}/messages`]: (req) => {
        const offset = Number(new URL(req.url()).searchParams.get('offset') || 0);
        return { list: { message: offset > 0 ? [] : [MESSAGE] } };
    },
    [`GET /channels/${CID}/messages/count`]: { long: 1 },
    // Connector names map (metaDataId -> name) for the Connector dropdown + dialogs.
    [`GET /channels/${CID}/connectorNames`]: { map: { entry: [
        { int: 0, string: 'Source' },
        { int: 1, string: 'HTTP Sender' }
    ] } },
    [`GET /channels/${CID}/metaDataColumns`]: '',
    // Channel name lookup for the 'Channel Messages - <name>' banner title.
    'GET /channels/idsAndNames': { map: { entry: [{ string: [CID, 'Demo Started'] }] } },
    // Full message + attachments fetched when a row is selected (detail pane).
    [`GET /channels/${CID}/messages/12345`]: MESSAGE,
    [`GET /channels/${CID}/messages/12345/attachments`]: ''
};

test.beforeEach(async ({ page }) => {
    await mockEngine(page, MESSAGE_FIXTURES);
});

test('renders results and the Message Tasks pane', async ({ page }) => {
    await page.goto(`/messages/${CID}`);

    // Auto-search populated the grid with the source row's message id.
    await expect(page.getByText('12345', { exact: true })).toBeVisible();
    // Destinations expand by default — the destination connector row is visible.
    await expect(page.getByText('HTTP Sender', { exact: true })).toBeVisible();

    // Message Tasks pane — Swing-parity buttons, always-visible ones.
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send Message', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import Messages', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export Results', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove All Messages', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove Results', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reprocess Results', exact: true })).toBeVisible();
});

test('selection gates Remove/Reprocess Message', async ({ page }) => {
    await page.goto(`/messages/${CID}`);
    await expect(page.getByText('12345', { exact: true })).toBeVisible();

    // Hidden until a message is selected.
    await expect(page.getByRole('button', { name: 'Remove Message', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reprocess Message', exact: true })).toHaveCount(0);

    // Click the source row → selection-gated tasks appear.
    await page.getByText('12345', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Remove Message', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reprocess Message', exact: true })).toBeVisible();

    // Detail pane loaded the message content tabs (Raw is the first content tab).
    await expect(page.getByRole('button', { name: 'Raw', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mappings', exact: true })).toBeVisible();
});

test('status filter dropdown opens with the Swing statuses', async ({ page }) => {
    await page.goto(`/messages/${CID}`);
    await expect(page.getByText('12345', { exact: true })).toBeVisible();

    // The compact status trigger reads "Any" (plus a ▾ caret) until a status is
    // chosen — open its checklist of the Swing statuses. Scope assertions to the
    // dropdown menu so they don't collide with the status tags in the table.
    await page.getByRole('button', { name: /^Any/ }).click();
    const menu = page.locator('.ctx-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByText('RECEIVED', { exact: true })).toBeVisible();
    await expect(menu.getByText('QUEUED', { exact: true })).toBeVisible();
    await expect(menu.getByText('PENDING', { exact: true })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Clear (Any)' })).toBeVisible();
});

test('Send Message opens the editor dialog', async ({ page }) => {
    await page.goto(`/messages/${CID}`);
    await expect(page.getByText('12345', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Send Message', exact: true }).click();
    // The dialog offers the destination table and the Process Message action.
    await expect(page.getByRole('button', { name: 'Process Message', exact: true })).toBeVisible();
    await expect(page.getByText('Send to the following destination(s):')).toBeVisible();
});

test('sets the channel-name banner title', async ({ page }) => {
    await page.goto(`/messages/${CID}`);
    await expect(page.getByText('12345', { exact: true })).toBeVisible();
    // webadmin:set-title fires 'Channel Messages - Demo Started' once the name loads.
    await expect(page.getByText('Channel Messages - Demo Started')).toBeVisible();
});
