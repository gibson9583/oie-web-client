import { test, expect } from './base.js';
import type { Page } from '@playwright/test';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';

const CHANNEL_ID = 'url-params';

function makeRichChannel() {
    const channel = makeChannel(CHANNEL_ID);
    const firstDest = channel.destinationConnectors.connector[0];
    channel.destinationConnectors.connector = [
        { ...structuredClone(firstDest), metaDataId: 1, name: 'Dest One' },
        { ...structuredClone(firstDest), metaDataId: 3, name: 'Dest Three' },
        { ...structuredClone(firstDest), metaDataId: 5, name: 'Dest Five' },
    ];
    channel.nextMetaDataId = 6;
    channel.deployScript = '// deploy script\nreturn;';
    channel.undeployScript = '// undeploy script\nreturn;';
    channel.preprocessingScript = '// preprocessor script\nreturn message;';
    channel.postprocessingScript = '// postprocessor script\nreturn;';

    channel.sourceConnector.transformer = {
        '@version': '4.6.0',
        elements: {
            'com.mirth.connect.plugins.mapper.MapperStep': [
                {
                    '@version': '4.6.0',
                    name: 'Step Zero',
                    sequenceNumber: '0',
                    enabled: true,
                    variable: 'v0',
                    mapping: 'msg',
                    defaultValue: '',
                    replacements: '',
                    scope: 'CHANNEL',
                },
                {
                    '@version': '4.6.0',
                    name: 'Step Two',
                    sequenceNumber: '2',
                    enabled: true,
                    variable: 'v2',
                    mapping: 'msg',
                    defaultValue: '',
                    replacements: '',
                    scope: 'CHANNEL',
                },
            ],
            'com.mirth.connect.model.IteratorStep': {
                '@version': '4.6.0',
                name: 'Iter One',
                sequenceNumber: '1',
                enabled: true,
                properties: {
                    '@version': '4.6.0',
                    target: "msg['OBX']",
                    indexVariable: 'i',
                    prefixSubstitutions: '',
                    children: {
                        'com.mirth.connect.plugins.mapper.MapperStep': [
                            {
                                '@version': '4.6.0',
                                name: 'Child Zero',
                                sequenceNumber: '0',
                                enabled: true,
                                variable: 'c0',
                                mapping: 'msg',
                                defaultValue: '',
                                replacements: '',
                                scope: 'CHANNEL',
                            },
                            {
                                '@version': '4.6.0',
                                name: 'Child One',
                                sequenceNumber: '1',
                                enabled: true,
                                variable: 'c1',
                                mapping: 'msg',
                                defaultValue: '',
                                replacements: '',
                                scope: 'CHANNEL',
                            },
                        ],
                    },
                },
            },
        },
        inboundDataType: 'HL7V2',
        outboundDataType: 'HL7V2',
        inboundProperties: null,
        outboundProperties: null,
    };

    channel.destinationConnectors.connector[0].filter = {
        '@version': '4.6.0',
        elements: {
            'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule': [
                { '@version': '4.6.0', name: 'Rule Zero', sequenceNumber: '0', enabled: true, operator: 'NONE', field: 'msg', condition: 'EXISTS', values: '' },
                { '@version': '4.6.0', name: 'Rule One', sequenceNumber: '1', enabled: true, operator: 'AND', field: 'msg', condition: 'EXISTS', values: '' },
            ],
        },
    };
    channel.destinationConnectors.connector[0].responseTransformer = {
        '@version': '4.6.0',
        elements: {
            'com.mirth.connect.plugins.mapper.MapperStep': [
                { '@version': '4.6.0', name: 'Resp Zero', sequenceNumber: '0', enabled: true, variable: 'r0', mapping: 'msg', defaultValue: '', replacements: '', scope: 'CHANNEL' },
                { '@version': '4.6.0', name: 'Resp One', sequenceNumber: '1', enabled: true, variable: 'r1', mapping: 'msg', defaultValue: '', replacements: '', scope: 'CHANNEL' },
            ],
        },
        inboundDataType: 'HL7V2',
        outboundDataType: 'HL7V2',
        inboundProperties: null,
        outboundProperties: null,
    };

    return channel;
}

async function scriptEditorValue(page: Page): Promise<string> {
    const textarea = page.locator('[role="tabpanel"] textarea.ce-fallback');
    if (await textarea.count()) return await textarea.inputValue();
    return await page.evaluate(() => {
        const me = (window as any).monaco?.editor;
        const eds = me?.getEditors?.() || [];
        return eds[0]?.getValue?.() ?? '';
    });
}

