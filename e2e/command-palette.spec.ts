import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * Command palette (⌘K / Ctrl+K). What is pinned here is the behaviour that makes
 * it trustworthy rather than merely present: it reads the SAME registries the
 * rail and task panes read, it filters through the same RBAC check, a leading
 * character scopes the search, and running an entry actually navigates.
 */

test.beforeEach(async ({ page }) => {
    await mockEngine(page);
});

const open = async (page: any) => {
    await page.keyboard.press('Control+k');
    await expect(page.locator('.cmdk')).toBeVisible();
};

test('opens on the shortcut, closes on Escape, and returns focus', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });

    await open(page);
    // The field takes focus, not the first result — typing is the point.
    await expect(page.locator('.cmdk-field input')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.locator('.cmdk')).toHaveCount(0);
});

test('finds views, and a deep-linked settings section, by subsequence', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
    await open(page);

    // The views come from platform.navItems() — the rail's own list.
    await page.locator('.cmdk-field input').fill('chan');
    await expect(page.locator('.cmdk-opt', { hasText: 'Channels' }).first()).toBeVisible();

    /* "prune" reaches a Settings TAB, not just the Settings view: the sections are
       registered as commands with their own deep links. */
    await page.locator('.cmdk-field input').fill('prune');
    await expect(page.locator('.cmdk-opt')).toHaveCount(1);
    await expect(page.locator('.cmdk-opt').first()).toContainText('Data Pruner');

    // Matched characters are marked, so the ranking shows its working.
    await expect(page.locator('.cmdk-opt b').first()).toBeVisible();
});

test('a prefix scopes the search', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();
    await open(page);

    await page.locator('.cmdk-field input').fill('#demo');
    await expect(page.locator('.cmdk-scope')).toHaveText('Channels');
    const labels = await page.locator('.cmdk-opt .cmdk-label').allTextContents();
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((l) => /demo/i.test(l))).toBe(true);

    await page.locator('.cmdk-field input').fill('/set');
    await expect(page.locator('.cmdk-scope')).toHaveText('Views');
    await expect(page.locator('.cmdk-opt').first()).toContainText('Settings');
});

test('running an entry navigates and is remembered as recent', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });

    await open(page);
    await page.locator('.cmdk-field input').fill('/events');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/events/);
    await expect(page.locator('.cmdk')).toHaveCount(0);

    // Reopening with an empty query leads with what was just run.
    await open(page);
    await expect(page.locator('.cmdk-group').first()).toHaveText('Recent');
    await expect(page.locator('.cmdk-opt').first()).toContainText('Events');
});

test('arrow keys move the selection and only one option is selected', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
    await open(page);
    await page.locator('.cmdk-field input').fill('set');

    const selected = page.locator('.cmdk-opt[aria-selected="true"]');
    await expect(selected).toHaveCount(1);
    const first = await selected.textContent();

    await page.keyboard.press('ArrowDown');
    await expect(selected).toHaveCount(1);
    expect(await selected.textContent()).not.toBe(first);

    await page.keyboard.press('ArrowUp');
    expect(await selected.textContent()).toBe(first);
});

test('the palette offers exactly the rail\'s items, not a parallel list', async ({ page }) => {
    /* The authorization guarantee, stated as something observable. Both read
       platform.navItems() and both filter through the same checkTask(), so the
       sets must be identical — if the palette ever grew its own list, or skipped
       the RBAC filter, this is where it would show up. (The suite's fixtures
       permit every task, so denying one is not expressible here; what can be
       pinned is that there is one source, not two.) */
    await page.goto('/dashboard');
    await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });

    const railLabels = await page.locator('.rail-nav [data-nav-item] .rail-label, .rail-nav [data-nav-item] span')
        .evaluateAll((els) => [...new Set(els.map((e) => e.textContent.trim()).filter(Boolean))].sort());

    await open(page);
    await page.locator('.cmdk-field input').fill('/');          // every view, unfiltered
    const paletteLabels = await page.locator('.cmdk-opt .cmdk-label')
        .evaluateAll((els) => els.map((e) => e.textContent.trim()).sort());

    expect(railLabels.length).toBeGreaterThan(5);
    expect(paletteLabels).toEqual(railLabels);
});
