import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * Keyboard + ARIA semantics for the shared primitives. Each of these was
 * pointer-only or unannounced before, and each is easy to lose again in a
 * refactor, so they are pinned here rather than inside a single view's spec:
 *
 *   dialogs      role/labelling, focus trap, focus restore, background hidden,
 *                and the Escape listener that used to outlive its dialog
 *   tree table   treegrid roles, roving row focus, arrow navigation, aria-sort
 *   tablists     role=tablist + arrow keys + roving tabindex
 *   menus        role=menu, first item focused, arrows, typeahead, Escape
 *   toasts       a polite live region
 *   segpills     radiogroup + aria-checked
 *   rail panes   aria-expanded + keyboard collapse
 */

test.beforeEach(async ({ page }) => {
    await mockEngine(page);
});

/* ---- dialogs ---------------------------------------------------------------- */

test('a dialog is labelled, traps Tab, and restores focus on Escape', async ({ page }) => {
    await page.goto('/channels');
    await page.locator('tr', { hasText: 'Demo Started' }).first().click();

    const opener = page.getByRole('button', { name: 'Delete Channel', exact: true });
    await opener.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Labelled by its own visible title, not an invented string.
    const labelledBy = await dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    await expect(page.locator(`#${labelledBy}`)).toHaveText(/Delete/i);

    /* The app behind the dialog is out of the a11y tree while it is open. This is
       the modality guarantee itself, and the only one asserted: Radix deliberately
       does not set aria-modal — with the rest of the page already aria-hidden the
       attribute adds nothing and trips a known VoiceOver bug. */
    await expect(page.locator('#app')).toHaveAttribute('aria-hidden', 'true');

    // Focus starts inside and Tab cycles without escaping.
    expect(await page.evaluate(() => document.querySelector('.modal')!.contains(document.activeElement))).toBe(true);
    for (let i = 0; i < 8; i++) {
        await page.keyboard.press('Tab');
        const inside = await page.evaluate(() => document.querySelector('.modal')?.contains(document.activeElement));
        expect(inside).toBe(true);
    }

    // Escape closes it, un-hides the app, and hands focus back to the opener.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#app')).not.toHaveAttribute('aria-hidden', 'true');
    await expect(opener).toBeFocused();
});

