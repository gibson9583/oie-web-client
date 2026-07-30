import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

test.beforeEach(async ({ page }) => {
    await mockEngine(page);
});

// The alert editor is now a React view (react/views/alert-editor.jsx). Reached
// via New Alert from the list; renders the error-types / regex / channels tree
// row and the actions / template / variables row.
test('New Alert opens the React editor', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Alerts', exact: true }).click();
    await expect(page).toHaveURL(/\/alerts/);

    await page.getByRole('button', { name: 'New Alert' }).click();
    await page.getByText('Classic editor').click();
    await expect(page).toHaveURL(/\/alerts\/.*\/edit/);

    // Editor panels render (scope to the editor's panel headers — "Channels"
    // also appears as a nav item, so match the header element specifically).
    await expect(page.locator('.panel-header', { hasText: 'Errors (select all that apply)' })).toBeVisible();
    await expect(page.locator('.panel-header', { hasText: 'Channels' })).toBeVisible();
    await expect(page.locator('.panel-header', { hasText: 'Actions' })).toBeVisible();
    await expect(page.locator('.panel-header', { hasText: 'Alert Variables' })).toBeVisible();
    // Task pane.
    await expect(page.getByRole('button', { name: 'Save Alert' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to Alerts' })).toBeVisible();
});

// Adding actions: via the Add button AND via the right-click menu (Swing parity).
test('alert editor adds an action via the Add button and via right-click', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Alerts', exact: true }).click();
    await page.getByRole('button', { name: 'New Alert' }).click();
    await page.getByText('Classic editor').click();
    await expect(page).toHaveURL(/\/alerts\/.*\/edit/);

    // Starts with no actions.
    await expect(page.getByText('No actions defined')).toBeVisible();

    // Scope to the Actions panel's table (the Channels tree is also a table.dt).
    const actionRows = page.locator('.panel')
        .filter({ has: page.locator('.panel-header', { hasText: 'Actions' }) })
        .locator('table.dt tbody tr');

    // Add via the Add button — the placeholder is replaced by an actions table.
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('No actions defined')).toHaveCount(0);
    await expect(actionRows).toHaveCount(1);

    // Add a second action via the right-click menu.
    await actionRows.first().click({ button: 'right' });
    await page.getByRole('menu').getByText('Add Action').click();
    await expect(actionRows).toHaveCount(2);
});

