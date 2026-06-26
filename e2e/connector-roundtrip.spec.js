import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';
import { CASES, makeChannel } from './connector-fixtures.js';

/*
 * Per-connector serialization safety net. The existing channel-roundtrip.spec.js
 * only edits the Summary Name and never opens a connector panel, so the connector
 * .jsx read/write path is untested. Here, for each connector, we load a channel
 * that uses it, OPEN its property panel (Source or Destinations tab → the panel
 * mounts and reads the loaded properties), make a trivial channel-level edit, Save,
 * and assert the serialized connector `properties` still deep-equal the fixture.
 *
 * A correct panel renders loaded properties without mutating them, so toEqual is
 * the real net: any field a panel drops/renames/reorders/normalizes on load fails
 * here before it can silently break a deploy.
 */

const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

for (const c of CASES) {
    test(`${c.name} (${c.mode}) round-trips its properties`, async ({ page }) => {
        const id = `rt-${c.name.toLowerCase().replace(/\s+/g, '-')}-${c.mode.toLowerCase()}`;
        const expected = c.properties();
        const channel = c.mode === 'SOURCE'
            ? makeChannel(id, { source: { transportName: c.name, properties: c.properties() } })
            : makeChannel(id, { destination: { transportName: c.name, properties: c.properties() } });

        await mockEngine(page, { [`GET /channels/${id}`]: { channel } });

        // Capture the PUT body; fall through to the mock for everything else.
        let putBody = null;
        await page.route((url) => url.pathname === `/api/channels/${id}`, async (route) => {
            const req = route.request();
            if (req.method() === 'PUT') { putBody = req.postData(); return route.fulfill({ status: 200, contentType: 'text/plain', body: '' }); }
            return route.fallback();
        });

        await page.goto(`/channels/${id}/edit`);
        await expect(page.getByRole('button', { name: 'Summary', exact: true })).toBeVisible();

        // Mount the connector panel — the step the existing round-trip test skips.
        const tab = c.mode === 'SOURCE' ? 'Source' : 'Destinations';
        await page.getByRole('button', { name: tab, exact: true }).click();
        if (c.mode === 'DESTINATION') {
            // Select the destination row (its Type cell shows the transportName) so
            // its editor — and the connector panel — renders.
            await page.getByRole('cell', { name: c.name, exact: true }).first().click();
        }
        // The connector panel mounted and read the properties (every panel — VM and
        // ConnectorForm — renders a .cform-section). Without this the deep-equal
        // below could pass vacuously on a panel that never rendered.
        await expect(page.locator('.cform-section').first()).toBeVisible();

        // Dirty the channel via the Summary Name, then Save.
        await page.getByRole('button', { name: 'Summary', exact: true }).click();
        const nameField = page.locator('.panel input[type=text]').first();
        await expect(nameField).toHaveValue(channel.name);
        await nameField.fill(`${channel.name} EDITED`);
        await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect.poll(() => putBody, { timeout: 8000 }).not.toBeNull();

        const sent = JSON.parse(putBody).channel;
        const props = c.mode === 'SOURCE'
            ? sent.sourceConnector.properties
            : asArray(sent.destinationConnectors.connector)[0].properties;

        expect(props['@class']).toBe(c.class);   // legible failure for the common case
        expect(props).toEqual(expected);          // the real net: no field mutated on load
    });
}

/* Write path: the read-path loop above proves a panel doesn't corrupt properties
 * on load; this proves it WRITES an edit back. For each connector with an `edit`
 * descriptor we change one panel field and assert the saved properties equal the
 * fixture with exactly that one field updated — so a panel that drops an edit, or
 * writes it to the wrong/extra key, fails here. */
function setAt(obj, key, val) {
    const ks = key.split('.');
    const last = ks.pop();
    ks.reduce((o, k) => o[k], obj)[last] = val;
}

for (const c of CASES.filter((x) => x.edit)) {
    test(`${c.name} (${c.mode}) round-trips an edited panel field`, async ({ page }) => {
        const id = `wt-${c.name.toLowerCase().replace(/\s+/g, '-')}-${c.mode.toLowerCase()}`;
        const channel = c.mode === 'SOURCE'
            ? makeChannel(id, { source: { transportName: c.name, properties: c.properties() } })
            : makeChannel(id, { destination: { transportName: c.name, properties: c.properties() } });

        await mockEngine(page, { [`GET /channels/${id}`]: { channel } });

        let putBody = null;
        await page.route((url) => url.pathname === `/api/channels/${id}`, async (route) => {
            const req = route.request();
            if (req.method() === 'PUT') { putBody = req.postData(); return route.fulfill({ status: 200, contentType: 'text/plain', body: '' }); }
            return route.fallback();
        });

        await page.goto(`/channels/${id}/edit`);
        const tab = c.mode === 'SOURCE' ? 'Source' : 'Destinations';
        await page.getByRole('button', { name: tab, exact: true }).click();
        if (c.mode === 'DESTINATION') await page.getByRole('cell', { name: c.name, exact: true }).first().click();
        await expect(page.locator('.cform-section').first()).toBeVisible();

        // Edit the field in the panel (targeted by its property key), then Save.
        const input = page.locator(`[data-fkey="${c.edit.key}"]`).first();
        await expect(input).toBeVisible();
        await input.fill(String(c.edit.value));
        await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect.poll(() => putBody, { timeout: 8000 }).not.toBeNull();

        const expected = c.properties();
        setAt(expected, c.edit.key, c.edit.value);   // the one field the panel should have changed
        const sent = JSON.parse(putBody).channel;
        const props = c.mode === 'SOURCE'
            ? sent.sourceConnector.properties
            : asArray(sent.destinationConnectors.connector)[0].properties;
        expect(props).toEqual(expected);
    });
}
