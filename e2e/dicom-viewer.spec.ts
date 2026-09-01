import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * DICOM attachment viewer (plugins/attachment-dicomviewer). Covers the layout
 * and interaction contract: the toolbar sits ABOVE the image (so controls never
 * fall below the fold in a short detail pane), the header rides beside it,
 * multi-frame objects get a filmstrip, and Full Screen is the app's own modal
 * carrying the SAME live viewer rather than a flat snapshot.
 *
 * The fixture is a real 16x16, 3-frame, 8-bit MONOCHROME2 Secondary Capture
 * object (Explicit VR LE), so dicom-parser and the render path run for real —
 * the engine's reassembly endpoint returns exactly this Base64.
 */

const CID = 'c-started';
const MID = '12345';

const DICOM_B64 =
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABESUNNAgAAAFVMBADOAAAAAgABAE9C' +
    'AAACAAAAAAECAAIAVUkaADEuMi44NDAuMTAwMDguNS4xLjQuMS4xLjcAAgADAFVJQAAxLjIuODI2LjAuMS4zNjgwMDQzLjguNDk4' +
    'LjI3MzczMDc0MzMyOTc2ODEwNzE0MDUzNzk4NjY5NDcwMDkyNDA4AgAQAFVJFAAxLjIuODQwLjEwMDA4LjEuMi4xAAIAEgBVSRwA' +
    'MS4yLjgyNi4wLjEuMzY4MDA0My44LjQ5OC4xAAIAEwBTSA4AUFlESUNPTSAyLjQuNCAIABYAVUkaADEuMi44NDAuMTAwMDguNS4x' +
    'LjQuMS4xLjcACAAYAFVJQAAxLjIuODI2LjAuMS4zNjgwMDQzLjguNDk4LjI3MzczMDc0MzMyOTc2ODEwNzE0MDUzNzk4NjY5NDcw' +
    'MDkyNDA4CAAgAERBCAAyMDI2MDgzMAgAYABDUwIAT1QIAGQAQ1MEAFNZTiAIADAQTE8KAEUyRSBESUNPTSAQABAAUE4KAEUyRV5W' +
    'SUVXRVIQACAATE8GAEUyRTAwMSAADQBVSUAAMS4yLjgyNi4wLjEuMzY4MDA0My44LjQ5OC42NTA4NDM1MDc3Mzc1NDAwODE5NTUw' +
    'MjM2MTU1NTA1MDQwNTY1NCAADgBVSUAAMS4yLjgyNi4wLjEuMzY4MDA0My44LjQ5OC4xMjI0OTY4NTkyMDMyODE1OTM4ODgyOTIy' +
    'NjIxMzAxOTg3NDE5NCgAAgBVUwIAAQAoAAQAQ1MMAE1PTk9DSFJPTUUyICgACABJUwIAMyAoABAAVVMCABAAKAARAFVTAgAQACgA' +
    'AAFVUwIACAAoAAEBVVMCAAgAKAACAVVTAgAHACgAAwFVUwIAAADgfxAAT0IAAAADAAAAECAwQFBgcICQoLDA0ODwABAgMEBQYHCA' +
    'kKCwwNDg8AAQIDBAUGBwgJCgsMDQ4PAAECAwQFBgcICQoLDA0ODwABAgMEBQYHCAkKCwwNDg8AAQIDBAUGBwgJCgsMDQ4PAAECAw' +
    'QFBgcICQoLDA0ODwABAgMEBQYHCAkKCwwNDg8AAQIDBAUGBwgJCgsMDQ4PAAECAwQFBgcICQoLDA0ODwABAgMEBQYHCAkKCwwNDg' +
    '8AAQIDBAUGBwgJCgsMDQ4PAAECAwQFBgcICQoLDA0ODwABAgMEBQYHCAkKCwwNDg8AAQIDBAUGBwgJCgsMDQ4PAAECAwQFBgcICQ' +
    'oLDA0ODwPExcbHyMnKy8zNzs/AwcLDxMXGx8jJysvMzc7PwMHCw8TFxsfIycrLzM3Oz8DBwsPExcbHyMnKy8zNzs/AwcLDxMXGx8' +
    'jJysvMzc7PwMHCw8TFxsfIycrLzM3Oz8DBwsPExcbHyMnKy8zNzs/AwcLDxMXGx8jJysvMzc7PwMHCw8TFxsfIycrLzM3Oz8DBws' +
    'PExcbHyMnKy8zNzs/AwcLDxMXGx8jJysvMzc7PwMHCw8TFxsfIycrLzM3Oz8DBwsPExcbHyMnKy8zNzs/AwcLDxMXGx8jJysvMzc' +
    '7PwMHCw8TFxsfIycrLzM3Oz8DBwsPExcbHyMnKy8zNzs/AwcLHiImKi4yNjo+AgYKDhIWGh4iJiouMjY6PgIGCg4SFhoeIiYqLjI' +
    '2Oj4CBgoOEhYaHiImKi4yNjo+AgYKDhIWGh4iJiouMjY6PgIGCg4SFhoeIiYqLjI2Oj4CBgoOEhYaHiImKi4yNjo+AgYKDhIWGh4' +
    'iJiouMjY6PgIGCg4SFhoeIiYqLjI2Oj4CBgoOEhYaHiImKi4yNjo+AgYKDhIWGh4iJiouMjY6PgIGCg4SFhoeIiYqLjI2Oj4CBgo' +
    'OEhYaHiImKi4yNjo+AgYKDhIWGh4iJiouMjY6PgIGCg4SFhoeIiYqLjI2Oj4CBgoOEhYaHiImKi4yNjo+AgYKDhIWGg=';

