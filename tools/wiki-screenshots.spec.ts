import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { mockEngine } from '../e2e/mock.js';
import { makeChannel } from '../e2e/connector-fixtures.js';

const IMAGE_DIR = resolve(process.cwd(), 'wiki/images');
const CHANNEL_ID = 'wiki-channel';

const channel = makeChannel(CHANNEL_ID);
channel.name = 'ADT Intake to FHIR API';
channel.description = 'Receives ADT messages and sends normalized resources downstream.';
channel.destinationConnectors.connector[0].name = 'FHIR API';

const message = {
    messageId: '10427',
    channelId: 'c-started',
    serverId: 'wiki-server',
    receivedDate: { time: 1700000000000 },
    processed: true,
    connectorMessages: {
        entry: [
            {
                int: 0,
                connectorMessage: {
                    metaDataId: 0,
                    connectorName: 'Source',
                    status: 'RECEIVED',
                    receivedDate: { time: 1700000000000 },
                    raw: { content: 'MSH|^~\\&|ADT|HOSPITAL|OIE|INTEGRATION|202311142213||ADT^A01|10427|P|2.5\rPID|1||MRN-10027^^^HOSPITAL^MR||DOE^JANE' },
                    sourceMapContent: { content: { map: { entry: [
                        { string: ['patientId', 'MRN-10027'] },
                        { string: ['messageType', 'ADT^A01'] },
                    ] } } },
                },
            },
            {
                int: 1,
                connectorMessage: {
                    metaDataId: 1,
                    connectorName: 'FHIR API',
                    status: 'SENT',
                    receivedDate: { time: 1700000001000 },
                    sendDate: { time: 1700000002000 },
                    sendAttempts: 1,
                    encoded: { content: '{"resourceType":"Patient","id":"MRN-10027"}', dataType: 'JSON' },
                },
            },
        ],
    },
};

const fixtures = {
    'GET /server/version': '4.6.0',
    [`GET /channels/${CHANNEL_ID}`]: { channel },
    [`GET /channels/c-started/messages`]: { list: { message: [message] } },
    [`GET /channels/c-started/messages/count`]: { long: 1 },
    [`GET /channels/c-started/connectorNames`]: { map: { entry: [
        { int: 0, string: 'Source' },
        { int: 1, string: 'FHIR API' },
    ] } },
    [`GET /channels/c-started/metaDataColumns`]: '',
    [`GET /channels/c-started/messages/10427`]: message,
    [`GET /channels/c-started/messages/10427/attachments`]: '',
    [`GET /channels/c-started/status`]: { dashboardStatus: {
        channelId: 'c-started', name: 'Demo Started', state: 'STARTED', statistics: {},
    } },
    'GET /channels/idsAndNames': { map: { entry: [
        { string: ['c-started', 'Demo Started'] },
        { string: ['c-stopped', 'Demo Stopped'] },
        { string: [CHANNEL_ID, channel.name] },
    ] } },
    'GET /server/settings': { serverSettings: {
        environmentName: 'Production',
        serverName: 'Integration Engine',
        clearGlobalMap: true,
        smtpHost: 'smtp.example.org',
        smtpSecure: 'tls',
        administratorAutoLogoutIntervalEnabled: true,
        administratorAutoLogoutIntervalField: 15,
        defaultMetaDataColumns: { metaDataColumn: [{ name: 'SOURCE', type: 'STRING', mappingName: 'mirth_source' }] },
    } },
    'GET /server/channelTags': { set: { channelTag: [
        { id: 'tag-inbound', name: 'Inbound', channelIds: { string: ['c-started'] }, backgroundColor: { red: 62, green: 139, blue: 210, alpha: 255 } },
    ] } },
    'GET /server/configurationMap': { map: { entry: [
        { string: 'fhir.baseUrl', 'com.mirth.connect.util.ConfigurationProperty': { value: 'https://fhir.example.org', comment: 'FHIR service base URL' } },
    ] } },
    'GET /databaseTasks': { map: { entry: [
        { string: 'compact', databaseTask: { id: 'compact', name: 'Compact tables', description: 'Reclaim database space', status: 'IDLE' } },
    ] } },
    'GET /extensions/connectors': { map: { entry: [
        { string: 'File Reader', connectorMetaData: { name: 'File Reader', author: 'OIE', pluginVersion: '4.6.0', '@path': 'fileconnector' } },
        { string: 'HTTP Listener', connectorMetaData: { name: 'HTTP Listener', author: 'OIE', pluginVersion: '4.6.0', '@path': 'httpconnector' } },
    ] } },
    'GET /extensions/plugins': { map: { entry: [
        { string: 'Data Pruner', pluginMetaData: { name: 'Data Pruner', author: 'OIE', pluginVersion: '4.6.0', '@path': 'datapruner' } },
    ] } },
    'GET /extensions/*/enabled': 'true',
};

