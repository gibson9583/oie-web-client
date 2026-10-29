import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';

const PAIR = 'org.apache.commons.lang3.tuple.ImmutablePair';
const pair = (left: string, right: string) => ({ left: { '@class': 'string', $: left }, right: { '@class': 'string', $: right } });
const surfaces = [
    { label: 'source', route: 'transformer/0', connector: 0, target: 'transformer' },
    { label: 'destination', route: 'transformer/1', connector: 1, target: 'transformer' },
    { label: 'response', route: 'response/1', connector: 1, target: 'responseTransformer' }
];

for (const type of ['mapper.MapperStep', 'messagebuilder.MessageBuilderStep']) {
    test(`${type} singleton replacements survive a failed save and preview after retry`, async ({ page }) => {
        const id = 'replacement-retry';
        const className = `com.mirth.connect.plugins.${type}`;
        let channel = makeChannel(id);
        const singleton = { [PAIR]: pair('"^s3://"', '"/SharedData/"') };
        channel.sourceConnector.transformer.elements = { [className]: {
            '@version': '4.6.0', name: 'Singleton', sequenceNumber: 0, enabled: true,
            ...(type.startsWith('mapper') ? { variable: 'folder', scope: 'CHANNEL' } : { messageSegment: "tmp['folder']" }),
            mapping: "'s3://sample'", defaultValue: '', replacements: singleton
        } };
        const attempts: any[] = [];
        await page.route('**/vendor/monaco/editor.main.js', route => route.abort());
        await mockEngine(page, {
            [`GET /channels/${id}`]: () => ({ channel }),
            [`PUT /channels/${id}`]: (request: any) => {
                attempts.push(request.postDataJSON().channel);
                if (attempts.length === 1) return { __status: 500, body: { message: 'Save failed' } };
                channel = request.postDataJSON().channel;
                return true;
            }
        });
        await page.goto(`/channels/${id}/transformer/0`);
        const group = page.getByRole('group', { name: 'String Replacement', exact: true });
        await expect(group.getByRole('textbox', { name: 'Regular Expression 1', exact: true })).toHaveValue('"^s3://"');
        await expect(group.getByRole('textbox', { name: 'Regular Expression 2', exact: true })).toHaveCount(0);
        await page.locator('input.grid-name').first().fill('Retry singleton');
        const save = page.getByRole('button', { name: 'Save Channel', exact: true });
        await save.click();
        await expect.poll(() => attempts.length).toBe(1);
        const error = page.getByRole('dialog', { name: 'Error', exact: true });
        await expect(error).toContainText('Save failed');
        await error.getByRole('button', { name: 'Close', exact: true }).last().click();
        await expect(save).toBeEnabled();
        await save.click();
        await expect.poll(() => attempts.length).toBe(2);
        await expect(page.locator('.content-row')).not.toHaveAttribute('inert');
        for (const sent of attempts) expect(sent.sourceConnector.transformer.elements[className][0].replacements).toEqual(singleton);
        await group.getByRole('textbox', { name: 'Replace With 1', exact: true }).fill('"/changed/"');
        await page.getByRole('tab', { name: 'Generated Script', exact: true }).click();
        const preview = page.getByRole('tabpanel', { name: 'Generated Script', exact: true }).locator('textarea.ce-area');
        await expect(preview).toHaveValue(/new Array\(new Array\("\^s3:\/\/", "\/changed\/"\)\)/);
        await page.getByRole('tab', { name: 'Step', exact: true }).click();
        await save.click();
        await expect.poll(() => attempts.length).toBe(3);
        expect(attempts[2].sourceConnector.transformer.elements[className][0].replacements).toEqual({ [PAIR]: [pair('"^s3://"', '"/changed/"')] });
    });

    for (const surface of surfaces) {
        test(`${type} replacements in ${surface.label} survive editing, save and reload`, async ({ page }, testInfo) => {
            const id = 'replacement-edit';
            const className = `com.mirth.connect.plugins.${type}`;
            let channel = makeChannel(id);
            const connector = (c: any) => surface.connector === 0 ? c.sourceConnector : [c.destinationConnectors.connector].flat()[0];
            const element = {
                '@version': '4.6.0', name: 'Folder mapping', sequenceNumber: 0, enabled: true,
                ...(type.startsWith('mapper') ? { variable: 'folder', scope: 'CHANNEL' } : { messageSegment: "tmp['folder']" }),
                mapping: "'s3://bucket/sample'", defaultValue: '',
                replacements: { [PAIR]: [pair('"^s3://bucket/"', '"/SharedData/"'), pair('"sample$"', '"result"')] }
            };
            connector(channel)[surface.target].elements = { [className]: element };
            const written: any[] = [];
            await mockEngine(page, {
                [`GET /channels/${id}`]: () => ({ channel }),
                [`PUT /channels/${id}`]: (request: any) => {
                    channel = request.postDataJSON().channel;
                    written.push(structuredClone(channel));
                    return true;
                }
            });
            const open = async () => {
                await page.goto(`/channels/${id}/${surface.route}`);
                await expect(page.getByRole('group', { name: 'String Replacement', exact: true })).toBeVisible();
            };
            await open();
            const group = page.getByRole('group', { name: 'String Replacement', exact: true });
            const regex = (index: number) => group.getByRole('textbox', { name: `Regular Expression ${index}`, exact: true });
            const replacement = (index: number) => group.getByRole('textbox', { name: `Replace With ${index}`, exact: true });
            await expect(regex(1)).toHaveValue('"^s3://bucket/"');
            await expect(replacement(2)).toHaveValue('"result"');
            await expect(group.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled();

            // Selecting an editor and saving a name edit must leave native pairs untouched.
            await page.locator('input.grid-name').first().fill('Renamed folder mapping');
            await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
            await expect.poll(() => written.length).toBe(1);
            // Receiving the PUT is not save completion: readback still holds
            // the editor inert. WebKit fill can otherwise bypass that user lock.
            await expect(page.locator('.content-row')).not.toHaveAttribute('inert');
            expect(connector(written[0])[surface.target].elements[className][0].replacements).toEqual(element.replacements);

            await replacement(1).fill('"/changed/"');
            await regex(2).focus();
            await group.getByRole('button', { name: 'Delete', exact: true }).click();
            await expect(regex(2)).toHaveCount(0);
            await group.getByRole('button', { name: 'New', exact: true }).click();
            await expect(regex(2)).toHaveValue('');
            await expect(replacement(2)).toHaveValue('');
            await regex(2).fill('"/changed/"');
            await replacement(2).fill('"/final/"');
            await group.getByRole('button', { name: 'New', exact: true }).click(); // Unfinished regex is omitted like Swing.
            await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
            await expect.poll(() => written.length).toBe(2);
            await expect(page.locator('.content-row')).not.toHaveAttribute('inert');
            expect(connector(written[1])[surface.target].elements[className][0].replacements).toEqual({ [PAIR]: [
                pair('"^s3://bucket/"', '"/changed/"'), pair('"/changed/"', '"/final/"')
            ] });
            await open();
            await expect(regex(2)).toHaveValue('"/changed/"');
            await expect(replacement(2)).toHaveValue('"/final/"');
            await expect(regex(3)).toHaveCount(0);
            if (surface.label === 'source') {
                await page.screenshot({ path: testInfo.outputPath('replacements-desktop.png') });
                await page.getByRole('button', { name: 'Toggle light/dark mode', exact: true }).click();
                await regex(1).scrollIntoViewIfNeeded();
                await page.screenshot({ path: testInfo.outputPath('replacements-dark.png') });
                await page.getByRole('button', { name: 'Hide navigation', exact: true }).click();
                await page.setViewportSize({ width: 600, height: 900 });
                await regex(1).scrollIntoViewIfNeeded();
                await expect(regex(1)).toBeInViewport();
                await page.screenshot({ path: testInfo.outputPath('replacements-narrow.png') });
                await page.setViewportSize({ width: 1280, height: 720 });
            }
            // Deleting the final pair writes an empty collection, never null.
            for (let count = 2; count > 0; count--) {
                await regex(1).focus();
                await group.getByRole('button', { name: 'Delete', exact: true }).click();
            }
            await expect(group.getByText('No replacements — use New')).toBeVisible();
            await expect(group.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled();
            await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
            await expect.poll(() => written.length).toBe(3);
            expect(connector(written[2])[surface.target].elements[className][0].replacements).toBe('');
        });
    }
}