const MESSAGE = {
    messageId: MID,
    channelId: CID,
    receivedDate: { time: 1700000000000 },
    processed: true,
    connectorMessages: {
        entry: [{
            int: 0,
            connectorMessage: {
                metaDataId: 0, connectorName: 'Source', status: 'RECEIVED',
                receivedDate: { time: 1700000000000 },
                raw: { content: 'AAAA', dataType: 'DICOM' }
            }
        }]
    }
};

const FIXTURES = {
    ['GET /channels/' + CID + '/messages']: { list: { message: [MESSAGE] } },
    ['GET /channels/' + CID + '/messages/count']: { long: 1 },
    ['GET /channels/' + CID + '/connectorNames']: { map: { entry: [{ int: 0, string: 'Source' }] } },
    ['GET /channels/' + CID + '/metaDataColumns']: '',
    'GET /channels/idsAndNames': { map: { entry: [{ string: [CID, 'Demo Started'] }] } },
    ['GET /channels/' + CID + '/messages/' + MID]: MESSAGE,
    ['GET /channels/' + CID + '/messages/' + MID + '/attachments']: {
        list: { attachment: [{ id: 'att-1', type: 'DICOM', encrypt: false }] }
    },
    // Swing getDICOMMessage: the reassembled object, Base64, as text/plain.
    ['POST /channels/' + CID + '/messages/' + MID + '/_getDICOMMessage']: DICOM_B64
};

/** Select the message and open its Attachments tab, where the viewer mounts. */
async function openViewer(page: any) {
    await page.goto('/messages/' + CID);
    await page.locator('table.msg-table tbody tr').first().click();
    await page.getByRole('tab', { name: 'Attachments', exact: true }).click();
    // The toolbar is the first thing the parsed object renders.
    await expect(page.getByRole('button', { name: 'Fit', exact: true })).toBeVisible({ timeout: 15000 });
}

test.beforeEach(async ({ page }) => {
    await mockEngine(page, FIXTURES);
});

test('renders the parsed object with the toolbar above the image', async ({ page }) => {
    await openViewer(page);

    // Inline the toolbar carries the dimensions dicom-parser read out of the
    // fixture; the full caption is the dialog's title, asserted below.
    await expect(page.getByText('16×16', { exact: true })).toBeVisible();

    // Controls exist and, crucially, sit ABOVE the image: the toolbar's bottom
    // edge is above the canvas's top edge, so a short pane never buries them.
    const fit = page.getByRole('button', { name: 'Fit', exact: true });
    await expect(fit).toBeVisible();
    await expect(page.getByRole('button', { name: '1:1', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Auto', exact: true })).toBeVisible();
    const toolbar = (await fit.boundingBox())!;
    const canvas = (await page.locator('canvas').first().boundingBox())!;
    expect(toolbar.y + toolbar.height).toBeLessThanOrEqual(canvas.y + 1);

    // Header fields parsed from the object.
    await expect(page.getByText('E2E^VIEWER')).toBeVisible();
    await expect(page.getByText('E2E001')).toBeVisible();
});

test('multi-frame objects get a filmstrip that drives the frame', async ({ page }) => {
    await openViewer(page);

    const frames = page.getByRole('button', { name: /^Frame \d+$/ });
    await expect(frames).toHaveCount(3);
    await expect(frames.nth(0)).toHaveAttribute('aria-pressed', 'true');

    await frames.nth(2).click();
    await expect(frames.nth(2)).toHaveAttribute('aria-pressed', 'true');
    await expect(frames.nth(0)).toHaveAttribute('aria-pressed', 'false');
});

test('Full Screen opens the live viewer as a modal, not a snapshot', async ({ page }) => {
    await openViewer(page);

    await page.getByRole('button', { name: /Full Screen/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.locator('.modal-overlay')).toHaveCount(1);
    // The dialog titles itself with what was parsed.
    await expect(dialog.getByText(/DICOM object . 16.16, 3 frames/)).toBeVisible();

    // The live controls came with it — a snapshot would carry none of these.
    await expect(dialog.getByRole('button', { name: 'Fit', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '1:1', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Frame \d+$/ })).toHaveCount(3);

    // Dismissal is the dialog's own — header close and footer Close — with no
    // third exit competing in the toolbar.
    await expect(dialog.locator('.modal-foot').getByRole('button', { name: 'Close' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Exit Full Screen/ })).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    // Back in the pane, still live.
    await expect(page.getByRole('button', { name: /Full Screen/ })).toBeVisible();
});

test('1:1 and Fit drive the canvas transform', async ({ page }) => {
    await openViewer(page);
    const canvas = page.locator('canvas').first();

    /* Drive 1:1 FIRST and take the baseline there. Sampling the opening state
       instead would race the initial fit: the stage is measured by a
       ResizeObserver, so the zoom is still 1 for a frame or two after mount and
       the baseline would coincidentally equal 1:1. */
    await page.getByRole('button', { name: '1:1', exact: true }).click();
    await expect(page.getByText('100%', { exact: true })).toBeVisible();
    const oneToOne = await canvas.getAttribute('style');

    // Fit re-derives the zoom from the stage; a 16x16 object in the pane lands
    // well above actual size, so both the label and the transform move.
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    await expect(page.getByText('100%', { exact: true })).toHaveCount(0);
    expect(await canvas.getAttribute('style')).not.toBe(oneToOne);
});
