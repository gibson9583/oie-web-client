import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

/*
 * platform.registerMessageAction — a plugin's per-message action in the message
 * browser. One registration surfaces in two places: the row right-click menu
 * (any row) and the Message Tasks pane (the selected row). onInvoke receives the
 * engine Message plus a ctx naming the connector row (metaDataId +
 * connectorMessage), isEnabled(ctx) gates per row, and the action's `task` flows
 * through the RBAC gate under the `message` group like every built-in item.
 */

const CID = 'c-started';

// One message with a source (metaDataId 0) and one destination (metaDataId 1),
// in the XStream Map<Integer,ConnectorMessage> wire shape the client decodes.
const MESSAGE = {
    messageId: '12345', channelId: CID, serverId: 's1', receivedDate: { time: 1700000000000 }, processed: true,
    connectorMessages: { entry: [
        { int: 0, connectorMessage: {
            metaDataId: 0, connectorName: 'Source', status: 'RECEIVED', receivedDate: { time: 1700000000000 },
            raw: { content: 'MSH|^~\\&|SENDER|FAC|RECV|FAC|20231101||ADT^A01|MSG00001|P|2.3' }
        } },
        { int: 1, connectorMessage: {
            metaDataId: 1, connectorName: 'HTTP Sender', status: 'SENT', receivedDate: { time: 1700000001000 },
            sendDate: { time: 1700000002000 }, sendAttempts: 1, encoded: { content: '<x/>', dataType: 'XML' }
        } }
    ] }
};

const FIXTURES = {
    [`GET /channels/${CID}/messages`]: (req: any) => {
        const offset = Number(new URL(req.url()).searchParams.get('offset') || 0);
        return { list: { message: offset > 0 ? [] : [MESSAGE] } };
    },
    [`GET /channels/${CID}/messages/count`]: { long: 1 },
    [`GET /channels/${CID}/connectorNames`]: { map: { entry: [{ int: 0, string: 'Source' }, { int: 1, string: 'HTTP Sender' }] } },
    [`GET /channels/${CID}/metaDataColumns`]: '',
    'GET /channels/idsAndNames': { map: { entry: [{ string: [CID, 'Demo Started'] }] } },
    [`GET /channels/${CID}/messages/12345`]: MESSAGE,
    [`GET /channels/${CID}/messages/12345/attachments`]: ''
};

// Append a test plugin to the bundled manifest (the bundled plugins still load)
// and serve its entry module from `source`. Same mechanism as rbac.spec.ts.
async function installPlugin(page: any, source: string) {
    await page.route('**/webadmin/plugins.json', async (route: any) => {
        const resp = await route.fetch();
        let manifests: any[] = [];
        try { manifests = await resp.json(); } catch { /* empty */ }
        manifests.push({ id: 'test-msg-action', version: '1.0.0', entry: '/plugins/test-msg-action/entry.js' });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(manifests) });
    });
    // Optional query suffix: Vite's dev middleware appends `?import` to dynamic imports.
    await page.route('**/plugins/test-msg-action/entry.js*', (route: any) => route.fulfill({
        status: 200, contentType: 'application/javascript', body: source
    }));
}

const invoked = (page: any) => page.evaluate(() => (window as any).__msgAction);

test('a plugin message action reaches the Message Tasks pane and the row menu with the row in context', async ({ page }) => {
    await installPlugin(page, `
        export function register(p) {
            p.registerMessageAction({
                id: 'demo-msg', label: 'Demo Message Action', icon: 'puzzle',
                onInvoke: (message, ctx) => {
                    window.__msgAction = {
                        messageId: message.messageId, channelId: ctx.channelId, metaDataId: ctx.metaDataId,
                        connector: ctx.connectorMessage ? ctx.connectorMessage.connectorName : null
                    };
                }
            });
        }`);
    await mockEngine(page, FIXTURES);
    await page.goto(`/messages/${CID}`);
    await expect(page.getByText('12345', { exact: true })).toBeVisible();

    // Task pane: selection-gated, like Remove/Reprocess Message.
    const button = page.getByRole('button', { name: 'Demo Message Action', exact: true });
    await expect(button).toHaveCount(0);
    await page.getByText('12345', { exact: true }).click();
    await expect(button).toBeVisible();
    await button.click();
    await expect.poll(() => invoked(page)).toEqual({ messageId: '12345', channelId: CID, metaDataId: 0, connector: 'Source' });

    // Row menu: right-clicking the destination row hands that connector over.
    await page.getByText('HTTP Sender', { exact: true }).click({ button: 'right' });
    await page.getByRole('menu').getByRole('menuitem', { name: 'Demo Message Action' }).click();
    await expect.poll(() => invoked(page)).toEqual({ messageId: '12345', channelId: CID, metaDataId: 1, connector: 'HTTP Sender' });
});

test('isEnabled gates a plugin message action per row', async ({ page }) => {
    await installPlugin(page, `
        export function register(p) {
            p.registerMessageAction({ id: 'dest-only', label: 'Destination Only', icon: 'puzzle',
                isEnabled: (ctx) => ctx.metaDataId !== 0, onInvoke: () => {} });
        }`);
    await mockEngine(page, FIXTURES);
    await page.goto(`/messages/${CID}`);
    await expect(page.getByText('12345', { exact: true })).toBeVisible();

    // Source row: the built-in items are there, the gated plugin item is not.
    await page.getByText('12345', { exact: true }).click({ button: 'right' });
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'Reprocess Message' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Destination Only' })).toHaveCount(0);
    // Selecting the source row also keeps it out of the task pane.
    await expect(page.getByRole('button', { name: 'Reprocess Message', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Destination Only', exact: true })).toHaveCount(0);

    // Destination row: offered. Dismiss the open menu first — its overlay would
    // otherwise intercept the right-click.
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await page.getByText('HTTP Sender', { exact: true }).click({ button: 'right' });
    await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Destination Only' })).toBeVisible();
});

test('an RBAC controller hides a plugin message action by its task', async ({ page }) => {
    await installPlugin(page, `
        export function register(p) {
            p.setAuthorizationController({ checkTask: (g, t) => !(g === 'message' && t === 'doDemoAction') });
            p.registerMessageAction({ id: 'gated', label: 'Gated Action', icon: 'puzzle', task: 'doDemoAction', onInvoke: () => {} });
        }`);
    await mockEngine(page, FIXTURES);
    await page.goto(`/messages/${CID}`);
    await expect(page.getByText('12345', { exact: true })).toBeVisible();

    await page.getByText('12345', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Reprocess Message', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Gated Action', exact: true })).toHaveCount(0);

    await page.getByText('12345', { exact: true }).click({ button: 'right' });
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'Reprocess Message' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Gated Action' })).toHaveCount(0);
});
