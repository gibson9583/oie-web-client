import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * Guided Alert wizard: the New Alert chooser, the step flow (Basics → Trigger →
 * Channels → Actions → Review), name validation, adding actions, Create, and the
 * prompt-on-leave. Produces a normal alert (POST /alerts) — default fixtures cover it.
 */

const next = (page) => page.getByRole('button', { name: 'Next', exact: true });
const nameField = (page) => page.locator('.view-body input[type="text"]').first();

test.describe('alert wizard', () => {
    test('New Alert chooser routes to the wizard', async ({ page }) => {
        await mockEngine(page);
        await page.goto('/alerts');
        await page.getByRole('button', { name: 'New Alert' }).first().click();
        await expect(page.getByText('Wizard', { exact: true })).toBeVisible();
        await expect(page.getByText('Classic editor')).toBeVisible();

        await page.getByText('Wizard', { exact: true }).click();
        await expect(page).toHaveURL(/\/alerts\/new\/guided/);
        await expect(page.getByText('Basics', { exact: true })).toBeVisible();
    });

    test('walks every step and creates the alert', async ({ page }) => {
        let posted = false;
        page.on('request', (r) => {
            if (r.method() === 'POST' && /\/api\/alerts$/.test(new URL(r.url()).pathname)) posted = true;
        });
        await mockEngine(page);
        await page.goto('/alerts/new/guided');

        await expect(next(page)).toBeDisabled();
        await nameField(page).fill('My Alert');
        await expect(next(page)).toBeEnabled();
        await next(page).click();   // Trigger

        await expect(page.getByText('Error types')).toBeVisible();
        await next(page).click();   // Channels
        await expect(page.getByText('Channels to watch')).toBeVisible();
        await next(page).click();   // Actions
        await expect(page.getByText('Notifications')).toBeVisible();
        await next(page).click();   // Review

        await expect(page.getByText('My Alert')).toBeVisible();
        // Create from the footer (the same action also lives in the task rail).
        await page.getByRole('main').getByRole('button', { name: 'Create Alert', exact: true }).click();
        await expect(page).toHaveURL(/\/alerts$/, { timeout: 10_000 });
        expect(posted).toBe(true);
    });

    test('adds a notification action', async ({ page }) => {
        await mockEngine(page);
        await page.goto('/alerts/new/guided');
        await nameField(page).fill('Act Alert');
        await next(page).click();   // Trigger
        await next(page).click();   // Channels
        await next(page).click();   // Actions

        await page.getByRole('button', { name: /Add action/ }).click();
        await expect(page.locator('select:has(option[value="Email"])')).toBeVisible();
    });

    test('an invalid error-filter regex blocks advancing', async ({ page }) => {
        await mockEngine(page);
        await page.goto('/alerts/new/guided');
        await nameField(page).fill('Rx Alert');
        await next(page).click();   // Trigger

        await page.locator('.view-body textarea').fill('([');   // invalid regex
        await next(page).click();
        await expect(page.locator('.view-body').getByText(/Invalid regular expression/)).toBeVisible();
        await expect(page.getByText('Error types')).toBeVisible();   // still on Trigger
    });

    test('prompts to save when leaving with unsaved changes', async ({ page }) => {
        await mockEngine(page);
        await page.goto('/alerts/new/guided');
        await nameField(page).fill('Leave Alert');

        // "Back to Alerts" (in the task rail) leaves the wizard → save prompt.
        await page.getByRole('button', { name: 'Back to Alerts', exact: true }).click();
        await expect(page.getByText(/before leaving/)).toBeVisible();
        await page.getByRole('button', { name: 'Discard', exact: true }).click();
        await expect(page).toHaveURL(/\/alerts$/);
    });

    test('opens an existing alert with all steps navigable and a Save button', async ({ page }) => {
        const AL = 'ax';
        const existing = {
            '@version': '4.6.0', id: AL, name: 'Existing Alert', enabled: true,
            trigger: {
                '@class': 'defaultTrigger',
                alertChannels: { newChannelSource: false, newChannelDestination: false, enabledChannels: null, disabledChannels: null, partialChannels: null },
                errorEventTypes: { errorEventType: ['ANY'] }, regex: ''
            },
            actionGroups: { alertActionGroup: [{ actions: null, subject: '', template: '' }] },
            properties: null
        };
        await mockEngine(page, { [`GET /alerts/${AL}`]: { alertModel: existing } });
        await page.goto(`/alerts/${AL}/guided`);

        // Loaded as an existing alert (not "New Alert"), every step already visited.
        await expect(page.getByText('Existing Alert — Wizard')).toBeVisible();
        await page.locator('.wiz-step', { hasText: 'Review' }).click();

        // No edits yet → the footer just exits (never "Create Alert").
        const footer = page.getByRole('main');
        await expect(footer.getByRole('button', { name: 'Exit', exact: true })).toBeVisible();
        await expect(footer.getByRole('button', { name: 'Create Alert', exact: true })).toHaveCount(0);

        // Make a change → the footer becomes "Save Alert".
        await page.locator('.wiz-step', { hasText: 'Basics' }).click();
        await page.locator('.view-body input[type="text"]').first().fill('Existing Alert Renamed');
        await page.locator('.wiz-step', { hasText: 'Review' }).click();
        await expect(footer.getByRole('button', { name: 'Save Alert', exact: true })).toBeVisible();
        await expect(footer.getByRole('button', { name: 'Exit', exact: true })).toHaveCount(0);
    });
});
