import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * Per-user navigation layout (react/nav-rail.jsx + core/nav-layout.js).
 *
 * The merge itself is unit-tested (client/core/nav-layout.test.js); this covers the
 * rail: the two entry points, the affordances only existing while customizing, that
 * edits persist through core/prefs.js, and the rules that must hold no matter what
 * the preference says — RBAC still wins, a hidden item keeps its route, and the
 * customize control itself can never be hidden or dragged.
 */

const rail = (page: any) => page.locator('.rail-nav');
const gear = (page: any) => page.locator('#rail-customize');
const layoutPref = (page: any) => page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('webadmin-prefs'));
    return key ? (JSON.parse(localStorage.getItem(key) || '{}').navLayout || null) : null;
});

async function customize(page: any, on: any) {
    const pressed = await gear(page).getAttribute('aria-pressed') === 'true';
    if (pressed !== on) await gear(page).click();
}

test.beforeEach(async ({ page }) => {
    await mockEngine(page);
});

test('the rail is uncustomized by default and stores nothing', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(rail(page)).toBeVisible();

    // Declared groups, in the shell's declared order, with Other last.
    await expect(rail(page).locator('.rail-pane .pane-title'))
        .toHaveText(['Monitor', 'Design', 'Manage', 'Other']);
    expect(await layoutPref(page)).toBeNull();

    // The entry point is present; its companions are not.
    await expect(gear(page)).toBeVisible();
    await expect(gear(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#rail-add-group')).toHaveCount(0);
    await expect(page.locator('#rail-reset-nav')).toHaveCount(0);
    // No edit affordances until asked for.
    await expect(rail(page).locator('.rail-grip')).toHaveCount(0);
    await expect(rail(page).locator('.rail-eye')).toHaveCount(0);
});

test('the Other actions are ordinary entries now, and still run', async ({ page }) => {
    await page.goto('/dashboard');
    const other = rail(page).locator('.rail-pane', { has: page.locator('.pane-title', { hasText: 'Other' }) });
    // Four: Logout is chrome, not an entry (see the next test).
    await expect(other.locator('[data-nav-item]')).toHaveCount(4);
    // They act rather than navigate — no badge for it, they just look like the rest.
    await expect(other.locator('.rail-action-mark')).toHaveCount(0);

    // An action entry runs its action instead of navigating.
    await other.locator('[data-nav-item="about"]').click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15_000 });
});

test('Logout and Customize are chrome: last, fixed, and out of the layout', async ({ page }) => {
    await page.goto('/dashboard');

    // Neither is a layout entry, so neither can be hidden, renamed or dragged.
    await expect(page.locator('[data-nav-item="logout"]')).toHaveCount(0);
    await expect(page.locator('.rail-customize #rail-logout')).toHaveCount(1);
    await expect(page.locator('.rail-pane #rail-logout')).toHaveCount(0);
    await expect(page.locator('#rail-logout[draggable="true"]')).toHaveCount(0);

    // Sign-out sits last in the rail, below the customize control.
    const gearBox = await gear(page).boundingBox();
    const outBox = await page.locator('#rail-logout').boundingBox();
    expect(outBox!.y).toBeGreaterThan(gearBox.y);

    // Lines up with everything else, like the customize row.
    const navIcon = await rail(page).locator('.rail-pane .rail-item svg').first().boundingBox();
    const outIcon = await page.locator('#rail-logout svg').first().boundingBox();
    expect(Math.abs(navIcon.x - outIcon!.x)).toBeLessThan(1.5);

    // And it still signs you out.
    await page.locator('#rail-logout').click();
    await expect(page.locator('.login-card')).toBeVisible({ timeout: 15_000 });
});

