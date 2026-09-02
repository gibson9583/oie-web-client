import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { CASES, makeChannel } from './connector-fixtures.js';

/*
 * Every connector (source AND destination) must save a VALID, enable-able channel.
 *
 * The channel is persisted as JSON. A File Reader/Writer was serializing
 * "schemeProperties": null, which the engine stores as an empty <schemeProperties/>
 * typed as the ABSTRACT com.mirth.connect.connectors.file.SchemeProperties — it then
 * can't deserialize it, so the channel SAVES but is INVALID and stays DISABLED. In
 * the mocked e2e there is no engine to flip enabled/disabled, so the meaningful
 * signal is the outgoing PUT payload: it must be free of these poison shapes. A
 * disabled channel on a real engine == an invalid payload here.
 *
 * For each connector, in its applicable mode (receivers as SOURCE, dispatchers as
 * DESTINATION), we seed a channel using that connector's DEFAULT properties (the
 * fixtures deliberately carry `schemeProperties: null`, mirroring a real export),
 * open its panel — opening the panel is what runs the connector's load-time
 * normalization (File's ensureSchemeProperties deletes the null key) — dirty the
 * channel, Save, and assert the captured PUT body is valid.
 */

const asArray = (v: any) => (Array.isArray(v) ? v : v == null ? [] : [v]);

/* Deep-walk the parsed payload, collecting every path where a key ending in
   "schemeProperties" (any case) is null — the exact poison shape. An empty array
   means the payload is clean. */
function findNullSchemeProperties(value: any, path = '') {
    const hits: any[] = [];
    if (Array.isArray(value)) {
        value.forEach((v: any, i: any) => hits.push(...findNullSchemeProperties(v, `${path}[${i}]`)));
    } else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
            const p = path ? `${path}.${k}` : k;
            if (/schemeProperties$/i.test(k) && v === null) hits.push(p);
            hits.push(...findNullSchemeProperties(v, p));
        }
    }
    return hits;
}

for (const c of CASES) {
    test(`${c.name} (${c.mode}) saves a valid, enable-able channel`, async ({ page }) => {
        const id = `sv-${c.name.toLowerCase().replace(/\s+/g, '-')}-${c.mode.toLowerCase()}`;
        const channel = c.mode === 'SOURCE'
            ? makeChannel(id, { source: { transportName: c.name, properties: c.properties() } })
            : makeChannel(id, { destination: { transportName: c.name, properties: c.properties() } });

        await mockEngine(page, { [`GET /channels/${id}`]: { channel } });

        // Capture the PUT body; fall through to the mock for everything else.
        let putBody: any = null;
        await page.route((url) => url.pathname === `/api/channels/${id}`, async (route) => {
            const req = route.request();
            if (req.method() === 'PUT') { putBody = req.postData(); return route.fulfill({ status: 200, contentType: 'text/plain', body: '' }); }
            return route.fallback();
        });

        await page.goto(`/channels/${id}/edit`);
        await expect(page.getByRole('tab', { name: 'Summary', exact: true })).toBeVisible();

        // Mount the connector panel — this triggers the connector's load-time
        // normalization (e.g. File's ensureSchemeProperties strips schemeProperties:null).
        const tab = c.mode === 'SOURCE' ? 'Source' : 'Destinations';
        await page.getByRole('tab', { name: tab, exact: true }).click();
        if (c.mode === 'DESTINATION') {
            // Select the destination row (its Type cell shows the transportName) so
            // its editor — and the connector panel — renders.
            await page.getByRole('cell', { name: c.name, exact: true }).first().click();
        }
        await expect(page.locator('.cform-section').first()).toBeVisible();

        // Dirty the channel via the Summary Name (a short fixed name stays under the
        // 40-char channel-name limit), then Save.
        await page.getByRole('tab', { name: 'Summary', exact: true }).click();
        const nameField = page.locator('.panel input[type=text]').first();
        await expect(nameField).toHaveValue(channel.name);
        await nameField.fill('Edited Channel');
        await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect.poll(() => putBody, { timeout: 8000 }).not.toBeNull();

        const payload = JSON.parse(putBody);
        const sent = payload.channel;
        const props = c.mode === 'SOURCE'
            ? sent.sourceConnector.properties
            : asArray(sent.destinationConnectors.connector)[0].properties;

        // The connector serialized with the correct concrete @class.
        expect(props['@class']).toBe(c.class);

        // The exact bug: a literal "schemeProperties":null anywhere in the JSON means
        // the channel would save DISABLED. (JSON.stringify emits no space after the
        // colon, so this substring is exactly what a poisoned payload contains.)
        expect(putBody).not.toContain('"schemeProperties":null');

        // General guard: NO property whose key ends in schemeProperties/SchemeProperties
        // is null, deep-walked over the whole payload.
        expect(findNullSchemeProperties(payload)).toEqual([]);

        // The channel's enabled metadata must not be forced off (present only on
        // channels carrying exportData; a disabled channel is exactly the symptom).
        const meta = sent.exportData?.metadata;
        if (meta && 'enabled' in meta) expect(meta.enabled).not.toBe(false);
    });
}

