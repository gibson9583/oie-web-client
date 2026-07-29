import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * Individual rail PANES collapse by clicking their header — a different mechanism
 * from the whole-rail hamburger (see rail-collapse.spec.js). Pane state lives in a
 * module-level Map, so it is deliberately session-scoped: it survives navigation
 * but NOT a reload. Both halves of that are pinned here.
 */
test('a rail pane collapses from its header, survives navigation, and resets on reload', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/dashboard');

    const pane = page.locator('.rail-pane', { has: page.locator('.pane-title', { hasText: 'Other' }) });
    const body = pane.locator('.rail-pane-body');
    await expect(body).toBeVisible();

    // Collapse: the header toggles the pane and hides its body.
    await pane.locator('.rail-pane-header').click();
    await expect(pane).toHaveClass(/collapsed/);
    await expect(body).toBeHidden();

    // Survives navigation — the collapse Map outlives the view swap.
    await page.getByRole('button', { name: 'Channels', exact: true }).click();
    await expect(page).toHaveURL(/\/channels/);
    await expect(pane).toHaveClass(/collapsed/);
    await expect(body).toBeHidden();

    // Session-scoped, not persisted: a reload starts expanded again.
    await page.reload();
    await expect(page.locator('.rail-pane', { has: page.locator('.pane-title', { hasText: 'Other' }) }))
        .not.toHaveClass(/collapsed/);
});
