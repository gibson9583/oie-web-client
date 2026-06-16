import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

test.beforeEach(async ({ page }) => {
    await mockEngine(page);
});

test('navigates to Channels and lists channels', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Channels' }).click();

    await expect(page).toHaveURL(/#\/channels/);
    await expect(page.getByText('Demo Started')).toBeVisible();
    await expect(page.getByText('Demo Stopped')).toBeVisible();
    // The Channels task pane offers New Channel.
    await expect(page.getByRole('button', { name: 'New Channel' })).toBeVisible();
});
