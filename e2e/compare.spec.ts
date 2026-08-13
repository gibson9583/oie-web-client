import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * Compare Messages — the select → confirm → diff workflow in the message
 * browser, and the PHI lifecycle that makes it acceptable to have at all.
 *
 * The lifecycle assertions are the point of this file: every message body in the
 * fixtures carries a SENTINEL, so "did any content reach storage / survive a
 * session ending / leak into the URL" is a substring search rather than an
 * argument about implementation details.
 */

const CID = 'c-started';
const SENTINEL = 'ZZTEST^SENTINEL';

/* Message 12345: a source with Raw + Transformed stored (no Processed Raw), and
   a destination with Encoded + Sent + Response. */
const MESSAGE_A = {
    messageId: '12345',
    channelId: CID,
    processed: true,
    receivedDate: { time: 1700000000000 },
    connectorMessages: {
        entry: [
            {
                int: 0,
                connectorMessage: {
                    metaDataId: 0,
                    connectorName: 'Source',
                    status: 'TRANSFORMED',
                    receivedDate: { time: 1700000000000 },
                    raw: { content: `MSH|^~\\&|SENDER|FAC|RECV|FAC|20231101||ADT^A01|${SENTINEL}|P|2.3`, dataType: 'HL7V2' },
                    transformed: { content: `<HL7Message><MSH.10>${SENTINEL}</MSH.10></HL7Message>`, dataType: 'XML' }
                }
            },
            {
                int: 1,
                connectorMessage: {
                    metaDataId: 1,
                    connectorName: 'HTTP Sender',
                    status: 'SENT',
                    receivedDate: { time: 1700000001000 },
                    encoded: { content: `<encoded>${SENTINEL}-A</encoded>`, dataType: 'XML' },
                    sent: { content: 'plain sent payload' },
                    response: { content: '<response><status>SENT</status><message>ack</message></response>' }
                }
            }
        ]
    }
};

/* Message 12346: same shape, different raw — the cross-message comparison. */
const MESSAGE_B = {
    messageId: '12346',
    channelId: CID,
    processed: true,
    receivedDate: { time: 1700000100000 },
    connectorMessages: {
        entry: [{
            int: 0,
            connectorMessage: {
                metaDataId: 0,
                connectorName: 'Source',
                status: 'TRANSFORMED',
                receivedDate: { time: 1700000100000 },
                raw: { content: `MSH|^~\\&|SENDER|FAC|RECV|FAC|20231102||ADT^A04|${SENTINEL}|P|2.3`, dataType: 'HL7V2' },
                transformed: { content: `<HL7Message><MSH.10>${SENTINEL}-B</MSH.10></HL7Message>`, dataType: 'XML' }
            }
        }]
    }
};

const FIXTURES = {
    [`GET /channels/${CID}/messages`]: (req: any) => {
        const offset = Number(new URL(req.url()).searchParams.get('offset') || 0);
        return { list: { message: offset > 0 ? [] : [MESSAGE_A, MESSAGE_B] } };
    },
    [`GET /channels/${CID}/messages/count`]: { long: 2 },
    [`GET /channels/${CID}/connectorNames`]: { map: { entry: [
        { int: 0, string: 'Source' },
        { int: 1, string: 'HTTP Sender' }
    ] } },
    [`GET /channels/${CID}/metaDataColumns`]: '',
    'GET /channels/idsAndNames': { map: { entry: [{ string: [CID, 'Demo Started'] }] } },
    [`GET /channels/${CID}/messages/12345`]: MESSAGE_A,
    [`GET /channels/${CID}/messages/12346`]: MESSAGE_B,
    [`GET /channels/${CID}/messages/12345/attachments`]: '',
    [`GET /channels/${CID}/messages/12346/attachments`]: ''
};

test.beforeEach(async ({ page }) => {
    await mockEngine(page, FIXTURES);
});

/* ---- helpers ----------------------------------------------------------------- */

const row = (page: any, id: any) => page.getByText(id, { exact: true });

/** Right-click a row and walk the "Select for Compare ▸" / "Compare with…" submenu. */
async function pickFromRow(page: any, id: any, parent: string, stage: string) {
    await row(page, id).click({ button: 'right' });
    await page.getByRole('menuitem', { name: parent }).hover();
    await page.getByRole('menuitem', { name: stage, exact: true }).click();
}