// Cold deep link into the alert editor. Both existing tests in this file reach
// the editor via New Alert -> Classic editor, which hands the model over IN THE
// STORE (alerts.jsx startClassicAlert seeds store.editingAlert, then navigates),
// so the editor's own fetch path is never exercised. page.goto boots it with an
// empty store: load() must fall back to api.alerts.get and build the whole form
// from the response.
test('a cold deep link to /alerts/:alertId/edit fetches and renders the alert', async ({ page }) => {
    const AL = 'al-1';
    // The default fixtures only serve the alerts LIST; the editor GETs the single
    // alert (and a second time for the conflict baseline), so it needs its own key.
    const existing = {
        '@version': '4.5.0', id: AL, name: 'Error Alert', enabled: true,
        trigger: {
            '@class': 'defaultTrigger',
            alertChannels: {
                newChannelSource: false, newChannelDestination: false,
                enabledChannels: null, disabledChannels: null, partialChannels: null,
            },
            errorEventTypes: { errorEventType: ['ANY'] },
            regex: 'HL7 parse failure',
        },
        actionGroups: { alertActionGroup: [{ actions: null, subject: 'Alert subject', template: 'Alert body' }] },
        properties: null,
    };
    await mockEngine(page, { [`GET /alerts/${AL}`]: { alertModel: existing } });

    await page.goto(`/alerts/${AL}/edit`);

    // Fields seeded from the FETCHED payload (name / regex / subject) — the form
    // state is built in initForm from the response body, not from any route param.
    // The alert name is the first text input in the body (the channel filter box
    // comes later in the DOM).
    await expect(page.locator('.view-body input[type=text]').first())
        .toHaveValue('Error Alert', { timeout: 15_000 });
    await expect(page.getByPlaceholder(/Only trigger when the error matches/))
        .toHaveValue('HL7 parse failure');

    // Panel row unique to the classic alert editor.
    await expect(page.locator('.panel-header', { hasText: 'Errors (select all that apply)' })).toBeVisible();
    await expect(page.locator('.panel-header', { hasText: 'Regex (optional)' })).toBeVisible();
    await expect(page.locator('.panel-header', { hasText: 'Alert Variables' })).toBeVisible();

    // The channels tree was built from GET /channels (connector granularity).
    await expect(page.getByText('Demo Started')).toBeVisible();

    // The view's own task pane (portaled into the rail by <ViewTasks>).
    await expect(page.locator('.rail-pane', { hasText: 'Alert Edit Tasks' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save Alert', exact: true })).toBeVisible();

    // The banner is re-stamped by the view's own load() with the fetched NAME;
    // the router's static route title is only 'Edit Alert'.
    await expect(page.locator('.view-title')).toHaveText('Edit Alert - Error Alert');

    // Not the load-error state.
    await expect(page.getByText(/Could not load alert/)).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/alerts/${AL}/edit$`));
    expect(page.url()).not.toContain('#');
});

// Saving redirects to the alerts list, which is a TanStack Query with a 30s
// staleTime whose cache OUTLIVES this view — so unless the save invalidates
// ['alerts'], the list repaints its pre-edit rows and only corrects itself
// whenever its 5s background poll next ticks. The assertion window below is
// deliberately shorter than that poll, so only invalidation can satisfy it.
test('saving an alert leaves the list showing the new name, not the pre-edit one', async ({ page }) => {
    const AL = 'al-1';
    // One mutable server-side copy: the PUT updates it, and both the list and the
    // single-alert GET are served from it (the latter also feeds the conflict
    // baseline, which must match or the save prompts instead of writing).
    let stored = {
        '@version': '4.5.0', id: AL, name: 'Error Alert', enabled: true,
        trigger: {
            '@class': 'defaultTrigger',
            alertChannels: {
                newChannelSource: false, newChannelDestination: false,
                enabledChannels: null, disabledChannels: null, partialChannels: null,
            },
            errorEventTypes: { errorEventType: ['ANY'] },
            regex: '',
        },
        actionGroups: { alertActionGroup: [{ actions: null, subject: 's', template: 't' }] },
        properties: null,
    };
    await mockEngine(page, {
        'GET /alerts': () => ({ list: { alertModel: [
            { id: AL, name: stored.name, enabled: true },
            { id: 'al-2', name: 'Deploy Alert', enabled: false },
        ] } }),
        [`GET /alerts/${AL}`]: () => ({ alertModel: stored }),
        [`PUT /alerts/${AL}`]: (req) => {
            const body = JSON.parse(req.postData() || '{}');
            if (body.alertModel) stored = body.alertModel;
            return {};
        },
    });

    // Reach the editor from the list, so the list's query is mounted and cached
    // first — that cache is what goes stale.
    await page.goto('/alerts');
    await page.locator('tr', { hasText: 'Error Alert' }).first().click();
    await page.getByRole('button', { name: 'Edit Alert', exact: true }).click();

    const nameInput = page.locator('.view-body input[type=text]').first();
    await expect(nameInput).toHaveValue('Error Alert', { timeout: 15_000 });
    await nameInput.fill('Error Alert RENAMED');
    await page.getByRole('button', { name: 'Save Alert', exact: true }).click();

    await expect(page).toHaveURL(/\/alerts$/);
    // The cell, not the save toast (which quotes the same name).
    await expect(page.getByRole('cell', { name: 'Error Alert RENAMED' })).toBeVisible({ timeout: 2000 });
});
