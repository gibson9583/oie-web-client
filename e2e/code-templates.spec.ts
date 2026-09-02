import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

test.beforeEach(async ({ page }) => {
    await mockEngine(page, {
        'POST /codeTemplateLibraries/_bulkUpdate': {
            codeTemplateLibrarySaveResult: { overrideNeeded: false, librariesSuccess: true, codeTemplateResults: {} }
        }
    });
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

    let legacyPut = false;
    page.on('request', request => {
        const path = new URL(request.url()).pathname;
        if (request.method() === 'PUT' && (path === '/api/codeTemplateLibraries' || path.startsWith('/api/codeTemplates/'))) legacyPut = true;
    });
    const bulkRequest = page.waitForRequest(request =>
        request.method() === 'POST' && new URL(request.url()).pathname === '/api/codeTemplateLibraries/_bulkUpdate');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    const request = await bulkRequest;
    expect(request.postData() || '').toContain('name="updatedCodeTemplates"');
    await expect(page.getByText('Code templates saved', { exact: true })).toBeVisible();
    expect(legacyPut).toBe(false);
});

test('template import preserves primitive-looking names and scripts as strings', async ({ page }) => {
    await page.goto('/code-templates');
    await expect(page.getByText('Demo Library', { exact: true })).toBeVisible();

    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Code Templates', exact: true }).first().click();
    const bulkRequest = page.waitForRequest(request =>
        request.method() === 'POST' && new URL(request.url()).pathname === '/api/codeTemplateLibraries/_bulkUpdate');
    await (await chooser).setFiles({
        name: 'primitive-looking-template.xml',
        mimeType: 'application/xml',
        buffer: Buffer.from('<codeTemplate version="4.5.0"><id>numeric-script</id><name>true</name><revision>0</revision><properties class="com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties" version="4.5.0"><type>FUNCTION</type><code>123</code></properties></codeTemplate>')
    });

    const body = (await bulkRequest).postData() || '';
    expect(body).toContain('"name":"true"');
    expect(body).toContain('"code":"123"');
    expect(body).toContain('"revision":0');
});

test('bulk save detects a concurrent revision and retries only after confirmation', async ({ page }) => {
    const overrides: string[] = [];
    await mockEngine(page, {
        'POST /codeTemplateLibraries/_bulkUpdate': (request: any) => {
            const override = new URL(request.url()).searchParams.get('override') || '';
            overrides.push(override);
            return override === 'false'
                ? { codeTemplateLibrarySaveResult: { overrideNeeded: true } }
                : { codeTemplateLibrarySaveResult: { overrideNeeded: false, librariesSuccess: true, codeTemplateResults: {} } };
        }
    });
    await page.goto('/code-templates');
    await page.getByText('Trim Whitespace', { exact: true }).click();
    await page.locator('.ce .monaco-editor').first().click();
    await page.keyboard.type('// concurrent save test');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Code Templates Modified' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Overwrite', exact: true }).click();
    await expect(page.getByText('Code templates saved', { exact: true })).toBeVisible();
    expect(overrides).toEqual(['false', 'true']);
});

test('partial bulk saves reconcile successful revisions and keep failed edits retryable', async ({ page }) => {
    const bodies: string[] = [];
    await mockEngine(page, {
        'POST /codeTemplateLibraries/_bulkUpdate': (request: any) => {
            bodies.push(request.postData() || '');
            return bodies.length === 1
                ? { codeTemplateLibrarySaveResult: {
                    overrideNeeded: false,
                    librariesSuccess: true,
                    libraryResults: { 'lib-1': { newRevision: 2, newLastModified: { time: 1700000200000 } } },
                    codeTemplateResults: {
                        'tpl-1': { success: false, cause: { detailMessage: 'template update rejected' } }
                    }
                } }
                : { codeTemplateLibrarySaveResult: {
                    overrideNeeded: false,
                    librariesSuccess: true,
                    libraryResults: { 'lib-1': { newRevision: 3, newLastModified: { time: 1700000300000 } } },
                    codeTemplateResults: {
                        'tpl-1': { success: true, newRevision: 2, newLastModified: { time: 1700000300000 } }
                    }
                } };
        }
    });
    await page.goto('/code-templates');
    await page.getByText('Trim Whitespace', { exact: true }).click();
    await page.locator('.ce .monaco-editor').first().click();
    await page.keyboard.type('// retry this edit');

    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    const errorDialog = page.getByRole('dialog', { name: 'Error' });
    await expect(errorDialog).toContainText('template update rejected');
    await errorDialog.getByRole('button', { name: 'Close' }).last().click();

    // The failed edit remains dirty, while the successful library revision from
    // the first response is used by the retry (avoiding a false conflict).
    await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect(page.getByText('Code templates saved', { exact: true })).toBeVisible();

    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toContain('"revision":2');
    expect(bodies[1]).toContain('retry this edit');
});

test('library-only edits do not resave unchanged code templates', async ({ page }) => {
    await page.goto('/code-templates');
    await page.getByText('Demo Library', { exact: true }).click();
    await page.locator('textarea').fill('Changed library description');

    const bulkRequest = page.waitForRequest(request =>
        request.method() === 'POST' && new URL(request.url()).pathname === '/api/codeTemplateLibraries/_bulkUpdate');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    const body = (await bulkRequest).postData() || '';
    const updatedStart = body.indexOf('name="updatedCodeTemplates"');
    const removedStart = body.indexOf('name="removedLibraryIds"');

    expect(updatedStart).toBeGreaterThanOrEqual(0);
    expect(removedStart).toBeGreaterThan(updatedStart);
    expect(body.slice(updatedStart, removedStart)).toContain('{"list":{"codeTemplate":[]}}');
    await expect(page.getByText('Code templates saved', { exact: true })).toBeVisible();
});

test('deleting a persisted template is submitted in the same bulk request', async ({ page }) => {
    await page.goto('/code-templates');
    await page.getByText('Trim Whitespace', { exact: true }).click();
    await page.getByRole('button', { name: 'Delete Code Template', exact: true }).click();
    await page.getByRole('dialog', { name: 'Delete Code Template' })
        .getByRole('button', { name: 'Delete', exact: true }).click();

    const bulkRequest = page.waitForRequest(request =>
        request.method() === 'POST' && new URL(request.url()).pathname === '/api/codeTemplateLibraries/_bulkUpdate');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    const body = (await bulkRequest).postData() || '';
    const removedStart = body.indexOf('name="removedCodeTemplateIds"');

    expect(removedStart).toBeGreaterThanOrEqual(0);
    expect(body.slice(removedStart)).toContain('{"set":{"string":["tpl-1"]}}');
    await expect(page.getByText('Code templates saved', { exact: true })).toBeVisible();
});
