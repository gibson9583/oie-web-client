import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

test.beforeEach(async ({ page }) => {
    await mockEngine(page);
});

// Alerts list ported to React (multi-select + selection-gated task pane). The
// editor stays the legacy view.
test('Alerts lists alerts and gates task actions on selection/status', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Alerts', exact: true }).click();
    await expect(page).toHaveURL(/\/alerts/);

    await expect(page.getByText('Error Alert')).toBeVisible();
    await expect(page.getByText('Deploy Alert')).toBeVisible();
    await expect(page.getByRole('button', { name: 'New Alert' })).toBeVisible();

    // No selection → single-selection actions hidden.
    await expect(page.getByRole('button', { name: 'Edit Alert' })).toHaveCount(0);

    // Select the disabled alert → Edit/Delete appear; Enable shows (it's off),
    // Disable does not.
    await page.locator('tr', { hasText: 'Deploy Alert' }).first().click();
    await expect(page.getByRole('button', { name: 'Edit Alert' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete Alert' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enable Alert' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Disable Alert' })).toHaveCount(0);
});

// The alert editor supports adding actions via the Add button AND a right-click
// menu (Swing parity).
test('alert editor adds an action via right-click', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Alerts', exact: true }).click();
    await page.getByRole('button', { name: 'New Alert' }).click();
    await page.getByText('Classic editor').click();
    await expect(page).toHaveURL(/\/alerts\/.*\/edit/);

    await expect(page.getByText('No actions defined')).toBeVisible();
    await page.getByText('No actions defined').click({ button: 'right' });
    await page.getByRole('menu').getByText('Add Action').click();
    await expect(page.getByText('No actions defined')).toHaveCount(0);
});

// The empty landing state offers Create/Import actions (RBAC-gated like their
// task buttons) instead of a bare "No alerts" table.
test('an empty alert list lands on the create/import empty state', async ({ page }) => {
    await mockEngine(page, { 'GET /alerts': { list: '' } });
    await page.goto('/alerts');

    await expect(page.getByText('No Alerts Configured')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Alert' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import Alert', exact: true }).last()).toBeVisible();

    // Create Alert opens the same New Alert chooser flow as the task button
    // (no saved default in a fresh session → the chooser modal).
    await page.getByRole('button', { name: 'Create Alert' }).click();
    await expect(page.getByText('Classic editor')).toBeVisible();
});

test('importing the same alert twice prompts before replacing it', async ({ page }) => {
    const imported: any[] = [];
    let posts = 0;
    await mockEngine(page, {
        'GET /alerts': () => ({ list: { alertModel: [
            { id: 'al-1', name: 'Error Alert', enabled: true },
            { id: 'al-2', name: 'Deploy Alert', enabled: false },
            ...imported
        ] } }),
        'POST /alerts': (req: any) => {
            posts++;
            const body = req.postData() || '';
            const value = (tag: string) => body.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1] || '';
            const alert = { id: value('id'), name: value('name'), enabled: true };
            const at = imported.findIndex(item => item.id === alert.id);
            if (at >= 0) imported[at] = alert; else imported.push(alert);
            return '';
        }
    });

    const xml = '<alertModel version="4.5.0"><id>al-imported</id><name>Imported Alert</name><enabled>true</enabled></alertModel>';
    const chooseFile = async () => {
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Import Alert', exact: true }).first().click();
        await (await chooser).setFiles({
            name: 'imported-alert.xml', mimeType: 'application/xml', buffer: Buffer.from(xml)
        });
    };

    await page.goto('/alerts');
    await chooseFile();
    await expect.poll(() => posts).toBe(1);
    await expect(page.getByText('Imported Alert', { exact: true })).toBeVisible();

    await chooseFile();
    // Duplicate-name validation is acknowledged first, then the Swing-style
    // overwrite-or-create-new decision appears. Nothing has been posted yet.
    const warning = page.getByRole('dialog', { name: 'Warning' });
    await expect(warning).toContainText('already exists');
    await warning.getByRole('button', { name: 'OK', exact: true }).click();

    const collision = page.getByRole('dialog', { name: 'Import Alert' });
    await expect(collision).toContainText(/overwrite the existing alert/i);
    expect(posts).toBe(1);
    await collision.getByRole('button', { name: 'Yes', exact: true }).click();
    await expect.poll(() => posts).toBe(2);
});

