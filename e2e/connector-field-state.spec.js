import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';
import { CASES, makeChannel } from './connector-fixtures.js';

/*
 * Field enable/disable + dynamic-label parity with the Swing UI — the wrong-state
 * gaps the connector parity audit surfaced. Each test opens a connector panel,
 * changes the gating field, and asserts the dependent field's state, so a
 * regression in a disabled()/options() predicate fails here.
 */

async function openPanel(page, name, mode) {
    const c = CASES.find((x) => x.name === name);
    const id = `fs-${name.toLowerCase().replace(/\s+/g, '-')}`;
    const channel = mode === 'SOURCE'
        ? makeChannel(id, { source: { transportName: name, properties: c.properties() } })
        : makeChannel(id, { destination: { transportName: name, properties: c.properties() } });
    await mockEngine(page, { [`GET /channels/${id}`]: { channel } });
    await page.goto(`/channels/${id}/edit`);
    await page.getByRole('button', { name: mode === 'SOURCE' ? 'Source' : 'Destinations', exact: true }).click();
    if (mode === 'DESTINATION') await page.getByRole('cell', { name, exact: true }).first().click();
    await expect(page.locator('.cform-section').first()).toBeVisible();
}

test('HTTP Sender: Charset Encoding stays settable for application/x-www-form-urlencoded', async ({ page }) => {
    await openPanel(page, 'HTTP Sender', 'DESTINATION');
    // Default method is POST; switching the content type to form-urlencoded must
    // NOT disable the charset (the engine uses it for the form entity).
    await page.locator('[data-fkey="contentType"]').first().fill('application/x-www-form-urlencoded');
    await expect(page.locator('[data-fkey="charset"]').first()).toBeEnabled();
});

test('File Reader: S3 "Use Temporary Credentials" is disabled when Anonymous', async ({ page }) => {
    await openPanel(page, 'File Reader', 'SOURCE');
    await page.locator('[data-fkey="scheme"]').first().selectOption('S3');
    await page.locator('[data-fkey="anonymous"]').getByRole('radio', { name: 'Yes' }).check();
    await expect(page.locator('[data-fkey="schemeProperties.useTemporaryCredentials"]').getByRole('radio').first()).toBeDisabled();
});

test('Database Reader: post-process options relabel under Aggregate Results', async ({ page }) => {
    await openPanel(page, 'Database Reader', 'SOURCE');
    await expect(page.getByText('After each message', { exact: true })).toBeVisible();
    await page.locator('[data-fkey="aggregateResults"]').getByRole('radio', { name: 'Yes' }).check();
    await expect(page.getByText('For each row', { exact: true })).toBeVisible();
    await expect(page.getByText('After each message', { exact: true })).toHaveCount(0);
});

test('Document Writer: "Test Write" is disabled when Output is Attachment', async ({ page }) => {
    await openPanel(page, 'Document Writer', 'DESTINATION');
    await expect(page.getByRole('button', { name: 'Test Write', exact: true })).toBeEnabled();
    await page.locator('[data-fkey="output"]').getByRole('radio', { name: 'Attachment' }).check();
    await expect(page.getByRole('button', { name: 'Test Write', exact: true })).toBeDisabled();
});

test('TCP Sender: Test Connection / Ports in Use grey by mode + local binding', async ({ page }) => {
    await openPanel(page, 'TCP Sender', 'DESTINATION');
    // Default is Client mode with no override: Test Connection on, Ports in Use off.
    await expect(page.getByRole('button', { name: 'Test Connection', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Ports in Use', exact: true })).toBeDisabled();
    // Server mode: Test Connection off (no remote to test), Ports in Use on (local bind).
    await page.locator('[data-fkey="serverMode"]').getByRole('radio', { name: 'Server', exact: true }).check();
    await expect(page.getByRole('button', { name: 'Test Connection', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Ports in Use', exact: true })).toBeEnabled();
});
