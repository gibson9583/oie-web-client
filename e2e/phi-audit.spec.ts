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

    // The access event carries the patient id, channel and message id. The
    // channel is the engine's audit-attribute form, not a bare display name —
    // a Cures report keys on the id.
    const accessed = audits.find(a => a.op === '_auditAccessedPHIMessage')!.body;
    expect(accessed).toContain('PID-4242');
    expect(accessed).toContain('987654321');
    expect(accessed).toContain(`Channel[id=${CID},name=`);
    expect(audits.find(a => a.op === '_auditQueriedPHIMessage')!.body).toContain(`Channel[id=${CID},name=`);
});

test('paging a result set does not re-audit the query', async ({ page }) => {
    // Swing audits from runSearch() only; loadPageNumber does not. A 20-page
    // walk that writes 20 "Queried PHI" events buries the queries that were
    // actually issued.
    const rows = (n: number) => ({ list: { message: Array.from({ length: n }, (_, i) => ({
        ...MESSAGE, messageId: String(900 + i)
    })) } });
    await mockEngine(page, {
        [`GET /channels/${CID}/metaDataColumns`]: patientIdColumn,
        [`GET /channels/${CID}/messages`]: () => rows(21)
    });
    const audits = await captureAudits(page);

    await page.goto(`/messages/${CID}`);
    await expect(page.getByText('900').first()).toBeVisible();
    await expect.poll(() => audits.filter(a => a.op === '_auditQueriedPHIMessage').length).toBe(1);

    await page.getByRole('button', { name: 'Next ›' }).click();
    await expect(page.getByRole('button', { name: '‹ Prev' })).toBeEnabled();
    // Give a stray audit time to land before asserting it did not.
    await page.waitForTimeout(300);
    expect(audits.filter(a => a.op === '_auditQueriedPHIMessage')).toHaveLength(1);

    // Re-applying the criteria IS a new query, and is audited.
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect.poll(() => audits.filter(a => a.op === '_auditQueriedPHIMessage').length).toBe(2);
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

test('a metadata-column failure blocks browsing instead of assuming non-PHI', async ({ page }) => {
    let searches = 0;
    let phiAudits = 0;
    await mockEngine(page, {
        [`GET /channels/${CID}/metaDataColumns`]: {
            __status: 403,
            body: { message: 'User does not have permission' }
        },
        [`GET /channels/${CID}/messages`]: () => { searches++; return { list: '' }; }
    });
    await page.route('**/api/channels/_audit*', async route => {
        phiAudits++;
        await route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
    });

    await page.goto(`/messages/${CID}`);
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Could not load channel metadata columns');
    await expect(alert).toContainText('PHI audit requirement cannot be determined');
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeDisabled();
    expect(searches).toBe(0);
    expect(phiAudits).toBe(0);
});

test('a malformed metadata-column success blocks browsing instead of failing open', async ({ page }) => {
    let searches = 0;
    await mockEngine(page, {
        [`GET /channels/${CID}/metaDataColumns`]: {},
        [`GET /channels/${CID}/messages`]: () => { searches++; return { list: '' }; }
    });
    const audits = await captureAudits(page);

    await page.goto(`/messages/${CID}`);
    await expect(page.getByRole('alert')).toContainText('unusable channel metadata column list');
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeDisabled();
    expect(searches).toBe(0);
    expect(audits.filter(a => a.op.includes('PHIMessage'))).toHaveLength(0);
});

test('a channel that gains PATIENT_ID while open is audited on the next search', async ({ page }) => {
    let metadataReads = 0;
    const accountColumn = { list: { metaDataColumn: [{ name: 'ACCOUNT', type: 'STRING' }] } };
    await mockEngine(page, {
        [`GET /channels/${CID}/metaDataColumns`]: () => {
            metadataReads++;
            // Bootstrap + its immediate automatic search both see the original
            // schema. The later explicit Search sees the concurrent edit.
            return metadataReads <= 2 ? accountColumn : patientIdColumn;
        },
        [`GET /channels/${CID}/messages`]: { list: { message: [MESSAGE] } }
    });
    const audits = await captureAudits(page);

    await page.goto(`/messages/${CID}`);
    await expect(page.getByText('987654321')).toBeVisible();
    expect(audits.filter(a => a.op === '_auditQueriedPHIMessage')).toHaveLength(0);

    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect.poll(() => audits.filter(a => a.op === '_auditQueriedPHIMessage').length).toBe(1);
    expect(metadataReads).toBeGreaterThanOrEqual(3);
});

test('exporting brackets the export with the audit pair, and a failed pre-audit aborts it', async ({ page }) => {
    let exportCalls = 0;
    await mockEngine(page, {
        [`GET /channels/${CID}/metaDataColumns`]: { list: '' },
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

test('the accessed-PHI event names the patient on the row that was opened', async ({ page }) => {
    /* Swing audits the SELECTED connectorMessage's PATIENT_ID. A destination can
       carry a different one than its source, and scanning the message for "the
       first PATIENT_ID that isn't empty" then names the wrong patient for the
       row on screen — the one thing a Cures access log must not do. */
    const MID2 = '555000111';
    const TWO_ROWS = {
        messageId: MID2, channelId: CID, serverId: 's1',
        connectorMessages: {
            entry: [
                {
                    int: 0,
                    connectorMessage: {
                        messageId: MID2, metaDataId: 0, connectorName: 'Source', status: 'SENT',
                        metaDataMap: { entry: [{ string: ['PATIENT_ID', 'PID-SOURCE'] }] }
                    }
                },
                {
                    int: 1,
                    connectorMessage: {
                        messageId: MID2, metaDataId: 1, connectorName: 'Destination 1', status: 'SENT',
                        metaDataMap: { entry: [{ string: ['PATIENT_ID', 'PID-DESTINATION'] }] }
                    }
                }
            ]
        }
    };
    await mockEngine(page, {
        [`GET /channels/${CID}/metaDataColumns`]: patientIdColumn,
        [`GET /channels/${CID}/messages`]: { list: { message: [TWO_ROWS] } },
        [`GET /channels/${CID}/messages/${MID2}`]: TWO_ROWS,
        [`GET /channels/${CID}/messages/${MID2}/attachments`]: { list: '' }
    });
    const audits = await captureAudits(page);

    await page.goto(`/messages/${CID}`);
    await expect(page.getByText('Destination 1').first()).toBeVisible();

    await page.getByText('Destination 1').first().click();
    await expect.poll(() => audits.filter(a => a.op === '_auditAccessedPHIMessage').length).toBeGreaterThan(0);

    const accessed = audits.filter(a => a.op === '_auditAccessedPHIMessage').at(-1)!.body;
    expect(accessed).toContain('PID-DESTINATION');
    expect(accessed).not.toContain('PID-SOURCE');
});

test('a failed message read renders as an error and writes NO access event', async ({ page }) => {
    /* Fail CLOSED both ways: the detail pane must not render the row's cached
       copy as if the engine answered, and no "Accessed PHI" event may be
       written for a read that failed — a false access record poisons the very
       audit trail these events exist for. */
    await mockEngine(page, {
        [`GET /channels/${CID}/metaDataColumns`]: patientIdColumn,
        [`GET /channels/${CID}/messages`]: { list: { message: [MESSAGE] } },
        [`GET /channels/${CID}/messages/987654321`]: { __status: 500, body: { message: 'store offline' } },
        [`GET /channels/${CID}/messages/987654321/attachments`]: { list: '' }
    });
    const audits = await captureAudits(page);

    await page.goto(`/messages/${CID}`);
    await expect(page.getByText('987654321')).toBeVisible();
    await page.getByText('987654321').first().click();

    await expect(page.getByText(/Failed to load message content/).first()).toBeVisible();
    expect(audits.filter(a => a.op === '_auditAccessedPHIMessage')).toHaveLength(0);
});

test('an empty successful message read does not render the cached row or write an access event', async ({ page }) => {
    await mockEngine(page, {
        [`GET /channels/${CID}/metaDataColumns`]: patientIdColumn,
        [`GET /channels/${CID}/messages`]: { list: { message: [MESSAGE] } },
        // A missing message is nullable at the engine controller and reaches the
        // browser as an empty successful body, not necessarily an HTTP error.
        [`GET /channels/${CID}/messages/987654321`]: '',
        [`GET /channels/${CID}/messages/987654321/attachments`]: { list: '' }
    });
    const audits = await captureAudits(page);

    await page.goto(`/messages/${CID}`);
    await expect(page.getByText('987654321')).toBeVisible();
    await page.getByText('987654321').first().click();

    await expect(page.getByText(/Failed to load message content/).first()).toBeVisible();
    expect(audits.filter(a => a.op === '_auditAccessedPHIMessage')).toHaveLength(0);
});
