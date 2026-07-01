import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * Per-user background-color override read path (issue #10). Swing reads it via the
 * single-key getUserPreference(id, "backgroundColor"); the bulk getPreferences
 * mangles the <awt-color> value (unwrap() collapses a one-entry map; parseBody
 * turns the XML into an object). useServerIdentity now does the raw per-key read
 * and tints the chrome (--topbar-bg / --rail-bg) on login.
 */

const AWT = '<awt-color>\n  <red>255</red>\n  <green>136</green>\n  <blue>0</blue>\n  <alpha>255</alpha>\n</awt-color>';

const topbarVar = (page) =>
    page.evaluate(() => document.documentElement.style.getPropertyValue('--topbar-bg').trim());

test('a saved backgroundColor override is applied on login', async ({ page }) => {
    await mockEngine(page, { 'GET /users/1/preferences/backgroundColor': AWT });
    await page.goto('/');

    // The server chip renders once useServerIdentity resolves (same .then that
    // applies the color), so this also gates the color having been applied.
    await expect(page.locator('.server-chip')).toContainText('v4.5.0');
    expect(await topbarVar(page)).not.toBe('');
});

test('no override falls back to server default (chrome not user-tinted)', async ({ page }) => {
    await mockEngine(page, { 'GET /users/1/preferences/backgroundColor': '' });
    await page.goto('/');

    await expect(page.locator('.server-chip')).toContainText('v4.5.0');
    // No override and no server default color in the fixtures → env vars cleared.
    expect(await topbarVar(page)).toBe('');
});