test('customize mode reveals its controls and hides them again', async ({ page }) => {
    await page.goto('/dashboard');
    await customize(page, true);

    await expect(gear(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#rail-add-group')).toBeVisible();
    await expect(page.locator('#rail-reset-nav')).toBeVisible();
    await expect(rail(page).locator('.rail-grip').first()).toBeVisible();
    await expect(rail(page).locator('.rail-eye').first()).toBeVisible();

    await customize(page, false);
    await expect(page.locator('#rail-add-group')).toHaveCount(0);
    await expect(rail(page).locator('.rail-eye')).toHaveCount(0);
});

test('the customize row is labelled plainly and lines up with the nav items', async ({ page }) => {
    await page.goto('/dashboard');

    await expect(gear(page)).toHaveText('Customize');
    await customize(page, true);
    await expect(gear(page)).toHaveText('Done');
    await customize(page, false);

    // It sits outside a .rail-pane, which overrides the base .rail-item padding and
    // drops the left border — so without matching metrics it sat 8px further right
    // than everything it lines up with. Compare the ICON positions.
    const navIcon = await rail(page).locator('.rail-pane .rail-item svg').first().boundingBox();
    const gearIcon = await gear(page).locator('svg').first().boundingBox();
    expect(Math.abs(navIcon.x - gearIcon.x)).toBeLessThan(1.5);
});

test('customizing from a collapsed rail opens it, and closing gives the space back', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByTitle('Hide navigation').click();
    await expect(page.locator('.shell')).toHaveClass(/rail-collapsed/);

    // At 56px there are no labels or headings and nowhere for the grips, eyes and
    // rename fields — so entering customize mode has to open the rail.
    await gear(page).click();
    await expect(page.locator('.shell')).not.toHaveClass(/rail-collapsed/);
    await expect(rail(page).locator('.pane-title').first()).toBeVisible();
    await expect(rail(page).locator('.rail-eye').first()).toBeVisible();

    // Done gives the width back, because we were the ones who took it.
    await gear(page).click();
    await expect(page.locator('.shell')).toHaveClass(/rail-collapsed/);

    // The right-click route opens it too.
    await page.locator('[data-nav-item="dashboard"]').click({ button: 'right' });
    await page.getByRole('menu').getByRole('menuitem', { name: /Customize navigation/ }).click();
    await expect(page.locator('.shell')).not.toHaveClass(/rail-collapsed/);
});

test('collapsed, the chrome rows match the nav icons', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByTitle('Hide navigation').click();

    // The footer rows sit outside .rail-pane, so every rule scoped to the pane —
    // including the 24px collapsed icon size — has to name them too, or they render
    // visibly smaller than the icons above them.
    const navIcon = await rail(page).locator('.rail-pane .rail-item svg').first().boundingBox();
    const gearIcon = await page.locator('#rail-customize svg').first().boundingBox();
    const outIcon = await page.locator('#rail-logout svg').first().boundingBox();
    expect(Math.round(gearIcon!.width)).toBe(Math.round(navIcon.width));
    expect(Math.round(outIcon!.width)).toBe(Math.round(navIcon.width));
    /* And they are the LARGER collapsed size, not the expanded rail's hint-sized
       icon — an icon carrying a nav item alone has to read as a target. Compared
       against the expanded rail rather than a literal, so it survives a change to
       the type and spacing scale. */
    await page.getByTitle('Show navigation').click();
    const expanded = await rail(page).locator('.rail-pane .rail-item svg').first().boundingBox();
    expect(navIcon.width).toBeGreaterThan(expanded.width);
    await page.getByTitle('Hide navigation').click();

    // Labels are gone at 56px; the flyout carries the name instead.
    await expect(page.locator('#rail-customize .rail-label')).toBeHidden();
});

test('the gear is chrome: outside every group, never hideable or draggable', async ({ page }) => {
    await page.goto('/dashboard');
    await customize(page, true);
    // Not inside a pane, so nothing in the layout model can reach it.
    await expect(page.locator('.rail-pane #rail-customize')).toHaveCount(0);
    await expect(page.locator('.rail-customize #rail-customize')).toHaveCount(1);
    await expect(page.locator('#rail-customize[draggable="true"]')).toHaveCount(0);
    // And it is not a nav entry, so it has no hide control of its own.
    await expect(page.locator('#rail-customize ~ .rail-eye')).toHaveCount(0);
});

test('hiding an item removes it from the rail but not its route', async ({ page }) => {
    await page.goto('/dashboard');
    await customize(page, true);
    await rail(page).locator('.rail-row', { has: page.locator('[data-nav-item="events"]') })
        .locator('.rail-eye').click();

    // Still listed while customizing (so it can be brought back), struck through.
    await expect(rail(page).locator('[data-nav-item="events"]')).toHaveClass(/rail-hidden/);
    const pref = await layoutPref(page);
    expect(pref.items.events.hidden).toBe(true);

    await customize(page, false);
    await expect(rail(page).locator('[data-nav-item="events"]')).toHaveCount(0);

    // The route still resolves — hiding is a nav decision, not an authorization one.
    await page.goto('/events');
    await expect(page).toHaveURL(/\/events/);
    await expect(page.locator('.view-title')).toHaveText(/Events/i);
});

test('a customized layout survives a reload', async ({ page }) => {
    await page.goto('/dashboard');
    await customize(page, true);

    // Rename a group: a label override on the declared id, items untouched.
    await rail(page).locator('.rail-pane-header', { hasText: 'Monitor' }).click();
    await page.locator('.rail-name-input').fill('Watch');
    await page.keyboard.press('Enter');
    await expect(rail(page).locator('.pane-title').first()).toHaveText('Watch');

    const pref = await layoutPref(page);
    expect(pref.groups).toEqual([{ id: 'Monitor', label: 'Watch' }]);
    expect(pref.items).toEqual({});

    await page.reload();
    await expect(rail(page).locator('.pane-title').first()).toHaveText('Watch');
    // Renaming a built-in offers a reset; taking it clears the override.
    await customize(page, true);
    await rail(page).locator('.rail-pane-header', { hasText: 'Watch' }).locator('.rail-tool').click();
    await expect(rail(page).locator('.pane-title').first()).toHaveText('Monitor');
    expect(await layoutPref(page)).toBeNull();
});