async function settle(page: any) {
    await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.addStyleTag({ content: `
        *, *::before, *::after {
            animation-duration: 0s !important;
            transition-duration: 0s !important;
            caret-color: transparent !important;
        }
    ` });
    await page.waitForTimeout(150);
}

async function capture(page: any, name: string) {
    await settle(page);
    await page.screenshot({ path: resolve(IMAGE_DIR, `${name}.png`), fullPage: false });
}

test.beforeAll(() => mkdirSync(IMAGE_DIR, { recursive: true }));

test('capture login', async ({ page }) => {
    await mockEngine(page, { 'GET /users/current': { __status: 401 } });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: resolve(IMAGE_DIR, 'login.png'), fullPage: false });
});

test('capture authenticated first-party screens', async ({ page }) => {
    await mockEngine(page, fixtures);

    await page.goto('/dashboard');
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();
    await capture(page, 'dashboard-table');

    await page.getByRole('button', { name: 'Card view', exact: true }).click();
    await expect(page.getByText('Demo Stopped', { exact: true })).toBeVisible();
    await capture(page, 'dashboard-cards');

    await page.goto('/channels');
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();
    await page.getByText('Demo Started', { exact: true }).click();
    await capture(page, 'channels');

    await page.goto('/channels/new/guided');
    await page.locator('.view-body input').first().fill('New Immunization Feed');
    await capture(page, 'channel-wizard');

    await page.goto(`/channels/${CHANNEL_ID}/edit`);
    await expect(page.getByRole('tab', { name: 'Summary', exact: true })).toBeVisible();
    await capture(page, 'channel-editor');

    await page.goto(`/channels/${CHANNEL_ID}/transformer/0`);
    await expect(page.getByRole('main').getByRole('button', { name: 'Add New Step', exact: true })).toBeVisible();
    await capture(page, 'transformer');

    await page.goto('/messages/c-started');
    await expect(page.getByText('10427', { exact: true })).toBeVisible();
    await page.getByText('10427', { exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Raw', exact: true })).toBeVisible();
    await capture(page, 'messages');

    await page.goto('/alerts');
    await expect(page.getByText('Error Alert', { exact: true })).toBeVisible();
    await page.getByText('Error Alert', { exact: true }).click();
    await capture(page, 'alerts');

    await page.goto('/alerts/new/guided');
    await page.locator('.view-body input').first().fill('Production Error Alert');
    await capture(page, 'alert-wizard');

    await page.goto('/events');
    await expect(page.getByText('Server startup', { exact: true })).toBeVisible();
    await page.getByText('Server startup', { exact: true }).click();
    await capture(page, 'events');

    await page.goto('/code-templates');
    await expect(page.getByText('Trim Whitespace', { exact: true })).toBeVisible();
    await page.getByText('Trim Whitespace', { exact: true }).click();
    await capture(page, 'code-templates');

    await page.goto('/global-scripts');
    await expect(page.getByText('Global Scripts', { exact: true }).first()).toBeVisible();
    await capture(page, 'global-scripts');

    await page.goto('/users');
    await expect(page.getByText('operator', { exact: true })).toBeVisible();
    await page.getByText('operator', { exact: true }).click();
    await capture(page, 'users');

    await page.goto('/settings');
    await expect(page.getByRole('tab', { name: 'Server', exact: true })).toBeVisible();
    await capture(page, 'settings-server');

    await page.getByRole('tab', { name: 'Administrator', exact: true }).click();
    await expect(page.locator('.pref-preview')).toBeVisible();
    await page.getByText('Data font', { exact: true }).scrollIntoViewIfNeeded();
    await capture(page, 'settings-administrator');

    await page.goto('/extensions');
    await expect(page.getByText('File Reader', { exact: true })).toBeVisible();
    await capture(page, 'extensions');

    await page.goto('/dashboard');
    await settle(page);
    await page.keyboard.press('Control+k');
    await expect(page.locator('.cmdk')).toBeVisible();
    await page.locator('.cmdk-field input').fill('channel');
    await page.screenshot({ path: resolve(IMAGE_DIR, 'command-palette.png'), fullPage: false });
});
