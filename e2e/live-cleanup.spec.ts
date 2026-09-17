import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { listen, startWebAdmin } from './server-harness.js';
import { removeMatchingChannels } from './live-cleanup.js';

test('F19: cleanup passes the session fence and removes only its owned channel', async ({ page }) => {
    const removed: string[] = [];
    const channels = [{ id: 'owned', name: 'unique owned smoke' }, { id: 'shared', name: 'Shared channel' }];
    const engine = await listen((req, res) => {
        req.resume();
        if (req.url === '/api/users/_login') {
            res.setHeader('Set-Cookie', 'JSESSIONID=synthetic-session; Path=/api; HttpOnly');
            res.end('');
        } else if (req.method === 'DELETE') {
            const id = req.url!.split('/').at(-1)!;
            removed.push(id);
            channels.splice(channels.findIndex(c => c.id === id), 1);
            res.end('');
        } else {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ list: { channel: channels } }));
        }
    });
    const app = await startWebAdmin({ engine: { url: engine.url, verifyTls: false } });
    try {
        await page.request.post(app.url + '/api/users/_login');
        await mockEngine(page);
        await page.route('**/api/channels', route => route.continue());
        await page.route('**/api/channels/owned', route => route.continue());
        await page.goto(app.url + '/dashboard');
        await expect(page.locator('.shell')).toBeVisible();
        const unbound = await page.request.delete(app.url + '/api/channels/owned');
        expect(unbound.status()).toBe(409);
        expect(removed).toEqual([]);
        await removeMatchingChannels(page, '/api', 'unique owned smoke');
        await removeMatchingChannels(page, '/api', 'unique owned smoke');
        expect(removed).toEqual(['owned']);
        expect(channels).toEqual([{ id: 'shared', name: 'Shared channel' }]);
    } finally {
        app.stop();
        engine.server.closeAllConnections();
        engine.server.close();
    }
});
