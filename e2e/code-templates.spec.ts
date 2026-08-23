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
                : { overrideNeeded: false, librariesSuccess: true, codeTemplateResults: {} };
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
            return { overrideNeeded: false, librariesSuccess: true, codeTemplateResults: {} };
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
});