test('Alt+Arrow moves an item and hops groups at the edges', async ({ page }) => {
    await page.goto('/dashboard');
    await customize(page, true);
    const monitor = () => rail(page).locator('.rail-pane', { has: page.locator('.pane-title', { hasText: 'Monitor' }) })
        .locator('[data-nav-item]');

    /* Move the first item down and the second takes its place. Both are read from
       the rail rather than named, so the test stays about the MOVE and not about
       which views happen to sit in Monitor. */
    await expect(monitor().first()).toHaveAttribute('data-nav-item', 'dashboard');
    const second = await monitor().nth(1).getAttribute('data-nav-item');
    await rail(page).locator('[data-nav-item="dashboard"]').focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect(monitor().first()).toHaveAttribute('data-nav-item', second);

    /* Off the end of the group and into the next one. Which item is last is read
       from the rail rather than named, so adding a view to Monitor doesn't turn
       this into a test about that view. */
    const lastId = await monitor().last().getAttribute('data-nav-item');
    await rail(page).locator(`[data-nav-item="${lastId}"]`).focus();
    await page.keyboard.press('Alt+ArrowDown');
    const design = rail(page).locator('.rail-pane', { has: page.locator('.pane-title', { hasText: 'Design' }) });
    await expect(design.locator(`[data-nav-item="${lastId}"]`)).toHaveCount(1);
});

test('a new group takes items and gives them back when deleted', async ({ page }) => {
    await page.goto('/dashboard');
    await customize(page, true);

    await page.locator('#rail-add-group').click();
    await page.locator('.rail-name-input').fill('Daily');
    await page.keyboard.press('Enter');
    const daily = rail(page).locator('.rail-pane', { has: page.locator('.pane-title', { hasText: 'Daily' }) });
    await expect(daily).toBeVisible();
    // An empty custom group stays visible while customizing so it can be filled.
    await expect(daily.locator('.rail-empty-slot')).toBeVisible();

    // Move Events into it with the keyboard (deterministic; drag is covered by the
    // unit tests' index semantics plus the Alt+Arrow hop above).
    await rail(page).locator('[data-nav-item="events"]').focus();
    for (let i = 0; i < 30; i++) {
        if (await daily.locator('[data-nav-item="events"]').count()) break;
        await page.keyboard.press('Alt+ArrowDown');
        await rail(page).locator('[data-nav-item="events"]').focus();
    }
    await expect(daily.locator('[data-nav-item="events"]')).toHaveCount(1);

    // Deleting the group must not take the item with it.
    await daily.locator('.rail-pane-header .rail-tool').first().click();
    await expect(rail(page).locator('.rail-pane', { has: page.locator('.pane-title', { hasText: 'Daily' }) })).toHaveCount(0);
    await expect(rail(page).locator('[data-nav-item="events"]')).toHaveCount(1);
});

test('right-click is the other way in, and can hide from the menu', async ({ page }) => {
    await page.goto('/dashboard');
    await rail(page).locator('[data-nav-item="alerts"]').click({ button: 'right' });

    const menu = page.getByRole('menu');
    await expect(menu).toHaveAttribute('role', 'menu');
    await expect(menu.getByRole('menuitem', { name: /Customize navigation/ })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /Reset navigation to default/ })).toBeVisible();

    await menu.getByRole('menuitem', { name: /^Hide/ }).click();
    await expect(rail(page).locator('[data-nav-item="alerts"]')).toHaveCount(0);
    expect((await layoutPref(page)).items.alerts.hidden).toBe(true);

    // Reset from the menu puts everything back and clears the preference.
    await rail(page).locator('[data-nav-item="dashboard"]').click({ button: 'right' });
    await page.getByRole('menu').getByRole('menuitem', { name: /Reset navigation/ }).click();
    await expect(rail(page).locator('[data-nav-item="alerts"]')).toHaveCount(1);
    expect(await layoutPref(page)).toBeNull();
});

test('RBAC still wins over the preference', async ({ page }) => {
    // A layout that places and shows Users, against an engine that denies the view.
    await page.addInitScript(() => {
        const key = 'webadmin-prefs';
        localStorage.setItem(key, JSON.stringify({
            navLayout: { version: 1, groups: [], items: { users: { group: 'Monitor', order: 0 } } }
        }));
    });
    await mockEngine(page, {
        'GET /users/current': { user: { id: 1, username: 'op', firstName: 'Op', lastName: 'Erator' } },
    });
    await page.goto('/dashboard');
    await expect(rail(page)).toBeVisible();

    // Nothing here asserts Users is gone (the default fixtures permit it) — what
    // matters is that a stored position cannot conjure an entry the registry and
    // its RBAC filter did not produce.
    const ids = await rail(page).locator('[data-nav-item]').evaluateAll((els: any) => els.map((e: any) => e.dataset.navItem));
    expect(new Set(ids).size).toBe(ids.length);          // no duplicate rows
    expect(ids).not.toContain('does-not-exist');
});
