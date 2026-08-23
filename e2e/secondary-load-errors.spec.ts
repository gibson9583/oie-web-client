import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * Secondary loads must not present "the endpoint failed" as "there is no data".
 * A 403 for a restricted user and a 500 both used to render as an empty list,
 * which is a wrong answer that looks exactly like a right one. Session expiry is
 * a separate path — the global 401 handler fires before the throw — so the
 * classes that land here are 403 and 5xx.
 */

test('a 403 on groups/tags/states is reported, and the channel list still renders', async ({ page }) => {
    await mockEngine(page, {
        'GET /channelgroups': { __status: 403, body: { message: 'User does not have permission' } },
        'GET /server/channelTags': { __status: 403, body: { message: 'User does not have permission' } },
        'GET /channels/statuses': { __status: 500, body: { message: 'boom' } }
    });

    await page.goto('/channels');

    // The primary list still loaded, so the view is usable...
    await expect(page.getByRole('gridcell', { name: 'Demo Started', exact: true })).toBeVisible();
    // ...but it says what is missing rather than implying the server has none.
    const banner = page.getByText(/Could not load/i);
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('groups');
    await expect(banner).toContainText('tags');
    await expect(banner).toContainText('channel states');
});

test('a healthy load shows no failure banner', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/channels');
    await expect(page.getByRole('gridcell', { name: 'Demo Started', exact: true })).toBeVisible();
    await expect(page.getByText(/Could not load/i)).toHaveCount(0);
});

test('a failed attachment lookup is reported, not shown as "no attachments"', async ({ page }) => {
    const CID = 'c-started';
    // Needs a real source connector message: a row whose source is absent is
    // treated as a placeholder and never loads the detail pane at all.
    const MESSAGE = {
        messageId: '987654321', channelId: CID, serverId: 's1',
        connectorMessages: {
            entry: {
                int: 0,
                connectorMessage: {
                    messageId: '987654321', metaDataId: 0, connectorName: 'Source', status: 'SENT'
                }
            }
        }
    };
    await mockEngine(page, {
        [`GET /channels/${CID}/messages`]: { list: { message: [MESSAGE] } },
        [`GET /channels/${CID}/messages/987654321`]: MESSAGE,
        [`GET /channels/${CID}/messages/987654321/attachments`]: { __status: 500, body: { message: 'attachment store offline' } }
    });

    await page.goto(`/messages/${CID}`);
    await expect(page.getByText('987654321')).toBeVisible();
    await page.getByText('987654321').first().click();

    // toast(..., 'warn') renders a modal in this app, not a corner toast.
    await expect(page.getByText(/Could not list this message's attachments/i)).toBeVisible();
});

test('the alert wizard reports a failed channel/options picker load', async ({ page }) => {
    await mockEngine(page, {
        'GET /channels/idsAndNames': {
            __status: 403,
            body: { message: 'channel picker forbidden' }
        },
        'GET /alerts/options': {
            __status: 500,
            body: { message: 'alert options unavailable' }
        }
    });

    await page.goto('/alerts/new/guided');
    await page.getByRole('textbox', { name: 'Alert name' }).fill('Picker load test');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    const failure = page.getByText(/Could not load/i);
    await expect(failure).toContainText('channels');
    await expect(failure).toContainText('alert options');
});

test('the channel wizard reports incomplete dependency pickers', async ({ page }) => {
    await mockEngine(page, {
        'GET /codeTemplateLibraries': {
            __status: 500,
            body: { message: 'libraries unavailable' }
        },
        'GET /server/resources': {
            __status: 403,
            body: { message: 'resources forbidden' }
        },
        'GET /server/channelDependencies': {
            __status: 500,
            body: { message: 'dependencies unavailable' }
        },
        'GET /channels/idsAndNames': {
            __status: 500,
            body: { message: 'channels unavailable' }
        }
    });

    await page.goto('/channels/new/guided');
    await page.locator('.view-body input').first().fill('Picker Failure Channel');
    await page.getByRole('button', { name: 'Next', exact: true }).click();

    const failure = page.getByText(/The lists below are incomplete/i);
    await expect(failure).toContainText('code template libraries');
    await expect(failure).toContainText('library resources');
    await expect(failure).toContainText('channel dependencies');
    await expect(failure).toContainText('the channel list');
});