test.describe('Editor URL parameters (WA-02)', () => {
    test('channel editor opens the requested tab and falls back cleanly on unknown tabs', async ({ page }) => {
        await mockEngine(page, { [`GET /channels/${CHANNEL_ID}`]: { channel: makeRichChannel() } });

        await page.goto(`/channels/${CHANNEL_ID}/edit?tab=source`);
        await expect(page.getByRole('tab', { name: 'Source', exact: true })).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByRole('button', { name: 'Validate Connector', exact: true })).toBeVisible();

        await page.goto(`/channels/${CHANNEL_ID}/edit?tab=destinations`);
        await expect(page.getByRole('tab', { name: 'Destinations', exact: true })).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByRole('button', { name: 'New Destination', exact: true })).toBeVisible();

        await page.goto(`/channels/${CHANNEL_ID}/edit?tab=scripts`);
        await expect(page.getByRole('tab', { name: 'Scripts', exact: true })).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('[role="tabpanel"] select')).toHaveValue('deployScript');

        await page.goto(`/channels/${CHANNEL_ID}/edit?tab=unknown`);
        await expect(page.getByRole('tab', { name: 'Summary', exact: true })).toHaveAttribute('aria-selected', 'true');
    });

    test('channel editor selects destination by ?metaDataId= and resets on manual tab switch', async ({ page }) => {
        await mockEngine(page, { [`GET /channels/${CHANNEL_ID}`]: { channel: makeRichChannel() } });

        await page.goto(`/channels/${CHANNEL_ID}/edit?tab=destinations&metaDataId=3`);
        await expect(page.getByRole('tab', { name: 'Destinations', exact: true })).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('.dest-grid tbody tr.selected td.num')).toHaveText('3');
        await expect(page.locator('.dest-grid tbody tr.selected input.grid-name')).toHaveValue('Dest Three');

        // Switching tabs manually restores classic Swing reset-to-first-destination parity.
        await page.getByRole('tab', { name: 'Summary', exact: true }).click();
        await page.getByRole('tab', { name: 'Destinations', exact: true }).click();
        await expect(page.locator('.dest-grid tbody tr.selected td.num')).toHaveText('1');

        // Out-of-bounds metaDataId falls back to the first destination.
        await page.goto(`/channels/${CHANNEL_ID}/edit?tab=destinations&metaDataId=999`);
        await expect(page.locator('.dest-grid tbody tr.selected td.num')).toHaveText('1');
    });

    test('channel editor selects script by ?script= and resets on manual tab switch', async ({ page }) => {
        await mockEngine(page, { [`GET /channels/${CHANNEL_ID}`]: { channel: makeRichChannel() } });

        await page.goto(`/channels/${CHANNEL_ID}/edit?tab=scripts&script=preprocessor`);
        await expect(page.getByRole('tab', { name: 'Scripts', exact: true })).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('[role="tabpanel"] select')).toHaveValue('preprocessingScript');
        await expect.poll(() => scriptEditorValue(page)).toContain('// preprocessor script');

        await page.goto(`/channels/${CHANNEL_ID}/edit?tab=scripts&script=postprocessingScript`);
        await expect(page.locator('[role="tabpanel"] select')).toHaveValue('postprocessingScript');
        await expect.poll(() => scriptEditorValue(page)).toContain('// postprocessor script');

        // Manual tab round-trip resets script selection to Deploy.
        await page.getByRole('tab', { name: 'Summary', exact: true }).click();
        await page.getByRole('tab', { name: 'Scripts', exact: true }).click();
        await expect(page.locator('[role="tabpanel"] select')).toHaveValue('deployScript');

        // Unknown script falls back to Deploy.
        await page.goto(`/channels/${CHANNEL_ID}/edit?tab=scripts&script=bogus`);
        await expect(page.locator('[role="tabpanel"] select')).toHaveValue('deployScript');
    });

    test('in-flow router navigation updates target tab/script while keeping unsaved channel edits', async ({ page }) => {
        await mockEngine(page, { [`GET /channels/${CHANNEL_ID}`]: { channel: makeRichChannel() } });

        await page.goto(`/channels/${CHANNEL_ID}/edit`);
        const nameField = page.locator('.panel input[type=text]').first();
        await nameField.fill('Edited Channel Name');
        await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeVisible();

        await page.evaluate(async (id) => {
            const mod = await import(String('/core/pkg-shell.js'));
            mod.platform.router.navigate(`/channels/${id}/edit?tab=scripts&script=undeploy`);
        }, CHANNEL_ID);

        await expect(page.getByRole('tab', { name: 'Scripts', exact: true })).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('[role="tabpanel"] select')).toHaveValue('undeployScript');
        await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeVisible();
        await page.getByRole('tab', { name: 'Summary', exact: true }).click();
        await expect(page.locator('.panel input[type=text]').first()).toHaveValue('Edited Channel Name');
    });

    test('filter, transformer, and response routes select the requested ?step= and fall back safely', async ({ page }) => {
        await mockEngine(page, { [`GET /channels/${CHANNEL_ID}`]: { channel: makeRichChannel() } });

        await page.goto(`/channels/${CHANNEL_ID}/transformer/0?step=2`);
        await expect(page.locator('tr[data-path="2"]')).toHaveClass(/selected/);
        await expect(page.locator('tr[data-path="2"] input.grid-name')).toHaveValue('Step Two');

        await page.goto(`/channels/${CHANNEL_ID}/transformer/0?step=1.1`);
        await expect(page.locator('tr[data-path="1.1"]')).toHaveClass(/selected/);
        await expect(page.locator('tr[data-path="1.1"] input.grid-name')).toHaveValue('Child One');

        await page.goto(`/channels/${CHANNEL_ID}/filter/1?step=1`);
        await expect(page.locator('tr[data-path="1"]')).toHaveClass(/selected/);
        await expect(page.locator('tr[data-path="1"] input.grid-name')).toHaveValue('Rule One');

        await page.goto(`/channels/${CHANNEL_ID}/response/1?step=1`);
        await expect(page.locator('tr[data-path="1"]')).toHaveClass(/selected/);
        await expect(page.locator('tr[data-path="1"] input.grid-name')).toHaveValue('Resp One');

        await page.goto(`/channels/${CHANNEL_ID}/transformer/0?step=99`);
        await expect(page.locator('tr[data-path="0"]')).toHaveClass(/selected/);

        await page.goto(`/channels/${CHANNEL_ID}/transformer/0?step=invalid`);
        await expect(page.locator('tr[data-path="0"]')).toHaveClass(/selected/);
    });
});