/*
 * Switching Method INSIDE the panel and saving immediately must also omit
 * schemeProperties for FILE/WEBDAV. The load-time cleanup the tests above
 * exercise doesn't run here: a scheme change only repaints the form, so if the
 * change handler writes schemeProperties:null, only tabbing away and back
 * (a remount) would heal the payload before the PUT.
 */
const ftpSchemeProperties = () => ({ '@class': 'com.mirth.connect.connectors.file.FTPSchemeProperties', initialCommands: null });

for (const s of [
    { name: 'File Reader', mode: 'SOURCE', to: 'FILE' },
    { name: 'File Writer', mode: 'DESTINATION', to: 'WEBDAV' }
]) {
    test(`${s.name}: switching Method from FTP to ${s.to} then saving sends no schemeProperties`, async ({ page }) => {
        const id = `sv-scheme-switch-${s.mode.toLowerCase()}`;
        const c = CASES.find((x) => x.name === s.name);
        const properties = { ...c!.properties(), scheme: 'FTP', schemeProperties: ftpSchemeProperties() };
        const channel = s.mode === 'SOURCE'
            ? makeChannel(id, { source: { transportName: s.name, properties } })
            : makeChannel(id, { destination: { transportName: s.name, properties } });

        await mockEngine(page, { [`GET /channels/${id}`]: { channel } });

        let putBody: any = null;
        await page.route((url) => url.pathname === `/api/channels/${id}`, async (route) => {
            const req = route.request();
            if (req.method() === 'PUT') { putBody = req.postData(); return route.fulfill({ status: 200, contentType: 'text/plain', body: '' }); }
            return route.fallback();
        });

        await page.goto(`/channels/${id}/edit`);
        await expect(page.getByRole('tab', { name: 'Summary', exact: true })).toBeVisible();
        const tab = s.mode === 'SOURCE' ? 'Source' : 'Destinations';
        await page.getByRole('tab', { name: tab, exact: true }).click();
        if (s.mode === 'DESTINATION') {
            await page.getByRole('cell', { name: s.name, exact: true }).first().click();
        }
        await expect(page.locator('.cform-section').first()).toBeVisible();

        // The repro: switch Method, then Save without leaving the panel.
        await page.locator('[data-fkey="scheme"]').first().selectOption(s.to);
        await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect.poll(() => putBody, { timeout: 8000 }).not.toBeNull();

        const payload = JSON.parse(putBody);
        const props = s.mode === 'SOURCE'
            ? payload.channel.sourceConnector.properties
            : asArray(payload.channel.destinationConnectors.connector)[0].properties;

        expect(props.scheme).toBe(s.to);
        // The key must be ABSENT — not null, not an empty object.
        expect('schemeProperties' in props).toBe(false);
        expect(putBody).not.toContain('"schemeProperties":null');
        expect(findNullSchemeProperties(payload)).toEqual([]);
    });
}