test('a <list> of alerts — what Export All Alerts writes — imports every alert in it', async ({ page }) => {
    /* POST /alerts takes ONE AlertModel, but Swing's importAlert deserializes a
       LIST, and this view's own Export All writes <list>. Reading back a file
       this client just wrote must not be a dead end. */
    const posted: string[] = [];
    await mockEngine(page, {
        'GET /alerts': { list: '' },
        'POST /alerts': (req: any) => { posted.push(req.postData() || ''); return ''; }
    });

    const xml = `<list version="4.5.0">
        <alertModel><id>al-a</id><name>First Imported</name><enabled>true</enabled></alertModel>
        <alertModel><id>al-b</id><name>Second Imported</name><enabled>true</enabled></alertModel>
    </list>`;

    await page.goto('/alerts');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Alert', exact: true }).first().click();
    await (await chooser).setFiles({ name: 'alerts.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });

    await expect.poll(() => posted.length).toBe(2);
    // Each alert is posted on its own, with an <alertModel> root — not the <list>.
    expect(posted.every(body => body.trimStart().startsWith('<alertModel'))).toBe(true);
    expect(posted.join('')).toContain('First Imported');
    expect(posted.join('')).toContain('Second Imported');
    // The version stamp lives on the <list> root; a child lifted out of it must
    // inherit one, or the engine reads it as pre-3.0.0 and migrates it.
    expect(posted.every(body => body.includes('version="4.5.0"'))).toBe(true);
});

test('a JSON alert list — what GET /alerts answers — imports every alert in it', async ({ page }) => {
    /* The importer accepts .json, and the natural JSON alert document is the
       {"list":{"alertModel":[…]}} wire shape. Treating it as one alert produced
       an empty-name warning and a malformed POST. */
    const posted: string[] = [];
    await mockEngine(page, {
        'GET /alerts': { list: '' },
        'POST /alerts': (req: any) => { posted.push(req.postData() || ''); return ''; }
    });

    const json = JSON.stringify({ list: { alertModel: [
        { '@version': '4.5.0', id: 'al-j1', name: 'Json First', enabled: true },
        { '@version': '4.5.0', id: 'al-j2', name: 'Json Second', enabled: false }
    ] } });

    await page.goto('/alerts');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Alert', exact: true }).first().click();
    await (await chooser).setFiles({ name: 'alerts.json', mimeType: 'application/json', buffer: Buffer.from(json) });

    await expect.poll(() => posted.length).toBe(2);
    expect(posted.join('')).toContain('Json First');
    expect(posted.join('')).toContain('Json Second');
    await expect(page.getByText('Imported 2 alert(s) from alerts.json', { exact: true })).toBeVisible();
});

test('one failing alert does not strand the rest of the file', async ({ page }) => {
    // Swing imports each alert in its own try/catch and keeps going; a mid-list
    // engine rejection must not abort the alerts after it.
    const posted: string[] = [];
    await mockEngine(page, {
        'GET /alerts': { list: '' },
        'POST /alerts': (req: any) => {
            const body = req.postData() || '';
            posted.push(body);
            if (body.includes('Bad Alert')) return { __status: 500, body: { message: 'engine rejected it' } };
            return '';
        }
    });

    const xml = `<list version="4.5.0">
        <alertModel><id>al-x</id><name>Bad Alert</name><enabled>true</enabled></alertModel>
        <alertModel><id>al-y</id><name>Good Alert</name><enabled>true</enabled></alertModel>
    </list>`;

    await page.goto('/alerts');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Alert', exact: true }).first().click();
    await (await chooser).setFiles({ name: 'alerts.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });

    await expect(page.getByText(/Could not import alert "Bad Alert"/)).toBeVisible();
    await expect.poll(() => posted.length).toBe(2);
    await page.locator('.modal-foot').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByText('Imported 1 alert(s) from alerts.xml', { exact: true })).toBeVisible();
});

test('an alert export from a newer engine is blocked before anything posts', async ({ page }) => {
    /* Issue #40's version gate, matching the channel/group imports: a file from
       a newer engine dies engine-side with a raw error, so it is blocked up
       front with the migration message instead. */
    let posts = 0;
    await mockEngine(page, {
        'GET /alerts': { list: '' },
        'POST /alerts': () => { posts++; return ''; }
    });

    const xml = '<alertModel version="9.9.9"><id>al-future</id><name>Future Alert</name><enabled>true</enabled></alertModel>';

    await page.goto('/alerts');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Alert', exact: true }).first().click();
    await (await chooser).setFiles({ name: 'future.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });

    const dialog = page.getByRole('dialog', { name: 'Information' });
    await expect(dialog).toContainText('originated from a newer version');
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    expect(posts).toBe(0);
});

test('the JSON alert path enforces the same version gate as the XML path', async ({ page }) => {
    // A .json extension must not bypass the issue-#40 gate.
    let posts = 0;
    await mockEngine(page, {
        'GET /alerts': { list: '' },
        'POST /alerts': () => { posts++; return ''; }
    });

    const json = JSON.stringify({ alertModel: { '@version': '9.9.9', id: 'al-future-json', name: 'Future Json Alert', enabled: true } });

    await page.goto('/alerts');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Alert', exact: true }).first().click();
    await (await chooser).setFiles({ name: 'future.json', mimeType: 'application/json', buffer: Buffer.from(json) });

    const dialog = page.getByRole('dialog', { name: 'Information' });
    await expect(dialog).toContainText('originated from a newer version');
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    expect(posts).toBe(0);
});

test('an empty alert name goes to rename, never to overwrite', async ({ page }) => {
    /* An invalid name has nothing to overwrite. The old flow offered the
       overwrite dialog anyway, and choosing Yes imported the empty name under
       the file's original id — exactly what the validation just rejected. */
    let posts = 0;
    await mockEngine(page, {
        'GET /alerts': { list: '' },
        'POST /alerts': () => { posts++; return ''; }
    });

    const xml = '<alertModel version="4.5.0"><id>al-unnamed</id><name></name><enabled>true</enabled></alertModel>';

    await page.goto('/alerts');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Alert', exact: true }).first().click();
    await (await chooser).setFiles({ name: 'unnamed.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });

    const warning = page.getByRole('dialog', { name: 'Warning' });
    await expect(warning).toContainText('name cannot be empty');
    await warning.getByRole('button', { name: 'OK', exact: true }).click();

    // Straight to the rename prompt — no overwrite offer.
    const rename = page.getByRole('dialog', { name: 'Import Alert' });
    await expect(rename).toContainText(/enter a new name/i);
    await expect(page.getByText(/overwrite the existing alert/i)).toHaveCount(0);
    await rename.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(posts).toBe(0);
});

test('Export All Alerts aborts when the engine will not hand an alert back', async ({ page }) => {
    await mockEngine(page, {
        'GET /alerts': { list: { alertModel: [
            { id: 'al-1', name: 'Error Alert', enabled: true },
            { id: 'al-2', name: 'Deploy Alert', enabled: false }
        ] } },
        'GET /alerts/al-1': '<alertModel version="4.5.0"><id>al-1</id><name>Error Alert</name></alertModel>',
        'GET /alerts/al-2': ''
    });
    await page.addInitScript(() => { delete (window as any).showSaveFilePicker; });
    let downloads = 0;
    page.on('download', () => { downloads++; });

    await page.goto('/alerts');
    await page.getByRole('button', { name: 'Export All Alerts', exact: true }).click();

    await expect(page.getByText(/Export failed:[\s\S]*incomplete backup/).first()).toBeVisible();
    expect(downloads).toBe(0);
});

test('a malformed action-time alert list cancels the import instead of skipping collisions', async ({ page }) => {
    /* The rendered view knows al-1 exists; the import-time list answers 200 {}.
       Trusting that as "no alerts" skips the collision confirmation and lets
       POST /alerts (create-or-replace by id) silently overwrite al-1. */
    let alertReads = 0;
    let posts = 0;
    await mockEngine(page, {
        'GET /alerts': () => {
            alertReads++;
            return alertReads === 1
                ? { list: { alertModel: [{ id: 'al-1', name: 'Error Alert', enabled: true }] } }
                : {};
        },
        'POST /alerts': () => { posts++; return ''; }
    });

    const xml = '<alertModel version="4.5.0"><id>al-1</id><name>Replacement Alert</name><enabled>true</enabled></alertModel>';

    await page.goto('/alerts');
    await expect(page.getByText('Error Alert')).toBeVisible();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Alert', exact: true }).first().click();
    await (await chooser).setFiles({ name: 'replacement.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });

    await expect(page.getByText(/alert list could not be verified/).first()).toBeVisible();
    expect(posts).toBe(0);
});

test('exporting an alert refuses another alert answering in its place', async ({ page }) => {
    await mockEngine(page, {
        'GET /alerts/al-1': '<alertModel version="4.5.0"><id>al-2</id><name>Deploy Alert</name></alertModel>'
    });
    await page.addInitScript(() => { delete (window as any).showSaveFilePicker; });
    let downloads = 0;
    page.on('download', () => { downloads++; });

    await page.goto('/alerts');
    await page.locator('tr', { hasText: 'Error Alert' }).first().click();
    await page.getByRole('button', { name: 'Export Alert', exact: true }).click();

    await expect(page.getByText(/Export failed:[\s\S]*did not return alert "Error Alert"/).first()).toBeVisible();
    expect(downloads).toBe(0);
});

test('an id-less entry in the action-time alert list cancels the import', async ({ page }) => {
    /* {list:{alertModel:{}}} passes a shape-only check but stands in as an
       alert with no identity — a colliding import would see no collision and
       silently replace the real alert. */
    let alertReads = 0;
    let posts = 0;
    await mockEngine(page, {
        'GET /alerts': () => {
            alertReads++;
            return alertReads === 1
                ? { list: { alertModel: [{ id: 'al-1', name: 'Error Alert', enabled: true }] } }
                : { list: { alertModel: {} } };
        },
        'POST /alerts': () => { posts++; return ''; }
    });

    const xml = '<alertModel version="4.5.0"><id>al-1</id><name>Replacement Alert</name><enabled>true</enabled></alertModel>';

    await page.goto('/alerts');
    await expect(page.getByText('Error Alert')).toBeVisible();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Alert', exact: true }).first().click();
    await (await chooser).setFiles({ name: 'replacement.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });

    await expect(page.getByText(/alert list could not be verified/).first()).toBeVisible();
    expect(posts).toBe(0);
});

test('an alert identity appearing after collision resolution cancels instead of being overwritten', async ({ page }) => {
    let reads = 0;
    let posts = 0;
    const base = [
        { id: 'al-1', name: 'Error Alert', enabled: true },
        { id: 'al-2', name: 'Deploy Alert', enabled: false }
    ];
    await mockEngine(page, {
        'GET /alerts': () => {
            reads++;
            return { list: { alertModel: reads < 3
                ? base
                : [...base, { id: 'al-race', name: 'Raced Alert', enabled: true }] } };
        },
        'POST /alerts': () => { posts++; return ''; }
    });

    await page.goto('/alerts');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Alert', exact: true }).first().click();
    await (await chooser).setFiles({
        name: 'raced.xml', mimeType: 'application/xml',
        buffer: Buffer.from('<alertModel version="4.5.0"><id>al-race</id><name>Raced Alert</name><enabled>true</enabled></alertModel>')
    });

    await expect(page.getByText(/alert list changed while the import was being confirmed/).first()).toBeVisible();
    expect(posts).toBe(0);
});

test('Export All Alerts refreshes the identity list at action time', async ({ page }) => {
    let reads = 0;
    const requested: string[] = [];
    const first = [
        { id: 'al-1', name: 'Error Alert', enabled: true },
        { id: 'al-2', name: 'Deploy Alert', enabled: false }
    ];
    const added = { id: 'al-3', name: 'New Alert', enabled: true };
    await mockEngine(page, {
        'GET /alerts': () => {
            reads++;
            return { list: { alertModel: reads === 1 ? first : [...first, added] } };
        },
        'GET /alerts/al-1': '<alertModel><id>al-1</id><name>Error Alert</name></alertModel>',
        'GET /alerts/al-2': '<alertModel><id>al-2</id><name>Deploy Alert</name></alertModel>',
        'GET /alerts/al-3': () => { requested.push('al-3'); return '<alertModel><id>al-3</id><name>New Alert</name></alertModel>'; }
    });
    await page.addInitScript(() => { delete (window as any).showSaveFilePicker; });

    await page.goto('/alerts');
    await expect(page.getByText('New Alert', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Export All Alerts', exact: true }).click();

    await expect.poll(() => requested).toEqual(['al-3']);
    await expect(page.getByText('Exported 3 alert(s)', { exact: true })).toBeVisible();
});
