import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { CASES, makeChannel } from './connector-fixtures.js';

// Exercise every real panel's read/write path with labels in another language.
// Values, class names, IDs, scripts, nested maps and defaults must be identical.
for (const tag of ['zh-CN', ...(process.env.E2E_PSEUDO === '1' ? ['en-XA'] : [])]) {
    for (const c of CASES) test(`${tag}: ${c.name} ${c.mode} preserves connector properties`, async ({ page }) => {
        await page.addInitScript(tag => localStorage.setItem('oie-locale', tag === 'en-XA' ? 'en' : tag), tag);
        const channel = c.mode === 'SOURCE' ? makeChannel('locale-panel', {source:{transportName:c.name,properties:c.properties()}})
            : makeChannel('locale-panel', {destination:{transportName:c.name,properties:c.properties()}});
        await mockEngine(page, { 'GET /channels/locale-panel': {channel} });
        await page.goto('/channels/locale-panel/edit' + (tag === 'en-XA' ? '?locale=en-XA' : ''));
        await expect(page.locator('html')).toHaveAttribute('lang', tag);
        const labels = await page.evaluate(async () => {
            const pkg='@oie/web-ui', {t}=await import(pkg);
            return {summary:t('Summary'),source:t('Source'),destinations:t('Destinations'),save:t('Save Changes')};
        });
        await page.getByRole('tab',{name:c.mode==='SOURCE'?labels.source:labels.destinations,exact:true}).click();
        if(c.mode==='DESTINATION') await page.getByRole('cell',{name:c.name,exact:true}).first().click();
        await expect(page.locator('.cform-section').first()).toBeVisible();
        await page.getByRole('tab',{name:labels.summary,exact:true}).click();
        await page.locator('.panel input[type=text]').first().fill('Locale Panel');
        const sent=page.waitForRequest(r=>r.method()==='PUT'&&new URL(r.url()).pathname==='/api/channels/locale-panel');
        await page.getByRole('button',{name:labels.save,exact:true}).click();
        const saved=JSON.parse((await sent).postData()!).channel;
        const dest=saved.destinationConnectors.connector;
        expect(c.mode==='SOURCE'?saved.sourceConnector.properties:(Array.isArray(dest)?dest[0]:dest).properties).toEqual(c.properties());
    });
}
