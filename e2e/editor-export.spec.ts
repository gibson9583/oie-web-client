import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';
import { DEFAULT_FIXTURES } from './fixtures.js';

const surfaces = [
    { name: 'alert list', path: '/alerts', select: 'Error Alert', task: 'Export Alert' },
    { name: 'all alerts', path: '/alerts', task: 'Export All Alerts' },
    { name: 'classic alert', path: '/alerts/al-1/edit', task: 'Export Alert' },
    { name: 'guided alert', path: '/alerts/al-1/guided', task: 'Export Alert' },
    { name: 'code template', path: '/code-templates', select: 'Trim Whitespace', task: 'Export Code Template' },
    { name: 'library', path: '/code-templates', select: 'Demo Library', task: 'Export Library' },
    { name: 'all libraries', path: '/code-templates', select: 'Demo Library', task: 'Export All Libraries', menu: true },
    { name: 'channel list', path: '/channels', select: 'Demo Started', task: 'Export Channel' },
    { name: 'all channels', path: '/channels', select: 'Demo Started', task: 'Export All Channels', menu: true },
    { name: 'group', path: '/channels', select: '[Demo Group]', task: 'Export Group' },
    { name: 'all groups', path: '/channels', select: '[Demo Group]', task: 'Export All Groups' },
    { name: 'classic channel JSON', path: '/channels/c-started/edit', task: 'Export Channel', json: 'channel' },
    { name: 'connector JSON', path: '/channels/c-started/edit', task: 'Export Connector', json: 'connector', destination: true },
    { name: 'transformer JSON', path: '/channels/c-started/transformer/0', task: 'Export Transformer', json: 'elements' },
];

for (const surface of surfaces) for (const outcome of ['success', 'failure', 'expiry']) {
    test(`${surface.name} export ${outcome === 'expiry' ? 'stops quietly after logout during the picker' : `preserves ${outcome} handling`}`, async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(outcome => {
            const probe: any = (window as any).editorExportProbe = { pickers: 0, writes: 0, closes: 0 };
            (window as any).showSaveFilePicker = async () => {
                probe.pickers++;
                await new Promise<void>(resolve => { probe.release = resolve; });
                return { createWritable: async () => {
                    if (outcome === 'failure') throw new Error('synthetic file failure');
                    return {
                        write: async (blob: Blob) => { probe.writes++; probe.bytes = blob.size; probe.text = await blob.text(); },
                        close: async () => { probe.closes++; },
                        abort: async () => {},
                    };
                } };
            };
        }, outcome);
        const channel = makeChannel('c-started');
        channel.name = 'Demo Started';
        const alert = { '@version': '4.6.0', id: 'al-1', name: 'Error Alert', enabled: true,
            trigger: { '@class': 'defaultTrigger', regex: '', errorEventTypes: { errorEventType: ['ANY'] }, alertChannels: { newChannelSource: false, newChannelDestination: false } },
            actionGroups: { alertActionGroup: [{ actions: null, subject: '', template: '' }] }, properties: null };
        const group = { id: 'g-1', name: 'Demo Group', revision: 1, channels: { channel: [{ id: 'c-started' }] } };
        let xmlReads = 0;
        const xml = (request: any, value: string, otherwise: any) => {
            if (!request.headers().accept?.includes('application/xml')) return otherwise;
            xmlReads++;
            return value;
        };
        await mockEngine(page, {
            'GET /session-expiry-probe': { __status: 401 },
            'GET /alerts/al-1': (request: any) => xml(request, '<alertModel><id>al-1</id><name>Error Alert</name></alertModel>', { alertModel: alert }),
            'GET /alerts/al-2': (request: any) => xml(request, '<alertModel><id>al-2</id></alertModel>', { alertModel: { ...alert, id: 'al-2' } }),
            'GET /channels/c-started': (request: any) => xml(request, '<channel><id>c-started</id><name>Demo Started</name></channel>', { channel }),
            'GET /channels': (request: any) => xml(request, '<list><channel><id>c-started</id><name>Demo Started</name></channel><channel><id>c-stopped</id><name>Demo Stopped</name></channel></list>', DEFAULT_FIXTURES['GET /channels']),
            'GET /channelgroups': (request: any) => xml(request, '<list><channelGroup><id>g-1</id><name>Demo Group</name><channels><channel><id>c-started</id></channel></channels></channelGroup></list>', { list: { channelGroup: [group] } }),
            'GET /codeTemplateLibraries': (request: any) => xml(request, '<list><codeTemplateLibrary><id>lib-1</id></codeTemplateLibrary></list>', DEFAULT_FIXTURES['GET /codeTemplateLibraries']),
            'GET /codeTemplateLibraries/lib-1': (request: any) => xml(request, '<codeTemplateLibrary><id>lib-1</id></codeTemplateLibrary>', {}),
            'GET /codeTemplates/tpl-1': (request: any) => xml(request, '<codeTemplate><id>tpl-1</id></codeTemplate>', {}),
        });
        await page.goto(surface.path);
        if (surface.select) await page.getByText(surface.select, { exact: true }).first().click({ button: surface.menu ? 'right' : 'left' });
        if (surface.destination) {
            await page.getByRole('tab', { name: 'Destinations', exact: true }).click();
            await page.getByRole('cell', { name: 'Channel Writer', exact: true }).click();
        }
        if (surface.menu) await page.getByRole('menu').getByText(surface.task, { exact: true }).click();
        else await page.getByRole('button', { name: surface.task, exact: true }).click();
        await expect.poll(() => page.evaluate(() => (window as any).editorExportProbe.pickers)).toBe(1);
        const readsBefore = xmlReads;
        if (outcome === 'expiry') {
            await page.evaluate(async () => {
                const api = await import(String('/core/api.js'));
                await api.get('/session-expiry-probe').catch(() => {});
            });
            await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
        }
        await page.evaluate(() => (window as any).editorExportProbe.release());
        if (outcome === 'success') {
            await expect.poll(() => page.evaluate(() => (window as any).editorExportProbe.closes)).toBe(1);
            const saved = await page.evaluate(() => (window as any).editorExportProbe);
            expect(saved.writes).toBe(1);
            expect(saved.bytes).toBeGreaterThan(0);
            if (surface.json) expect(JSON.parse(saved.text)).toHaveProperty(surface.json);
        } else if (outcome === 'failure') {
            await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toContainText('synthetic file failure');
        } else {
            await page.waitForTimeout(150);
            expect(xmlReads).toBe(readsBefore);
            expect(await page.evaluate(() => (window as any).editorExportProbe.writes)).toBe(0);
            await expect(page.getByRole('dialog')).toHaveCount(0);
            await expect(page.locator('.toast-msg')).toHaveCount(0);
        }
        expect(errors).toEqual([]);
    });
}

