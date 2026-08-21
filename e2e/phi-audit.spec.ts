import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * Cures Act functional audit operations. The engine writes "Accessed PHI",
 * "Queried PHI", "Export all messages" and "Successfully exported messages"
 * ServerEvents when the client posts to the four _audit* endpoints; the Swing
 * client posts them and the web client must too.
 *
 * Accessed/Queried are gated on the channel declaring a custom metadata column
 * named PATIENT_ID; the export pair fires on every export, ungated.
 */

const CID = 'c-started';
const MESSAGE = {
    messageId: '987654321', channelId: CID, serverId: 's1',
    connectorMessages: {
        entry: {
            int: 0,
            connectorMessage: {
                messageId: '987654321', metaDataId: 0, connectorName: 'Source', status: 'SENT',
                metaDataMap: { entry: [{ string: ['PATIENT_ID', 'PID-4242'] }] }
            }
        }
    }
};

/** Record every audit POST the page makes, keyed by operation. */
async function captureAudits(page: any) {
    const seen: { op: string; body: string }[] = [];
    await page.route('**/api/channels/_audit*', async (route: any) => {
        const req = route.request();
        seen.push({ op: new URL(req.url()).pathname.split('/').pop() as string, body: req.postData() || '' });
        await route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
    });
    return seen;
}

const patientIdColumn = { list: { metaDataColumn: [{ name: 'PATIENT_ID', type: 'STRING', mappingName: 'patientId' }] } };

test('viewing and searching a PATIENT_ID channel emits the PHI audit events', async ({ page }) => {
    await mockEngine(page, {
        [`GET /channels/${CID}/metaDataColumns`]: patientIdColumn,
        [`GET /channels/${CID}/messages`]: { list: { message: [MESSAGE] } },
        [`GET /channels/${CID}/messages/987654321`]: MESSAGE,
        [`GET /channels/${CID}/messages/987654321/attachments`]: { list: '' }
    });
    const audits = await captureAudits(page);

    await page.goto(`/messages/${CID}`);
    await expect(page.getByText('987654321')).toBeVisible();

    // The auto-search on load is a query against a PHI channel.
    await expect.poll(() => audits.filter(a => a.op === '_auditQueriedPHIMessage').length).toBeGreaterThan(0);

    // Opening the message in the detail pane is an access.
    await page.getByText('987654321').first().click();
    await expect.poll(() => audits.filter(a => a.op === '_auditAccessedPHIMessage').length).toBeGreaterThan(0);

    // The access event carries the patient id, channel and message id.
    const accessed = audits.find(a => a.op === '_auditAccessedPHIMessage')!.body;
    expect(accessed).toContain('PID-4242');
    expect(accessed).toContain('987654321');
});

test('a channel without a PATIENT_ID column emits no accessed/queried events', async ({ page }) => {
    await mockEngine(page, {
        [`GET /channels/${CID}/metaDataColumns`]: { list: { metaDataColumn: [{ name: 'ACCOUNT', type: 'STRING' }] } },
        [`GET /channels/${CID}/messages`]: { list: { message: [MESSAGE] } },
        [`GET /channels/${CID}/messages/987654321`]: MESSAGE,
        [`GET /channels/${CID}/messages/987654321/attachments`]: { list: '' }
    });
    const audits = await captureAudits(page);

    await page.goto(`/messages/${CID}`);
    await expect(page.getByText('987654321')).toBeVisible();
    await page.getByText('987654321').first().click();
    await expect(page.getByRole('button', { name: 'Export Results' })).toBeVisible();

    expect(audits.filter(a => a.op.includes('PHIMessage'))).toHaveLength(0);
});

test('exporting brackets the export with the audit pair, and a failed pre-audit aborts it', async ({ page }) => {
    let exportCalls = 0;
    await mockEngine(page, {
        [`GET /channels/${CID}/metaDataColumns`]: { list: { metaDataColumn: [] } },
        [`GET /channels/${CID}/messages`]: (req: any) => {
            const offset = Number(new URL(req.url()).searchParams.get('offset') || 0);
            return { list: { message: offset > 0 ? [] : [MESSAGE] } };
        },
        [`GET /channels/${CID}/messages/count`]: { long: 1 },
        [`GET /channels/${CID}/messages/987654321`]: '<message><messageId>987654321</messageId></message>',
        [`POST /channels/${CID}/messages/_export`]: () => { exportCalls++; return { int: 1 }; }
    });

    // First run: the pre-export audit fails, so the export must not happen.
    let failPreAudit = true;
    const audits: { op: string; body: string }[] = [];
    await page.route('**/api/channels/_audit*', async (route: any) => {
        const req = route.request();
        const op = new URL(req.url()).pathname.split('/').pop() as string;
        audits.push({ op, body: req.postData() || '' });
        if (op === '_auditExportMessages' && failPreAudit) {
            return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'audit log unavailable' }) });
        }
        await route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
    });

    await page.goto(`/messages/${CID}`);
    await expect(page.getByText('987654321')).toBeVisible();

    const openExportToServer = async () => {
        await page.getByRole('button', { name: 'Export Results' }).click();
        await expect(page.getByText('File Pattern:')).toBeVisible();
        await page.getByRole('radio', { name: 'Server' }).check();
        await page.getByPlaceholder('/path/accessible/by/server').fill('/tmp/exports');
        await page.getByRole('button', { name: 'Export', exact: true }).click();
    };

    await openExportToServer();
    await expect(page.getByText(/audit event could not be written/i)).toBeVisible();
    expect(exportCalls).toBe(0);
    expect(audits.filter(a => a.op === '_auditExportMessagesSuccess')).toHaveLength(0);

    // toast(..., 'error') renders a MODAL in this app, not a corner toast, and while
    // it is up the export dialog behind it is inert. Dismiss it, then retry: the
    // export dialog is still open with its fields intact, because a blocked
    // pre-audit returns before anything is disabled or closed.
    await page.locator('.modal-foot').getByRole('button', { name: 'Close', exact: true }).click();
    failPreAudit = false;
    await page.getByRole('button', { name: 'Export', exact: true }).click();

    await expect.poll(() => exportCalls).toBe(1);
    await expect.poll(() => audits.filter(a => a.op === '_auditExportMessagesSuccess').length).toBe(1);
    const success = audits.find(a => a.op === '_auditExportMessagesSuccess')!.body;
    expect(success).toContain('exportCount');
    expect(success).toContain('/tmp/exports');
});
