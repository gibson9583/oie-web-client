import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';

for (const tag of ['zh-CN', ...(process.env.E2E_PSEUDO === '1' ? ['en-XA'] : [])]) {
    test(`${tag} dense desktop surfaces fit all three density settings`, async ({page}, info) => {
        await page.addInitScript(tag => localStorage.setItem('oie-locale', tag === 'en-XA' ? 'en' : tag), tag);
        await mockEngine(page, { 'GET /channels/visual': {channel:makeChannel('visual')} });
        for (const [route,name] of [['/dashboard','dashboard'],['/channels/visual/edit','channel'],['/settings?tab=Administrator','settings']]) {
            await page.goto(route + (tag === 'en-XA' ? (route.includes('?')?'&':'?')+'locale=en-XA' : ''));
            await expect(page.locator('.shell')).toBeVisible();
            await expect(page.locator('.view-title').first()).toBeVisible({timeout:15000});
            for(const density of ['compact','normal','wide']) {
                await page.evaluate(async density => { const module='/core/store.js'; (await import(module)).setTableDensity(density); },density);
                for (const width of [1024,1440]) {
                    await page.setViewportSize({width,height:900});
                    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
                    if (width === 1440 && density === 'normal') {
                        await page.screenshot({path:info.outputPath(name+'.png')});
                        const audit = await page.evaluate(() => {
                            const visible = (e: Element) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
                            const unmarked: string[] = [];
                            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                                const parent = node.parentElement;
                                const text = node.textContent?.trim() || '';
                                if (parent && visible(parent) && !parent.closest('script, style, option, code, .monaco-editor') &&
                                    /[a-z]{2}/i.test(text) && !/[àƀçðéƒĝĥîĵķļɱñöþɋŕšţûṽŵẋýžÀɃÇÐÉƑĜĤÎĴĶĻṀÑÖÞɊŔŠŢÛṼŴẊÝŽ]/.test(text)) unmarked.push(text);
                            }
                            const clipped = [...document.querySelectorAll('button, .pane-title, .field > label')]
                                .filter(e => visible(e) && e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 2)
                                .map(e => ({text:e.textContent?.trim(), width:e.clientWidth, content:e.scrollWidth}));
                            return {unmarked:[...new Set(unmarked)],clipped};
                        });
                        await info.attach(name+'-text-audit', {body:JSON.stringify(audit,null,2),contentType:'application/json'});
                        expect(audit.clipped, name + ' control labels').toEqual([]);
                        if (tag === 'en-XA') {
                            // Fixture data, native locale names and the Intl clock are not messages.
                            const data = new Set(['test · E2E Engine · v4.6.0', 'EST', 'admin', 'Demo Started', 'Demo Stopped', 'visual', 'desc']);
                            expect(audit.unmarked.filter(value => !data.has(value) && !/^\d{1,2}:\d{2}\s+(?:AM|PM)\s+\S+$/.test(value)), name + ' untranslated text').toEqual([]);
                        }
                    }
                }
            }
        }
    });
}

test('Chinese login fits a narrow viewport and keeps its language picker visible',async({page},info)=>{
    await page.addInitScript(()=>localStorage.setItem('oie-locale','zh-CN'));
    await mockEngine(page,{'GET /users/current':{__status:401}});
    await page.setViewportSize({width:480,height:800}); await page.goto('/');
    await expect(page.getByRole('button',{name:'登录',exact:true})).toBeVisible();
    await expect(page.locator('[data-language-select]')).toBeInViewport();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath('login.png')});
});