for (const expired of [false, true]) {
    test(`channel export library lookup ${expired ? 'cannot start a picker after logout' : 'still permits export when unavailable'}`, async ({ page }) => {
        await page.addInitScript(() => {
            const probe: any = (window as any).libraryExportProbe = { pickers: 0, writes: 0 };
            (window as any).showSaveFilePicker = async () => {
                probe.pickers++;
                return { createWritable: async () => ({
                    write: async () => { probe.writes++; }, close: async () => {}, abort: async () => {},
                }) };
            };
        });
        let held = false, released = false, reads = 0;
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        await mockEngine(page, {
            'GET /session-expiry-probe': { __status: 401 },
            'GET /codeTemplateLibraries': async () => {
                held = true; await gate; released = true;
                return { __status: 503, body: 'linked libraries unavailable' };
            },
            'GET /channels/c-started': () => { reads++; return '<channel><id>c-started</id></channel>'; },
        });
        try {
            await page.goto('/channels');
            await page.getByText('Demo Started', { exact: true }).click();
            await page.getByRole('button', { name: 'Export Channel', exact: true }).click();
            await expect.poll(() => held).toBe(true);
            if (expired) {
                await page.evaluate(async () => {
                    const api = await import(String('/core/api.js'));
                    await api.get('/session-expiry-probe').catch(() => {});
                });
                await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
            }
            release();
            await expect.poll(() => released).toBe(true);
            if (expired) {
                await page.waitForTimeout(150);
                expect(await page.evaluate(() => (window as any).libraryExportProbe.pickers)).toBe(0);
                expect(reads).toBe(0);
                await expect(page.getByRole('dialog')).toHaveCount(0);
            } else {
                await expect.poll(() => page.evaluate(() => (window as any).libraryExportProbe.writes)).toBe(1);
                expect(reads).toBe(1);
                await expect(page.getByText(/Could not check linked code template libraries:.*linked libraries unavailable.*Exporting without them/)).toBeVisible();
            }
        } finally { release(); }
    });
}
