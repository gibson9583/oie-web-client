import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

test.beforeEach(async ({ page }) => {
    await mockEngine(page);
});

// Code Templates exercises the imperative library/template tree-table (kept
// mounted) + the React <CodeEditor> island + selection-gated Code Template Tasks.
test('Code Templates lists libraries/templates, gates tasks on selection, and edits dirty the Save button', async ({ page }) => {
    await page.goto('/code-templates');
    await expect(page).toHaveURL(/\/code-templates/);

    // Library + its code template render in the tree-table.
    await expect(page.getByText('Demo Library', { exact: true })).toBeVisible();
    await expect(page.getByText('Trim Whitespace', { exact: true })).toBeVisible();
    await expect(page.getByText('1 Library, 1 Code Template', { exact: true })).toBeVisible();

    // Non-contextual task buttons always present; Save Changes gated on edits.
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New Library', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import Code Templates', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import Libraries', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toHaveCount(0);

    // No selection → contextual buttons hidden.
    await expect(page.getByRole('button', { name: 'New Code Template', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Export Library', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Validate Script', exact: true })).toHaveCount(0);

    // Select the library → library-kind tasks appear (New Code Template, Export
    // Library, Delete Library); template-only tasks stay hidden.
    await page.locator('tr', { hasText: 'Demo Library' }).first().click();
    await expect(page.getByRole('button', { name: 'New Code Template', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export Library', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete Library', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Validate Script', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Export Code Template', exact: true })).toHaveCount(0);

    // Select the template → template-kind tasks appear (Export Code Template,
    // Delete Code Template, Validate Script); the <CodeEditor> island mounts AND
    // fills the pane (a broken flex/height chain collapses it to ~0).
    await page.locator('tr', { hasText: 'Trim Whitespace' }).first().click();
    await expect(page.getByRole('button', { name: 'Export Code Template', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete Code Template', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Validate Script', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export Library', exact: true })).toHaveCount(0);

    await expect(page.locator('.ce').first()).toBeVisible();
    const box = await page.locator('.ce').first().boundingBox();
    expect(box!.height).toBeGreaterThan(150);

    // Editing the code dirties the view → Save Changes appears.
    await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toHaveCount(0);
    // monaco 0.56 uses the EditContext API (no editable textarea to .fill()) —
    // focus the editor and type via the keyboard to dirty the model.
    await page.locator('.ce .monaco-editor').first().click();
    await page.keyboard.type('return msg.trim();');
    await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeVisible();
});

test('deletion stays local until Save Changes includes its tombstone', async ({ page }) => {
    let deleteCalls = 0;
    let bulkBody = '';
    page.on('request', request => {
        const path = new URL(request.url()).pathname;
        if (request.method() === 'DELETE' && path.includes('/api/codeTemplates/')) deleteCalls++;
        if (request.method() === 'POST' && path === '/api/codeTemplateLibraries/_bulkUpdate') {
            bulkBody = request.postData() || '';
        }
    });

    await page.goto('/code-templates');
    await page.locator('tr', { hasText: 'Trim Whitespace' }).first().click();
    await page.getByRole('button', { name: 'Delete Code Template', exact: true }).click();
    await page.getByRole('dialog', { name: 'Delete Code Template' })
        .getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(page.getByText('Trim Whitespace', { exact: true })).toHaveCount(0);
    expect(deleteCalls).toBe(0);
    expect(bulkBody).toBe('');

    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect.poll(() => bulkBody).toContain('tpl-1');
    expect(bulkBody).toContain('removedCodeTemplateIds');
    expect(deleteCalls).toBe(0);
});

test('code-template import detects a concurrent edit before allowing overwrite', async ({ page }) => {
    const overrides: string[] = [];
    await mockEngine(page, {
        'POST /codeTemplateLibraries/_bulkUpdate': (req: any) => {
            const override = new URL(req.url()).searchParams.get('override') || '';
            overrides.push(override);
            return override === 'false'
                ? { overrideNeeded: true, librariesSuccess: false, codeTemplateResults: {} }
                : { overrideNeeded: false, librariesSuccess: true, codeTemplateResults: { entry: [{ string: 'tpl-imported', codeTemplateUpdateResult: { success: true } }] } };
        }
    });

    await page.goto('/code-templates');
    await expect(page.getByText('Demo Library', { exact: true })).toBeVisible();

    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Code Templates', exact: true }).click();
    await (await chooser).setFiles({
        name: 'imported-template.xml',
        mimeType: 'application/xml',
        buffer: Buffer.from(`<codeTemplate version="4.5.0">
          <id>tpl-imported</id><name>Imported Template</name><revision>9</revision>
          <properties class="com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties" version="4.5.0">
            <type>FUNCTION</type><code>function imported() { return true; }</code>
          </properties>
        </codeTemplate>`)
    });

    const conflict = page.getByRole('dialog', { name: 'Code Templates Modified' });
    await expect(conflict).toContainText(/changed while the import was being prepared/i);
    expect(overrides).toEqual(['false']);
    await conflict.getByRole('button', { name: 'Overwrite', exact: true }).click();

    await expect.poll(() => overrides).toEqual(['false', 'true']);
    await expect(page.getByText(/Imported 1 code template/)).toBeVisible();
});

test('library import confirms an atomic replacement and resets source-server revisions', async ({ page }) => {
    let bulkBody = '';
    const overrides: string[] = [];
    await mockEngine(page, {
        'POST /codeTemplateLibraries/_bulkUpdate': (req: any) => {
            overrides.push(new URL(req.url()).searchParams.get('override') || '');
            bulkBody = req.postData() || '';
            return { overrideNeeded: false, librariesSuccess: true, codeTemplateResults: { entry: [{ string: 'tpl-imported', codeTemplateUpdateResult: { success: true } }, { string: 'tpl-1', codeTemplateUpdateResult: { success: true } }] } };
        }
    });

    await page.goto('/code-templates');
    await expect(page.getByText('Demo Library', { exact: true })).toBeVisible();

    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Libraries', exact: true }).click();
    await (await chooser).setFiles({
        name: 'additional-library.xml',
        mimeType: 'application/xml',
        buffer: Buffer.from(`<codeTemplateLibrary version="4.5.0">
          <id>lib-imported</id><name>Additional Library</name><revision>19</revision>
          <codeTemplates><codeTemplate version="4.5.0">
            <id>tpl-imported</id><name>Imported Template</name><revision>23</revision>
            <properties class="com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties" version="4.5.0">
              <type>FUNCTION</type><code>function imported() { return true; }</code>
            </properties>
          </codeTemplate></codeTemplates>
        </codeTemplateLibrary>`)
    });

    const confirmation = page.getByRole('dialog', { name: 'Import Libraries' });
    await expect(confirmation).toContainText(/libraries not present in the file will be removed/i);
    await confirmation.getByRole('button', { name: 'Import', exact: true }).click();

    await expect(page.getByText('Imported additional-library.xml', { exact: true })).toBeVisible();
    expect(overrides).toEqual(['false']);
    expect(bulkBody).toContain('lib-imported');
    expect(bulkBody).toContain('tpl-imported');
    expect(bulkBody).toContain('lib-1');
    expect(bulkBody).not.toContain('"revision":19');
    expect(bulkBody).not.toContain('"revision":23');
    expect((bulkBody.match(/"revision":0/g) || []).length).toBeGreaterThanOrEqual(2);
    // Removing Demo Library (absent from the file) tombstones its template in
    // the SAME transaction — without this, tpl-1 survives as an orphaned row
    // no library references. tpl-1 is not in the file, so the only part that
    // may carry it is removedCodeTemplateIds.
    const removedTemplatesPart = bulkBody.split('name="removedCodeTemplateIds"')[1] || '';
    expect(removedTemplatesPart).toContain('tpl-1');
});

test('an engine-side bulk-save failure reports the engine\'s own message', async ({ page }) => {
    /* _bulkUpdate answers 200 with a CodeTemplateLibrarySaveResult; a failure
       lives in that body, never in the status. The body is XStream's view of
       the Java object, so the fields are `librariesCause` (not `cause`, which is
       what the Swagger-derived schema advertises) holding a Throwable whose text
       is `detailMessage`. Reading the wrong names swallows the diagnosis. */
    await mockEngine(page, {
        'POST /codeTemplateLibraries/_bulkUpdate': {
            overrideNeeded: false,
            librariesSuccess: false,
            librariesCause: { detailMessage: 'Code Template "Shared" belongs to more than one library.' },
            codeTemplateResults: {}
        }
    });

    await page.goto('/code-templates');
    await expect(page.getByText('Trim Whitespace', { exact: true })).toBeVisible();

    // Any edit will do; this one dirties the view the same way the first test does.
    await page.locator('tr', { hasText: 'Trim Whitespace' }).first().click();
    await page.locator('.ce .monaco-editor').first().click();
    await page.keyboard.type('return msg.trim();');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();

    await expect(page.getByText(/belongs to more than one library/)).toBeVisible();
});

test('a surviving library that drops a template tombstones it in the same transaction', async ({ page }) => {
    /* The imported file KEEPS Demo Library but references none of its
       templates. Full replacement means tpl-1 rides removedCodeTemplateIds —
       the engine only removes ids it is explicitly given, so leaving it out
       orphans the row behind a "complete" replacement. */
    let bulkBody = '';
    await mockEngine(page, {
        'POST /codeTemplateLibraries/_bulkUpdate': (req: any) => {
            bulkBody = req.postData() || '';
            return { overrideNeeded: false, librariesSuccess: true, codeTemplateResults: { entry: [{ string: 'tpl-1', codeTemplateUpdateResult: { success: true } }] } };
        }
    });

    await page.goto('/code-templates');
    await expect(page.getByText('Demo Library', { exact: true })).toBeVisible();

    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Libraries', exact: true }).click();
    await (await chooser).setFiles({
        name: 'slimmed-library.xml', mimeType: 'application/xml',
        buffer: Buffer.from(`<codeTemplateLibrary version="4.5.0">
          <id>lib-1</id><name>Demo Library</name><revision>1</revision>
          <codeTemplates/>
        </codeTemplateLibrary>`)
    });
    const confirmation = page.getByRole('dialog', { name: 'Import Libraries' });
    await confirmation.getByRole('button', { name: 'Import', exact: true }).click();

    await expect(page.getByText('Imported slimmed-library.xml', { exact: true })).toBeVisible();
    const removedTemplatesPart = bulkBody.split('name="removedCodeTemplateIds"')[1] || '';
    expect(removedTemplatesPart).toContain('tpl-1');
    // The library itself survives — only its dropped template is removed.
    const removedLibsPart = (bulkBody.split('name="removedLibraryIds"')[1] || '').split('name="')[0];
    expect(removedLibsPart).not.toContain('lib-1');
});

test('an empty bulk-save answer is an unknown outcome, never a success', async ({ page }) => {
    // 200 {} carries no librariesSuccess and no per-object results: reporting
    // "saved" on it hides a possibly partial apply (the engine has no rollback).
    await mockEngine(page, {
        'POST /codeTemplateLibraries/_bulkUpdate': {}
    });

    await page.goto('/code-templates');
    await page.locator('tr', { hasText: 'Trim Whitespace' }).first().click();
    await page.getByRole('button', { name: 'Delete Code Template', exact: true }).click();
    await page.getByRole('dialog', { name: 'Delete Code Template' })
        .getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();

    await expect(page.getByText(/Save failed:.*did not return a usable save result/).first()).toBeVisible();
    await expect(page.getByText(/Code templates saved/)).toHaveCount(0);
});

test('importing a template whose id already exists forces an explicit decision', async ({ page }) => {
    /* tpl-1 already exists ("Trim Whitespace"). A silent overwrite swaps the
       code under every channel using it; a silent duplicate ref corrupts the
       library. Overwrite must be chosen, and the library must reference the id
       exactly once. */
    let bulkBody = '';
    await mockEngine(page, {
        'POST /codeTemplateLibraries/_bulkUpdate': (req: any) => {
            bulkBody = req.postData() || '';
            return { overrideNeeded: false, librariesSuccess: true,
                codeTemplateResults: { entry: [{ string: 'tpl-1', codeTemplateUpdateResult: { success: true } }] } };
        }
    });

    await page.goto('/code-templates');
    await expect(page.getByText('Demo Library', { exact: true })).toBeVisible();

    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Code Templates', exact: true }).click();
    await (await chooser).setFiles({
        name: 'colliding-template.xml', mimeType: 'application/xml',
        buffer: Buffer.from(`<codeTemplate version="4.5.0">
          <id>tpl-1</id><name>Trim Whitespace</name><revision>9</revision>
          <properties class="com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties" version="4.5.0">
            <type>FUNCTION</type><code>function trimHarder(s) { return String(s).trim(); }</code>
          </properties>
        </codeTemplate>`)
    });

    const collision = page.getByRole('dialog', { name: 'Import Code Templates' });
    await expect(collision).toContainText(/already exist/);
    await collision.getByRole('button', { name: 'Overwrite', exact: true }).click();

    await expect.poll(() => bulkBody).toContain('tpl-1');
    // The libraries part references the overwritten id exactly ONCE.
    const librariesPart = bulkBody.split('name="updatedCodeTemplates"')[0];
    expect((librariesPart.match(/tpl-1/g) || []).length).toBe(1);
});

test('librariesSuccess null is an unknown outcome, never a success', async ({ page }) => {
    // Only an explicit true counts: null slipped past a not-undefined check and
    // toasted "saved" over a possibly partial, non-transactional apply.
    await mockEngine(page, {
        'POST /codeTemplateLibraries/_bulkUpdate': { overrideNeeded: false, librariesSuccess: null, codeTemplateResults: {} }
    });

    await page.goto('/code-templates');
    await page.locator('tr', { hasText: 'Trim Whitespace' }).first().click();
    await page.getByRole('button', { name: 'Delete Code Template', exact: true }).click();
    await page.getByRole('dialog', { name: 'Delete Code Template' })
        .getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();

    await expect(page.getByText(/Save failed:.*outcome is unknown/).first()).toBeVisible();
    await expect(page.getByText(/Code templates saved/)).toHaveCount(0);
});