test('a dialog closed by its button leaves no Escape handler behind', async ({ page }) => {
    // The old close() removed the keydown listener only on the Escape path, so a
    // dialog dismissed any other way left a live handler that re-ran onClose() on
    // the next Escape anywhere in the app. Open/cancel, then press Escape twice
    // with no dialog up: nothing may reopen, blow up, or re-fire.
    const errors: any[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/channels');
    await page.locator('tr', { hasText: 'Demo Started' }).first().click();
    await page.getByRole('button', { name: 'Delete Channel', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('#app')).not.toHaveAttribute('aria-hidden', 'true');
    expect(errors).toEqual([]);
});

/* ---- tree table (dashboard status board) ----------------------------------- */

test('the status board is a treegrid with roving row focus and arrow navigation', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();

    const grid = page.locator('table.dt[role="treegrid"]');
    await expect(grid).toHaveCount(1);

    // Exactly one row in the tab order, whichever it is.
    await expect(grid.locator('tbody tr[tabindex="0"]')).toHaveCount(1);

    // Group rows publish their expansion state; the twisty glyph is decorative.
    const groupRow = grid.locator('tbody tr[aria-expanded]').first();
    await expect(groupRow).toHaveAttribute('aria-level', '1');

    // Arrow keys move the row cursor; Space selects (so arrows don't fire a
    // view's selection side effects on every press).
    await grid.locator('tbody tr[tabindex="0"]').focus();
    const firstFocused = await page.evaluate(() => document.activeElement!.textContent);
    await page.keyboard.press('ArrowDown');
    const afterDown = await page.evaluate(() => document.activeElement!.textContent);
    expect(afterDown).not.toBe(firstFocused);
    await expect(page.locator('tr[aria-selected="true"]')).toHaveCount(0);
    await page.keyboard.press(' ');
    await expect(page.locator('tr[aria-selected="true"]')).toHaveCount(1);

    // Home returns to the first row.
    await page.keyboard.press('Home');
    expect(await page.evaluate(() => document.activeElement!.textContent)).toBe(firstFocused);
});

test('a sortable column header announces its sort state and sorts from the keyboard', async ({ page }) => {
    await page.goto('/channels');
    await expect(page.getByText('Demo Started')).toBeVisible();

    const nameHeader = page.getByRole('columnheader', { name: 'Name', exact: true });
    await expect(nameHeader).toHaveAttribute('aria-sort', 'none');

    await nameHeader.focus();
    await page.keyboard.press('Enter');
    await expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
    await page.keyboard.press('Enter');
    await expect(nameHeader).toHaveAttribute('aria-sort', 'descending');
});

/* ---- tablists -------------------------------------------------------------- */

test('the settings tabs are a tablist with arrow-key navigation and one tab stop', async ({ page }) => {
    await page.goto('/settings');
    const list = page.getByRole('tablist', { name: 'Settings sections' });
    await expect(list).toBeVisible();

    const server = page.getByRole('tab', { name: 'Server', exact: true });
    await expect(server).toHaveAttribute('aria-selected', 'true');
    /* The strip is ONE tab stop, not one per tab. Radix expresses that by making the
       LIST the tab stop and delegating focus to the selected trigger, rather than
       putting tabindex=0 on the trigger — so assert the behaviour (tab into the strip,
       land on the selected tab, and only that one is tabbable) rather than the
       attribute an implementation happens to use. */
    await expect(list).toHaveAttribute('tabindex', '0');
    await list.focus();
    await expect(server).toBeFocused();
    await expect(list.locator('[role="tab"]:not([tabindex="-1"])')).toHaveCount(1);

    await server.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Administrator', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(server).toHaveAttribute('aria-selected', 'false');

    await page.keyboard.press('End');
    const tabs = list.getByRole('tab');
    await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
});

/* ---- context menus --------------------------------------------------------- */

test('a context menu takes focus, moves on arrows, type-aheads, and Escape restores focus', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();

    const row = page.locator('tr', { hasText: 'Demo Started' }).first();
    await row.click();
    await row.click({ button: 'right' });

    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    const items = menu.getByRole('menuitem');

    /* Focus lands in the menu — it used to be left behind on the page, making the
       menu unreachable by keyboard entirely. On the menu itself rather than its
       first item, which is both Radix's model for a pointer-opened menu and the
       native one: right-click highlights nothing, so a stray Enter can't fire the
       first action. ArrowDown is what steps onto it. */
    expect(await page.evaluate(() => document.querySelector('[role=menu]')!.contains(document.activeElement))).toBe(true);
    await expect(items.first()).not.toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(items.first()).toBeFocused();

    /* Type-ahead jumps to an item by first letter. Radix drops the FIRST such
       keystroke after a menu opens — an item's search text is registered from a
       useState it only settles after mount, and this reproduces on the plain
       account menu too, so it is the primitive's behaviour rather than this
       point-anchored menu's. Its search buffer clears after a second, so press,
       wait it out, and press again. */
    await page.keyboard.press('v');
    await page.waitForTimeout(1100);
    await page.keyboard.press('v');
    await expect(items.filter({ hasText: 'View Messages' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(row).toBeFocused();
});

/* ---- toasts ---------------------------------------------------------------- */

test('toasts are announced through a polite live region', async ({ page }) => {
    // Deploy from the Channels view is the shortest path to a success toast.
    await page.goto('/channels');
    await expect(page.getByText('Demo Started')).toBeVisible();
    await page.locator('tr', { hasText: 'Demo Started' }).first().click();
    await page.getByRole('button', { name: 'Deploy Channel', exact: true }).click();

    /* Radix announces a toast through its own live region and leaves the visible
       viewport as a labelled region reachable with F8 — so assert BOTH halves:
       the toast is visible, and its text really reached a live region. */
    const toast = page.locator('.toasts .toast');
    await expect(toast).toBeVisible();
    const text = (await toast.locator('.toast-msg').textContent())!.trim();
    expect(text).not.toBe('');
    await expect(page.locator('[aria-live]', { hasText: text }).first()).toHaveCount(1);

    // The viewport itself stays a landmark, so the toasts are findable, not just
    // announced (Radix labels a wrapper around the list, not the list element).
    await expect(page.getByRole('region', { name: /notification/i })).toHaveCount(1);
});

/* ---- segpill + rail pane --------------------------------------------------- */

test('the dashboard segmented toggles are radiogroups and move on arrows', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/dashboard');
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();

    const stats = page.getByRole('radiogroup', { name: 'Statistics strip' });
    await expect(stats.getByRole('radio', { name: 'On' })).toHaveAttribute('aria-checked', 'true');
    /* One tab stop for the group, not one per option — asserted as behaviour, because
       Radix's roving focus establishes the tabbable item lazily (everything is -1
       until focus enters, then the checked option takes it). */
    await stats.getByRole('radio', { name: 'On' }).focus();
    await expect(stats.locator('[role="radio"]:not([tabindex="-1"])')).toHaveCount(1);

    /* An arrow moves the choice, not just the focus — the APG model, and what the
       hand-rolled strip did too.

       The key is HELD rather than press()ed. Radix commits from the item's onFocus,
       guarded by a document-level "an arrow is down" flag it clears on keyup, and
       roving focus lands the item in an effect. press() releases instantly, so the
       two race and the result differs between machines — it passed locally and
       failed in CI. A real keypress is never that short. */
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(50);
    await page.keyboard.up('ArrowRight');
    await expect(stats.getByRole('radio', { name: 'Off' })).toBeFocused();
    await expect(stats.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true');
    await expect(stats.getByRole('radio', { name: 'On' })).toHaveAttribute('aria-checked', 'false');
    // And the choice really took effect — the strip is closed.
    await expect.poll(async () => (await page.locator('.dash-kpis-wrap').boundingBox())!.height).toBe(0);
});

test('a task pane collapse is operable and announced', async ({ page }) => {
    await page.goto('/dashboard');
    const header = page.locator('.rail-pane-header', { hasText: 'Dashboard Tasks' });
    await expect(header).toHaveAttribute('aria-expanded', 'true');

    const bodyId = await header.getAttribute('aria-controls');
    expect(bodyId).toBeTruthy();
    await expect(page.locator(`#${bodyId}`)).toBeVisible();

    // Keyboard-operable: it was a click-only div.
    await header.focus();
    await page.keyboard.press('Enter');
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(header).toHaveAttribute('aria-expanded', 'true');
});

/* ---- typeahead ------------------------------------------------------------- */

test('the dashboard filter is a combobox that publishes its active suggestion', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/dashboard');
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();

    const input = page.getByRole('combobox');
    await input.click();
    await input.fill('Demo');
    await expect(page.getByRole('listbox', { name: 'Filter suggestions' })).toBeVisible();
    await expect(input).toHaveAttribute('aria-expanded', 'true');

    // The arrow-key cursor is exposed as aria-activedescendant, not just a class.
    await page.keyboard.press('ArrowDown');
    const active = await input.getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
    await expect(page.locator(`#${active}`)).toHaveAttribute('aria-selected', 'true');
});
