import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

for (const kind of ['image', 'pdf', 'text']) {
    test(`${kind} viewer fences changed selections, retries, and late completions after unmount`, async ({ page }) => {
        await mockEngine(page);
        await page.goto('/');
        await expect(page.locator('.shell')).toBeVisible();
        // Use the public plugin contract to exercise prop changes on the SAME
        // viewer instance, independently of message-detail remount shortcuts.
        await expect.poll(() => page.evaluate(async kind => {
            const modulePath = '@oie/web-shell';
            const { platform } = await import(modulePath);
            return platform.attachmentViewers().some((value: any) => value.id === kind + 'viewer');
        }, kind)).toBe(true);
        await page.evaluate(async kind => {
            const modulePath = '@oie/web-shell';
            const { platform } = await import(modulePath);
            const React = platform.React;
            const probe: any = (window as any).viewerProbe = { requests: [] };
            const viewer = platform.attachmentViewers().find((value: any) => value.id === kind + 'viewer');
            if (!viewer) throw new Error('Viewer was not registered');
            const instance = { ...platform, api: { ...platform.api, messages: { ...platform.api.messages,
                attachment: (channel: string, message: string, id: string) => new Promise((resolve, reject) => {
                    probe.requests.push({ channel, message, id, resolve, reject });
                }),
            } } };
            function Harness() {
                const [message, select] = React.useState(1);
                return React.createElement('div', { id: 'viewer-probe' },
                    React.createElement('button', { onClick: () => select((value: number) => value + 1) }, 'Next attachment'),
                    React.createElement(viewer.component, { channelId: 'isolated', messageId: message,
                        attachment: { id: 'same-id', type: kind === 'image' ? 'image/png' : kind === 'pdf' ? 'application/pdf' : 'text/plain' }, platform: instance }));
            }
            platform.registerSettingsPanel({ id: 'viewer-probe', label: 'Viewer Probe', component: Harness });
        }, kind);
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        await page.getByRole('tab', { name: 'Viewer Probe', exact: true }).click();
        const host = page.locator('#viewer-probe');
        const requests = () => page.evaluate(() => (window as any).viewerProbe.requests.length);
        const complete = (index: number, value: string, fail = false) => page.evaluate(({ index, value, fail }) => {
            const request = (window as any).viewerProbe.requests[index];
            if (fail) request.reject(new Error(value));
            else request.resolve({ content: btoa(value) });
        }, { index, value, fail });
        const content = kind === 'text' ? host.locator('pre') : host.locator(kind === 'image' ? 'img' : 'iframe');
        const assertContent = async (value: string) => {
            if (kind === 'text') await expect(content).toHaveText(value);
            else await expect(content).toHaveAttribute('src', new RegExp(Buffer.from(value).toString('base64') + '$'));
        };
        await expect.poll(requests).toBe(1);
        await complete(0, 'initial');
        await assertContent('initial');
        await host.getByRole('button', { name: 'Next attachment' }).click();
        await expect.poll(requests).toBe(2);
        await expect(content).toHaveCount(0);
        await host.getByRole('button', { name: 'Next attachment' }).click();
        await expect.poll(requests).toBe(3);
        await complete(2, 'latest');
        await assertContent('latest');
        await complete(1, 'obsolete');
        await assertContent('latest');
        await host.getByRole('button', { name: 'Next attachment' }).click();
        await expect.poll(requests).toBe(4);
        await complete(3, 'temporary failure', true);
        await expect(host.getByText(/temporary failure/)).toBeVisible();
        await host.getByRole('button', { name: 'Retry', exact: true }).click();
        await expect.poll(requests).toBe(5);
        await complete(4, 'recovered');
        await assertContent('recovered');
        await host.getByRole('button', { name: 'Next attachment' }).click();
        await expect.poll(requests).toBe(6);
        await page.getByRole('button', { name: 'Logout', exact: true }).click();
        await expect(host).toHaveCount(0);
        await complete(5, 'late session content');
        await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
        await expect(page.getByText('late session content')).toHaveCount(0);
    });
}