/* Every text node in the document, joined. Deliberately textContent rather than
   page.content(): Monaco splits a rendered line into ~50-character spans, so a
   sentinel can straddle two of them in the HTML while being one string on screen
   — and it catches text that is present but hidden, which page.innerText would
   miss. */
const domText = (page: any) => page.evaluate(() => document.body.textContent || '');

async function openBrowser(page: any) {
    await page.goto(`/messages/${CID}`);
    await expect(row(page, '12345')).toBeVisible();
}

/* ---- happy paths -------------------------------------------------------------- */

test('row → submenu → second row → confirm renders the diff', async ({ page }) => {
    await openBrowser(page);

    await pickFromRow(page, '12345', 'Select for Compare', 'Raw');
    const chip = page.locator('.compare-chip');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('Msg 12345 · Source · Raw');
    // The chip advertises the reference and nothing else.
    await expect(chip).not.toContainText(SENTINEL);
    // The anchored row is marked in the grid, and the status bar says so.
    await expect(page.locator('tr.compare-anchor')).toHaveCount(1);
    await expect(page.locator('.status-compare')).toBeVisible();

    await pickFromRow(page, '12346', 'Compare to Selection', 'Raw');

    const confirm = page.getByRole('dialog').filter({ hasText: 'Compare selected content?' });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('Msg 12345 · Source · Raw');
    await expect(confirm).toContainText('Msg 12346 · Source · Raw');
    await confirm.getByRole('button', { name: 'Compare', exact: true }).click();

    const overlay = page.locator('.compare-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('.compare-side-ref').first()).toHaveText('Msg 12345 · Source · Raw');
    await expect(overlay.locator('.compare-side-ref').nth(1)).toHaveText('Msg 12346 · Source · Raw');
    // Both sides actually loaded (neither pane is still spinning or errored).
    await expect(overlay.locator('.compare-pane-overlay')).toHaveCount(0);
});

test('Swap exchanges the two sides', async ({ page }) => {
    await openBrowser(page);
    await pickFromRow(page, '12345', 'Select for Compare', 'Raw');
    await pickFromRow(page, '12346', 'Compare to Selection', 'Raw');
    await page.getByRole('button', { name: 'Compare', exact: true }).click();

    const overlay = page.locator('.compare-overlay');
    await expect(overlay.locator('.compare-side-ref').first()).toHaveText('Msg 12345 · Source · Raw');
    await overlay.getByRole('button', { name: 'Swap' }).click();
    await expect(overlay.locator('.compare-side-ref').first()).toHaveText('Msg 12346 · Source · Raw');
    await expect(overlay.locator('.compare-side-ref').nth(1)).toHaveText('Msg 12345 · Source · Raw');
});

test('a stage dropdown re-points one side without disturbing the other', async ({ page }) => {
    await openBrowser(page);
    await pickFromRow(page, '12345', 'Select for Compare', 'Raw');
    await pickFromRow(page, '12346', 'Compare to Selection', 'Raw');
    await page.getByRole('button', { name: 'Compare', exact: true }).click();

    const overlay = page.locator('.compare-overlay');
    await overlay.getByLabel('Left stage').selectOption('TRANSFORMED');
    await expect(overlay.locator('.compare-side-ref').first()).toHaveText('Msg 12345 · Source · Transformed');
    await expect(overlay.locator('.compare-side-ref').nth(1)).toHaveText('Msg 12346 · Source · Raw');
    await expect(overlay.locator('.compare-pane-overlay')).toHaveCount(0);
});

test('a content tab captures the stage that is on screen', async ({ page }) => {
    await openBrowser(page);
    // Open the detail pane, switch to Transformed, then right-click the tab.
    await row(page, '12345').click();
    await page.getByRole('tab', { name: 'Transformed', exact: true }).click();
    await page.getByRole('tab', { name: 'Transformed', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Select for Compare' }).click();

    await expect(page.locator('.compare-chip')).toContainText('Msg 12345 · Source · Transformed');
    // The captured tab is marked as the anchor.
    await expect(page.locator('.tabs .tab.compare-anchor')).toHaveText('Transformed');
});

test('two stages of one message compare, and say so', async ({ page }) => {
    await openBrowser(page);
    await pickFromRow(page, '12345', 'Select for Compare', 'Raw');
    await pickFromRow(page, '12345', 'Compare to Selection', 'Transformed');

    const confirm = page.getByRole('dialog').filter({ hasText: 'Compare selected content?' });
    await expect(confirm).toContainText('Two stages of the same message');
    await confirm.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(page.locator('.compare-overlay')).toBeVisible();
    await expect(page.locator('.compare-pane-overlay')).toHaveCount(0);
});

/* ---- guards and cancel semantics ---------------------------------------------- */

test('the identical tuple is refused before the modal opens', async ({ page }) => {
    await openBrowser(page);
    await pickFromRow(page, '12345', 'Select for Compare', 'Raw');
    await pickFromRow(page, '12345', 'Compare to Selection', 'Raw');

    await expect(page.getByRole('status').filter({ hasText: 'Same content already selected' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The anchor is untouched.
    await expect(page.locator('.compare-chip')).toContainText('Msg 12345 · Source · Raw');
});

test('cancelling the confirmation discards only the second selection', async ({ page }) => {
    await openBrowser(page);
    await pickFromRow(page, '12345', 'Select for Compare', 'Raw');
    await pickFromRow(page, '12346', 'Compare to Selection', 'Raw');

    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.compare-overlay')).toHaveCount(0);
    // Anchor survives — the usual reason to back out is the wrong SECOND side.
    await expect(page.locator('.compare-chip')).toContainText('Msg 12345 · Source · Raw');
    await expect(page.getByRole('status').filter({ hasText: 'second selection discarded' })).toBeVisible();
});

test('the chip clears the selection and re-disables the task', async ({ page }) => {
    await openBrowser(page);
    const compareTask = page.getByRole('button', { name: 'Compare to Selection' });
    await expect(compareTask).toBeDisabled();

    await pickFromRow(page, '12345', 'Select for Compare', 'Raw');
    await expect(compareTask).toBeEnabled();

    await page.getByRole('button', { name: 'Clear compare selection' }).click();
    await expect(page.locator('.compare-chip')).toHaveCount(0);
    await expect(page.locator('tr.compare-anchor')).toHaveCount(0);
    await expect(page.locator('.status-compare')).toHaveCount(0);
    await expect(compareTask).toBeDisabled();
});

test('a stage the message did not store is offered as unavailable', async ({ page }) => {
    await openBrowser(page);
    // Selecting the row loads it, so the submenu knows what is actually stored.
    await row(page, '12345').click();
    await expect(page.getByRole('tab', { name: 'Raw', exact: true })).toBeVisible();

    await row(page, '12345').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Select for Compare' }).hover();
    // Message 12345's source stores Raw and Transformed but no Processed Raw…
    await expect(page.getByRole('menuitem', { name: 'Processed Raw (not stored)' })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: 'Raw', exact: true })).toBeEnabled();
    // …and a source connector never has a Sent stage at all.
    await expect(page.getByRole('menuitem', { name: /^Sent/ })).toHaveCount(0);
});

/* ---- PHI lifecycle ------------------------------------------------------------ */

/** Every place a browser can put something on disk, searched for the sentinel. */
async function persistedTraces(page: any, sentinel: string) {
    return page.evaluate(async (needle: string) => {
        const scan = (store: any) => {
            for (let i = 0; i < store.length; i++) {
                const key = store.key(i)!;
                if (key.includes(needle) || String(store.getItem(key) ?? '').includes(needle)) return key;
            }
            return null;
        };
        return {
            local: scan(window.localStorage),
            session: scan(window.sessionStorage),
            databases: (window.indexedDB as any).databases ? (await (window.indexedDB as any).databases()).map((d: any) => d.name) : [],
            caches: window.caches ? await window.caches.keys() : [],
            cookies: document.cookie.includes(needle)
        };
    }, sentinel);
}

test('a full compare cycle writes nothing to browser storage', async ({ page }) => {
    await openBrowser(page);
    const before = await persistedTraces(page, SENTINEL);

    await pickFromRow(page, '12345', 'Select for Compare', 'Raw');
    await pickFromRow(page, '12346', 'Compare to Selection', 'Raw');
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    const overlay = page.locator('.compare-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('.compare-pane-overlay')).toHaveCount(0);

    // While it is open, and after it closes.
    for (const phase of ['open', 'closed']) {
        if (phase === 'closed') {
            await overlay.getByRole('button', { name: 'Close comparison' }).click();
            await expect(overlay).toHaveCount(0);
        }
        const traces = await persistedTraces(page, SENTINEL);
        expect(traces.local, `localStorage (${phase})`).toBeNull();
        expect(traces.session, `sessionStorage (${phase})`).toBeNull();
        expect(traces.cookies, `cookies (${phase})`).toBe(false);
        expect(traces.databases, `indexedDB (${phase})`).toEqual(before.databases);
        expect(traces.caches, `cache storage (${phase})`).toEqual(before.caches);
    }
});

test('closing the comparison disposes its Monaco models', async ({ page }) => {
    await openBrowser(page);
    await pickFromRow(page, '12345', 'Select for Compare', 'Raw');
    await pickFromRow(page, '12346', 'Compare to Selection', 'Raw');
    await page.getByRole('button', { name: 'Compare', exact: true }).click();

    const overlay = page.locator('.compare-overlay');
    await expect(overlay).toBeVisible();
    // Monaco is optional (the diff falls back to two plain panes); assert only
    // when it actually loaded, which is what the requirement is about.
    const loaded = await page.waitForFunction(
        () => !!(window as any).monaco && (window as any).monaco.editor.getModels().length > 0,
        undefined, { timeout: 15000 }).then(() => true, () => false);

    await overlay.getByRole('button', { name: 'Close comparison' }).click();
    await expect(overlay).toHaveCount(0);
    if (loaded) {
        await expect.poll(() => page.evaluate(() => (window as any).monaco.editor.getModels().length))
            .toBe(0);
    }
});

test('an expired session tears the comparison down before the login screen', async ({ page }) => {
    await openBrowser(page);
    await pickFromRow(page, '12345', 'Select for Compare', 'Raw');
    await pickFromRow(page, '12346', 'Compare to Selection', 'Raw');
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    const overlay = page.locator('.compare-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('.compare-pane-overlay')).toHaveCount(0);
    // The content really was on screen, so its absence below means something.
    expect(await domText(page)).toContain(SENTINEL);

    // Every engine call now 401s: the next background request expires the session.
    await mockEngine(page, { ...FIXTURES, [`GET /channels/${CID}/messages/12345`]: { __status: 401 } });
    await overlay.getByLabel('Left stage').selectOption('TRANSFORMED');

    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(overlay).toHaveCount(0);
    expect(await domText(page)).not.toContain(SENTINEL);
    // And the selection itself is gone — the next user of this tab starts clean.
    await expect(page.locator('.compare-chip')).toHaveCount(0);
});

test('the comparison never enters the URL', async ({ page }) => {
    await openBrowser(page);
    const url = page.url();

    await pickFromRow(page, '12345', 'Select for Compare', 'Raw');
    await pickFromRow(page, '12346', 'Compare to Selection', 'Raw');
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(page.locator('.compare-overlay')).toBeVisible();
    // A route would put the channel + message ids of a comparison into history,
    // which is written to disk.
    expect(page.url()).toBe(url);

    await page.getByRole('button', { name: 'Close comparison' }).click();
    expect(page.url()).toBe(url);
});

test('navigating away releases the comparison', async ({ page }) => {
    await openBrowser(page);
    await pickFromRow(page, '12345', 'Select for Compare', 'Raw');
    await pickFromRow(page, '12346', 'Compare to Selection', 'Raw');
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(page.locator('.compare-overlay')).toBeVisible();

    await page.goto('/dashboard');
    await expect(page.locator('.compare-overlay')).toHaveCount(0);
    expect(await domText(page)).not.toContain(SENTINEL);
});

/* ---- accessibility ------------------------------------------------------------ */

test('the overlay is a labelled dialog that traps focus, and Escape closes it', async ({ page }) => {
    await openBrowser(page);
    await pickFromRow(page, '12345', 'Select for Compare', 'Raw');
    await pickFromRow(page, '12346', 'Compare to Selection', 'Raw');
    await page.getByRole('button', { name: 'Compare', exact: true }).click();

    await expect(page.locator('.compare-overlay')).toBeVisible();
    const labelledBy = await page.locator('.compare-overlay').getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    await expect(page.locator(`#${labelledBy}`)).toHaveText(/Compare/i);

    for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => document.querySelector('.compare-overlay')!.contains(document.activeElement))).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(page.locator('.compare-overlay')).toHaveCount(0);
});
