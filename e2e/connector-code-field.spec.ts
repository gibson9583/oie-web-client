import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel, CASES } from './connector-fixtures.js';

/*
 * Connector code fields (react-forms CodeField): the editor keeps every
 * keystroke when renders lag behind typing, and a programmatic property change
 * (Web Service Generate Envelope) still reaches the editor.
 */

const connector = (name: string, patch: any = {}) => {
    const c = CASES.find((k: any) => k.name === name)!;
    return { transportName: c.name, properties: { ...(c.properties as any)(), ...patch } };
};
const models = (page: any) => page.evaluate(() => (window as any).monaco.editor.getModels()
    .map((m: any) => m.getValue()).join('|'));

test('typing into a connector code field keeps every keystroke on a slow machine', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'CPU throttling is a Chromium DevTools feature');
    const id = 'code-field-typing';
    await mockEngine(page, { [`GET /channels/${id}`]: { channel: makeChannel(id, { source: connector('JavaScript Reader') }) } });
    await page.goto(`/channels/${id}/edit`);
    await page.getByRole('tab', { name: 'Source', exact: true }).click();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 8 });
    await page.locator('.ce .monaco-editor').first().click();
    await page.keyboard.press('ControlOrMeta+End');
    const text = 'typedQuicklyabcdefghijklmnop';
    await page.keyboard.type(text);
    await expect.poll(() => models(page)).toContain(text);
});

test('Generate Envelope replaces the SOAP envelope in the editor', async ({ page }) => {
    const id = 'code-field-envelope';
    const envelope = '<soapenv:Envelope><soapenv:Body>generated</soapenv:Body></soapenv:Envelope>';
    await mockEngine(page, {
        [`GET /channels/${id}`]: { channel: makeChannel(id, {
            destination: connector('Web Service Sender', { operation: 'getPatient', envelope: '', soapAction: '' })
        }) },
        'POST /connectors/ws/_isWsdlCached': { boolean: true },
        'POST /connectors/ws/_generateEnvelope': envelope,
        'POST /connectors/ws/_getSoapAction': 'urn:getPatient'
    });
    await page.goto(`/channels/${id}/edit`);
    await page.getByRole('tab', { name: 'Destinations', exact: true }).click();
    await expect(page.locator('.ce .monaco-editor').first()).toBeVisible();
    await page.getByRole('button', { name: 'Generate Envelope', exact: true }).click();
    await expect.poll(() => models(page)).toContain(envelope);
});
