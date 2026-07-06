import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * Channel wizard: the New Channel chooser, the step flow (Basics → Dependencies →
 * Channel Options → Source → Destinations → Scripts → Review), name validation, the
 * embedded filter/transformer editor, and Create / Create & Deploy. The wizard
 * produces a normal channel (POST /channels), so the mock's default fixtures cover it.
 */

const next = (page) => page.getByRole('button', { name: 'Next', exact: true });

test.describe('channel wizard', () => {
    test('New Channel chooser offers classic and wizard, and routes to it', async ({ page }) => {
        await mockEngine(page);
        await page.goto('/channels');

        await page.getByRole('button', { name: 'New Channel' }).first().click();
        await expect(page.getByText('Wizard', { exact: true })).toBeVisible();
        await expect(page.getByText('Classic editor')).toBeVisible();

        await page.getByText('Wizard', { exact: true }).click();
        await expect(page).toHaveURL(/\/channels\/new\/guided/);
        await expect(page.getByText('Basics', { exact: true })).toBeVisible();
    });

    test('walks every step and creates the channel', async ({ page }) => {
        let posted = false;
        page.on('request', (r) => {
            if (r.method() === 'POST' && /\/api\/channels$/.test(new URL(r.url()).pathname)) posted = true;
        });
        await mockEngine(page);
        await page.goto('/channels/new/guided');

        // Basics — Next disabled until a name is entered.
        await expect(next(page)).toBeDisabled();
        await page.locator('.view-body input').first().fill('Wizard Channel');
        await expect(next(page)).toBeEnabled();
        await next(page).click();

        // Dependencies — code-template libraries + resources tabs.
        await expect(page.getByRole('button', { name: 'Code Template Libraries', exact: true })).toBeVisible();
        await next(page).click();

        // Channel Options — the message-storage slider.
        await expect(page.getByText('Message Storage')).toBeVisible();
        await expect(page.getByText('Production', { exact: true })).toBeVisible();
        await next(page).click();

        // Source — transport picker + Transformer tab.
        await expect(page.getByText('Connector type')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Transformer', exact: true })).toBeVisible();
        await next(page).click();

        // Destinations — default Destination 1, with a Response tab.
        await expect(page.getByText('Destination 1')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Response', exact: true })).toBeVisible();
        await next(page).click();

        // Scripts.
        await expect(page.getByText('Runs once when the channel is deployed.')).toBeVisible();
        await next(page).click();

        // Review — proper casing (Started, not started) then Create.
        await expect(page.getByText('Wizard Channel')).toBeVisible();
        await expect(page.getByText('Started', { exact: true })).toBeVisible();
        // Create from the footer (the same action also lives in the task rail).
        await page.getByRole('main').getByRole('button', { name: 'Create Channel', exact: true }).click();

        await expect(page).toHaveURL(/\/channels$/, { timeout: 10_000 });
        expect(posted).toBe(true);
    });

    test('lets you jump back to any visited step via the stepper', async ({ page }) => {
        await mockEngine(page);
        await page.goto('/channels/new/guided');
        await page.locator('.view-body input').first().fill('Nav Channel');
        // Advance to Source (Basics → Dependencies → Channel Options → Source).
        await next(page).click();
        await next(page).click();
        await next(page).click();
        await expect(page.getByText('Connector type')).toBeVisible();

        // Jump back to Basics via the chevron, then forward to Source again — both visited.
        await page.locator('.wiz-step', { hasText: 'Basics' }).click();
        await expect(page.locator('.view-body input').first()).toHaveValue('Nav Channel');
        await page.locator('.wiz-step', { hasText: 'Source' }).click();
        await expect(page.getByText('Connector type')).toBeVisible();
    });

    test('dependencies step has all three tabs, and a Classic-editor switch is offered', async ({ page }) => {
        await mockEngine(page);
        await page.goto('/channels/new/guided');
        await expect(page.getByRole('button', { name: 'Classic editor', exact: true })).toBeVisible();

        await page.locator('.view-body input').first().fill('Deps Channel');
        await next(page).click();   // Dependencies
        await expect(page.getByRole('button', { name: 'Code Template Libraries', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Library Resources', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Deploy/Start Dependencies', exact: true })).toBeVisible();
    });

    test('channel options expose the attachment handler and tags', async ({ page }) => {
        await mockEngine(page);
        await page.goto('/channels/new/guided');
        await page.locator('.view-body input').first().fill('Opt Channel');
        await next(page).click();   // Dependencies
        await next(page).click();   // Channel Options

        await expect(page.getByText('Tags', { exact: true })).toBeVisible();

        // The attachment handler config only appears once "Store attachments" is on.
        await expect(page.getByText('Attachment handler')).toHaveCount(0);
        await page.getByText('Store attachments').click();
        await expect(page.getByText('Attachment handler')).toBeVisible();

        // Switching the attachment handler to Regex reveals its pattern editor.
        await page.locator('select:has(option[value="DICOM"])').selectOption('Regex');
        await expect(page.getByRole('button', { name: /Add pattern/ })).toBeVisible();
    });

    test('deploy dependencies use a filterable modal picker', async ({ page }) => {
        await mockEngine(page, {
            'GET /channels/idsAndNames': { map: { entry: [
                { string: ['id-a', 'Alpha Channel'] },
                { string: ['id-b', 'Beta Channel'] },
            ] } },
        });
        await page.goto('/channels/new/guided');
        await page.locator('.view-body input').first().fill('Dep Picker');
        await next(page).click();   // Dependencies
        await page.getByRole('button', { name: 'Deploy/Start Dependencies', exact: true }).click();
        await page.getByRole('button', { name: /Add channel/ }).first().click();

        // Modal with a filter that narrows the (potentially large) channel list.
        const modal = page.locator('.modal');
        await expect(modal.getByPlaceholder('Filter…')).toBeVisible();
        await modal.getByPlaceholder('Filter…').fill('Beta');
        await expect(modal.getByText('Alpha Channel')).toHaveCount(0);
        await modal.getByText('Beta Channel').click();
        await modal.getByRole('button', { name: /^Add/ }).click();

        await expect(page.getByText('Beta Channel')).toBeVisible();
    });

    test('the transformer tab embeds the full editor (steps + message trees)', async ({ page }) => {
        await mockEngine(page);
        await page.goto('/channels/new/guided');
        await page.locator('.view-body input').first().fill('Tx Channel');
        await next(page).click();   // Dependencies
        await next(page).click();   // Channel Options
        await next(page).click();   // Source

        await page.getByRole('button', { name: 'Transformer', exact: true }).click();
        // The real editor's right-hand reference panel proves the full view is embedded.
        await expect(page.getByRole('button', { name: 'Message Trees', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Message Templates', exact: true })).toBeVisible();

        await page.getByRole('button', { name: /Add Step/ }).click();
        await expect(page.getByText('Mapper', { exact: true }).first()).toBeVisible();
    });

    test('data types are settable on the connector Settings tab', async ({ page }) => {
        await mockEngine(page);
        await page.goto('/channels/new/guided');
        await page.locator('.view-body input').first().fill('DT Channel');
        await next(page).click();   // Dependencies
        await next(page).click();   // Channel Options
        await next(page).click();   // Source

        await expect(page.getByText('Data Types', { exact: true })).toBeVisible();
        await expect(page.getByText('Inbound', { exact: true })).toBeVisible();
        await expect(page.getByText('Outbound', { exact: true })).toBeVisible();
    });

    test('validates the connector before advancing', async ({ page }) => {
        await mockEngine(page);
        await page.goto('/channels/new/guided');
        await page.locator('.view-body input').first().fill('Val Channel');
        await next(page).click();   // Dependencies
        await next(page).click();   // Channel Options
        await next(page).click();   // Source
        await next(page).click();   // Destinations

        // Switch the destination to HTTP Sender, which has a required URL left blank.
        await page.getByRole('button', { name: 'HTTP Sender', exact: true }).click();
        await next(page).click();   // attempt to advance — should be blocked

        // Still on Destinations (its Response tab is present) and a validation message shows.
        await expect(page.getByRole('button', { name: 'Response', exact: true })).toBeVisible();
        await expect(page.getByText(/required/).first()).toBeVisible();
    });

    test('prompts to save when leaving with unsaved changes', async ({ page }) => {
        await mockEngine(page);
        await page.goto('/channels/new/guided');
        await page.locator('.view-body input').first().fill('Leave Me');

        // "Back to Channels" (in the task rail) leaves the wizard → save prompt.
        await page.getByRole('button', { name: 'Back to Channels', exact: true }).click();
        await expect(page.getByText(/before leaving/)).toBeVisible();
        await page.getByRole('button', { name: 'Discard', exact: true }).click();
        await expect(page).toHaveURL(/\/channels$/);
    });

    test('opens an existing channel with all steps navigable and a Save button', async ({ page }) => {
        const CH = 'ch-exist';
        const dt = (io) => ({ '@version': '4.5.0', elements: null, inboundDataType: io, outboundDataType: io, inboundProperties: {}, outboundProperties: {} });
        const existing = {
            '@version': '4.5.0', id: CH, name: 'Existing Channel', nextMetaDataId: 2,
            sourceConnector: {
                metaDataId: 0, name: 'sourceConnector', transportName: 'Channel Reader', mode: 'SOURCE', enabled: true,
                properties: { '@class': 'com.mirth.connect.connectors.vm.VmReceiverProperties', '@version': '4.5.0', pluginProperties: null, sourceConnectorProperties: {} },
                transformer: dt('HL7V2'), filter: { '@version': '4.5.0', elements: null }
            },
            destinationConnectors: { connector: [{
                metaDataId: 1, name: 'Destination 1', transportName: 'Channel Writer', mode: 'DESTINATION', enabled: true, waitForPrevious: true,
                properties: { '@class': 'com.mirth.connect.connectors.vm.VmDispatcherProperties', '@version': '4.5.0', pluginProperties: null, destinationConnectorProperties: {} },
                transformer: dt('HL7V2'), responseTransformer: dt('RAW'), filter: { '@version': '4.5.0', elements: null }
            }] },
            properties: { '@version': '4.5.0', initialState: 'STARTED', messageStorageMode: 'DEVELOPMENT', metaDataColumns: {} },
            exportData: { metadata: { enabled: true, pruningSettings: {} } }
        };
        await mockEngine(page, { [`GET /channels/${CH}`]: { channel: existing } });
        await page.goto(`/channels/${CH}/guided`);

        // Every step is already visited → jump straight to Review (no stepping through).
        await page.locator('.wiz-step', { hasText: 'Review' }).click();
        await expect(page.getByText('Existing Channel', { exact: true })).toBeVisible();
        // No edits yet → footer shows "Exit" + plain "Deploy" (no "Save"), never "Create".
        // (Scope to the footer; the task rail carries its own action buttons.)
        const footer = page.getByRole('main');
        await expect(footer.getByRole('button', { name: 'Exit', exact: true })).toBeVisible();
        await expect(footer.getByRole('button', { name: 'Deploy', exact: true })).toBeVisible();
        await expect(footer.getByRole('button', { name: 'Save Changes', exact: true })).toHaveCount(0);
        await expect(footer.getByRole('button', { name: 'Save & Deploy', exact: true })).toHaveCount(0);

        // Make a change (rename on Basics) → buttons become "Save Changes" / "Save & Deploy".
        await page.locator('.wiz-step', { hasText: 'Basics' }).click();
        await page.locator('.view-body input').first().fill('Existing Channel Renamed');
        await page.locator('.wiz-step', { hasText: 'Review' }).click();
        await expect(footer.getByRole('button', { name: 'Save Changes', exact: true })).toBeVisible();
        await expect(footer.getByRole('button', { name: 'Save & Deploy', exact: true })).toBeVisible();
        await expect(footer.getByRole('button', { name: 'Exit', exact: true })).toHaveCount(0);
    });

    test('editing an existing channel transformer marks it dirty (regression: embedded edit → Save)', async ({ page }) => {
        const CH = 'ch-tx-dirty';
        const dt = (io) => ({ '@version': '4.5.0', elements: null, inboundDataType: io, outboundDataType: io, inboundProperties: {}, outboundProperties: {} });
        const existing = {
            '@version': '4.5.0', id: CH, name: 'Tx Dirty Channel', nextMetaDataId: 2,
            sourceConnector: {
                metaDataId: 0, name: 'sourceConnector', transportName: 'Channel Reader', mode: 'SOURCE', enabled: true,
                properties: { '@class': 'com.mirth.connect.connectors.vm.VmReceiverProperties', '@version': '4.5.0', pluginProperties: null, sourceConnectorProperties: {} },
                transformer: dt('HL7V2'), filter: { '@version': '4.5.0', elements: null }
            },
            destinationConnectors: { connector: [{
                metaDataId: 1, name: 'Destination 1', transportName: 'Channel Writer', mode: 'DESTINATION', enabled: true, waitForPrevious: true,
                properties: { '@class': 'com.mirth.connect.connectors.vm.VmDispatcherProperties', '@version': '4.5.0', pluginProperties: null, destinationConnectorProperties: {} },
                transformer: dt('HL7V2'), responseTransformer: dt('RAW'), filter: { '@version': '4.5.0', elements: null }
            }] },
            properties: { '@version': '4.5.0', initialState: 'STARTED', messageStorageMode: 'DEVELOPMENT', metaDataColumns: {} },
            exportData: { metadata: { enabled: true, pruningSettings: {} } }
        };
        await mockEngine(page, { [`GET /channels/${CH}`]: { channel: existing } });
        await page.goto(`/channels/${CH}/guided`);

        // Edit the embedded transformer (open it + add a step). Previously the embedded
        // editor's onChange never reached the WIZARD, so an existing channel's transformer
        // edits were silently discarded (no Save shown). Now it marks the wizard dirty →
        // the "Save Changes" task appears in the rail.
        await page.locator('.wiz-step', { hasText: 'Source' }).click();
        await page.getByRole('button', { name: 'Transformer', exact: true }).click();
        await page.getByRole('button', { name: /Add Step/ }).click();
        await expect(page.locator('.taskbar').getByText('Save Changes')).toBeVisible();
    });

    test('blocks a duplicate channel name', async ({ page }) => {
        await mockEngine(page, {
            // idsAndNames wire shape: a single 'map' root key the proxy unwraps to
            // { entry: [ { string: [id, name] } ] }.
            'GET /channels/idsAndNames': { map: { entry: [{ string: ['abc', 'Taken Name'] }] } },
        });
        await page.goto('/channels/new/guided');
        await expect(page.getByText('Basics', { exact: true })).toBeVisible();

        await page.locator('.view-body input').first().fill('Taken Name');
        await expect(page.getByText(/already exists/)).toBeVisible();
        await expect(next(page)).toBeDisabled();
    });

    test('adds a second destination', async ({ page }) => {
        await mockEngine(page);
        await page.goto('/channels/new/guided');
        await page.locator('.view-body input').first().fill('Multi Dest');
        await next(page).click();   // Dependencies
        await next(page).click();   // Channel Options
        await next(page).click();   // Source
        await next(page).click();   // Destinations

        await expect(page.getByText('Destination 1')).toBeVisible();
        await page.getByRole('button', { name: 'Add', exact: true }).click();
        await expect(page.getByText('Destination 2')).toBeVisible();
    });

    test('"wait for previous" appears only from the second destination', async ({ page }) => {
        await mockEngine(page);
        await page.goto('/channels/new/guided');
        await page.locator('.view-body input').first().fill('Wait Channel');
        await next(page).click();   // Dependencies
        await next(page).click();   // Channel Options
        await next(page).click();   // Source
        await next(page).click();   // Destinations

        // First destination has nothing before it.
        await expect(page.getByText('Wait for previous destination')).toHaveCount(0);
        // Destination Settings (queue) is present above the connector panel.
        await expect(page.getByText('Destination Settings')).toBeVisible();

        await page.getByRole('button', { name: 'Add', exact: true }).click();
        await expect(page.getByText('Wait for previous destination')).toBeVisible();
    });
});
