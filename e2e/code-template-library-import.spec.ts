import type { Page, Request } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

type Model = Record<string, any>;
type BulkParts = {
    libraries: { list: { codeTemplateLibrary: Model[] } };
    updatedCodeTemplates: { list: { codeTemplate: Model[] } };
    removedLibraryIds: { set: { string: string[] } };
    removedCodeTemplateIds: { set: { string: string[] } };
};
type Write = { override: string | null; parts: BulkParts };

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const list = <T>(value: T | T[] | undefined | null): T[] => value == null ? [] : Array.isArray(value) ? value : [value];
const members = (library: Model): Model[] => list(library.codeTemplates?.codeTemplate);
const memberIds = (library: Model) => members(library).map(template => template.id).sort();
const channelIds = (value: any): string[] => list<string>(value?.string).sort();

function template(id: string, name: string, code = `function ${id.replace(/-/g, '_')}() { return 'original'; }`): Model {
    return {
        '@version': '4.6.0', id, name, revision: 3,
        contextSet: { delegate: { contextType: ['SOURCE_FILTER_TRANSFORMER'] } },
        properties: {
            '@class': 'com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties',
            '@version': '4.6.0', type: 'FUNCTION', code
        }
    };
}

function library(id: string, name: string, templates: Model[] = []): Model {
    return {
        '@version': '4.6.0', id, name, revision: 4, description: `${name} description`,
        includeNewChannels: false, enabledChannelIds: '', disabledChannelIds: '',
        codeTemplates: { codeTemplate: templates }
    };
}

const alpha = () => library('lib-a', 'Alpha Library', [template('tpl-a', 'Alpha Function')]);
const beta = () => library('lib-b', 'Beta Library', [template('tpl-b', 'Beta Function')]);
const gamma = () => library('lib-c', 'Gamma Library', [template('tpl-c', 'Gamma Function')]);

function escapeXml(value: unknown): string {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function xmlElement(tag: string, value: any): string {
    if (Array.isArray(value)) return value.map(item => xmlElement(tag, item)).join('');
    if (value == null) return `<${tag}/>`;
    if (typeof value !== 'object') return `<${tag}>${escapeXml(value)}</${tag}>`;
    const attributes = Object.entries(value).filter(([key]) => key.startsWith('@'))
        .map(([key, child]) => ` ${key.slice(1)}="${escapeXml(child)}"`).join('');
    const content = Object.entries(value).filter(([key]) => !key.startsWith('@'))
        .map(([key, child]) => xmlElement(key, child)).join('');
    return `<${tag}${attributes}>${content}</${tag}>`;
}

function libraryXml(libraries: Model[]): string {
    return `<list>${libraries.map(value => xmlElement('codeTemplateLibrary', value)).join('')}</list>`;
}

function assertAttributesFirst(value: any): void {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach(assertAttributesFirst);
    let hasContent = false;
    for (const [key, child] of Object.entries(value)) {
        if (key.startsWith('@')) expect(hasContent, `${key} must precede XML element content`).toBe(false);
        else hasContent = true;
        assertAttributesFirst(child);
    }
}

async function parseBulk(page: Page, request: Request): Promise<Write> {
    // WebKit does not expose Blob contents in Playwright's postData(). Read
    // the exact JSON strings observed in this request's original FormData.
    const captured = await page.evaluate(key => {
        const pending = (window as any).__libraryImportForms as Record<string, [string, string][][]>;
        return pending[key]?.shift() ?? null;
    }, `${request.method()} ${request.url()}`);
    expect(captured, 'the outgoing bulk FormData was captured before fetch').not.toBeNull();
    expect(request.headers()['content-type']).toMatch(/^multipart\/form-data;\s*boundary=/);
    const parts: Record<string, any> = {};
    for (const [name, json] of captured!) {
        expect(parts[name], `duplicate multipart field ${name}`).toBeUndefined();
        parts[name] = JSON.parse(json);
        assertAttributesFirst(parts[name]);
    }
    expect(Object.keys(parts)).toEqual(['libraries', 'updatedCodeTemplates', 'removedLibraryIds', 'removedCodeTemplateIds']);
    return { override: new URL(request.url()).searchParams.get('override'), parts: parts as BulkParts };
}

function assertAdditiveWrite(write: Write): void {
    expect(write.override).toBe('false');
    expect(write.parts.removedLibraryIds).toEqual({ set: { string: [] } });
    expect(write.parts.removedCodeTemplateIds).toEqual({ set: { string: [] } });
    for (const value of write.parts.libraries.list.codeTemplateLibrary) expect(value['@version']).toBe('4.6.0');
    for (const value of write.parts.updatedCodeTemplates.list.codeTemplate) {
        expect(value['@version']).toBe('4.6.0');
        expect(value.properties['@version']).toBe('4.6.0');
        expect(value.properties['@class']).toBe('com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties');
    }
}

/** Model the engine's whole-list replacement, so a missing library is truly lost
 * in the mock and cannot be hidden by a static successful GET fixture. */
async function installEngine(page: Page, initial: Model[]) {
    await page.addInitScript(() => {
        const send = window.fetch;
        const pending: Record<string, [string, string][][]> = {};
        (window as any).__libraryImportForms = pending;
        window.fetch = async (...args: Parameters<typeof fetch>) => {
            const [input, init] = args;
            const url = new URL(input instanceof globalThis.Request ? input.url : String(input), location.href);
            const method = (init?.method || (input instanceof globalThis.Request ? input.method : 'GET')).toUpperCase();
            if (method === 'POST' && url.pathname === '/api/codeTemplateLibraries/_bulkUpdate'
                && init?.body instanceof FormData) {
                const fields = await Promise.all(Array.from(init.body.entries()).map(async ([name, value]): Promise<[string, string]> =>
                    [name, typeof value === 'string' ? value : await value.text()]));
                const key = `${method} ${url.href}`;
                (pending[key] ||= []).push(fields);
            }
            return send(...args);
        };
    });
    const state = {
        libraries: clone(initial), writes: [] as Write[], reads: 0,
        failReads: false, result: undefined as Model | ((write: Write) => Model) | undefined
    };
    const storedTemplates = new Map(initial.flatMap(members).map(value => [value.id, clone(value)]));
    await mockEngine(page, {
        'GET /server/version': '4.6.0',
        'GET /codeTemplateLibraries': () => {
            state.reads++;
            if (state.failReads) return { __status: 503, body: { message: 'Library read unavailable' } };
            // Tests can model a concurrent administrator adding complete
            // libraries between the rendered snapshot and the import read.
            for (const value of state.libraries.flatMap(members)) {
                if (value.properties) storedTemplates.set(value.id, clone(value));
            }
            return { list: { codeTemplateLibrary: clone(state.libraries) } };
        },
        'POST /codeTemplateLibraries/_bulkUpdate': async (request: Request) => {
            const write = await parseBulk(page, request);
            state.writes.push(write);
            const result = typeof state.result === 'function' ? state.result(write)
                : state.result ?? { overrideNeeded: false, librariesSuccess: true, codeTemplateResults: {} };
            if (result.overrideNeeded || result.librariesSuccess === false) {
                return { codeTemplateLibrarySaveResult: clone(result) };
            }
            for (const updated of write.parts.updatedCodeTemplates.list.codeTemplate) {
                if (result.codeTemplateResults?.[updated.id]?.success !== false) {
                    storedTemplates.set(updated.id, clone(updated));
                }
            }
            for (const id of write.parts.removedCodeTemplateIds.set.string) storedTemplates.delete(id);
            // This deliberately does not merge the request with existing libraries:
            // the production engine drops every omitted library.
            state.libraries = write.parts.libraries.list.codeTemplateLibrary.map(value => ({
                ...clone(value),
                // The engine's full-template GET omits references whose template
                // failed to save; it does not return a visible skeleton entry.
                codeTemplates: { codeTemplate: members(value).filter(ref => storedTemplates.has(ref.id))
                    .map(ref => clone(storedTemplates.get(ref.id)!)) }
            }));
            return { codeTemplateLibrarySaveResult: clone(result) };
        }
    });
    return state;
}

async function openLibraries(page: Page): Promise<void> {
    await page.goto('/code-templates');
    await expect(page.getByText('Alpha Library', { exact: true })).toBeVisible();
}

async function selectImportFile(page: Page, content: string, name = 'libraries.xml'): Promise<void> {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Libraries', exact: true }).click();
    await (await chooser).setFiles({ name, mimeType: 'application/xml', buffer: Buffer.from(content) });
}

async function chooseImport(page: Page, content: string, name = 'libraries.xml'): Promise<void> {
    await selectImportFile(page, content, name);
    await expect(page.getByRole('dialog', { name: 'Import Libraries', exact: true })).toBeVisible();
}

async function confirmImport(page: Page): Promise<void> {
    await page.getByRole('dialog', { name: 'Import Libraries', exact: true })
        .getByRole('button', { name: 'Import', exact: true }).click();
}

async function startImport(page: Page, imported: Model[]): Promise<void> {
    await chooseImport(page, libraryXml(imported));
    await confirmImport(page);
}

async function chooseConflict(page: Page, kind: 'Library' | 'Code Template',
    choice: 'Cancel' | 'Import as Copy' | 'Overwrite' | 'Keep Existing' | 'Skip Library') {
    await page.getByRole('dialog', { name: `Import ${kind} Conflict`, exact: true })
        .getByRole('button', { name: choice, exact: true }).click();
}

async function closeError(page: Page): Promise<void> {
    await page.getByRole('dialog', { name: 'Error', exact: true })
        .getByRole('button', { name: 'Close', exact: true }).last().click();
}

async function adoptReplacementSession(page: Page): Promise<void> {
    await page.evaluate(async () => {
        document.cookie = 'oie-login=replacement-library-import-session; path=/';
        const engine = await import(String('/core/engine-fetch.js'));
        engine.adoptEngineContext();
    });
}

test('loading two code template libraries displays each library and template', async ({ page }) => {
    const state = await installEngine(page, [alpha(), beta()]);
    await openLibraries(page);
    await expect(page.getByText('Beta Library', { exact: true })).toBeVisible();
    await expect(page.getByText('Alpha Function', { exact: true })).toBeVisible();
    await expect(page.getByText('Beta Function', { exact: true })).toBeVisible();
    await expect(page.getByText('2 Libraries, 2 Code Templates', { exact: true })).toBeVisible();
    expect(state.writes).toHaveLength(0);
});

for (const existingCount of [1, 2]) {
    test(`import adds a library alongside ${existingCount} existing libraries and preserves their templates`, async ({ page }) => {
        const initial = existingCount === 1 ? [alpha()] : [alpha(), gamma()];
        const state = await installEngine(page, initial);
        await openLibraries(page);
        await startImport(page, [beta()]);
        await expect(page.getByText('Beta Function', { exact: true })).toBeVisible();
        await expect(page.getByText('Alpha Function', { exact: true })).toBeVisible();
        if (existingCount === 2) await expect(page.getByText('Gamma Function', { exact: true })).toBeVisible();
        expect(state.writes).toHaveLength(1);
        assertAdditiveWrite(state.writes[0]);
        expect(state.libraries.map(value => value.id).sort()).toEqual(initial.concat(beta()).map(value => value.id).sort());
        for (const original of initial) {
            expect(state.libraries.find(value => value.id === original.id)).toEqual(original);
        }
        expect(state.writes[0].parts.updatedCodeTemplates.list.codeTemplate.map(value => value.id)).toEqual(['tpl-b']);
    });
}

test('importing multiple libraries into an existing collection keeps every library', async ({ page }) => {
    const state = await installEngine(page, [alpha()]);
    await openLibraries(page);
    await startImport(page, [beta(), gamma()]);
    await expect(page.getByText('3 Libraries, 3 Code Templates', { exact: true })).toBeVisible();
    expect(state.libraries.map(value => value.id).sort()).toEqual(['lib-a', 'lib-b', 'lib-c']);
    assertAdditiveWrite(state.writes[0]);
});

test('overwriting a library merges members and channel associations with enabled taking precedence', async ({ page }) => {
    const existing = alpha();
    existing.enabledChannelIds = { string: ['existing-enabled', 'existing-wins'] };
    existing.disabledChannelIds = { string: ['existing-disabled', 'import-wins'] };
    const imported = library('lib-a', 'Alpha Library', [template('tpl-new', 'New Function')]);
    imported.description = 'Imported description';
    imported.includeNewChannels = true;
    imported.enabledChannelIds = { string: ['import-enabled', 'import-wins'] };
    imported.disabledChannelIds = { string: ['import-disabled', 'existing-wins'] };
    const state = await installEngine(page, [existing, beta()]);
    await openLibraries(page);
    await startImport(page, [imported]);
    await chooseConflict(page, 'Library', 'Overwrite');
    await expect(page.getByText('New Function', { exact: true })).toBeVisible();
    await expect(page.getByText('Alpha Function', { exact: true })).toBeVisible();
    await expect(page.getByText('Beta Function', { exact: true })).toBeVisible();
    expect(state.writes).toHaveLength(1);
    assertAdditiveWrite(state.writes[0]);
    const merged = state.libraries.find(value => value.id === 'lib-a')!;
    expect(memberIds(merged)).toEqual(['tpl-a', 'tpl-new']);
    expect(channelIds(merged.enabledChannelIds)).toEqual(['existing-enabled', 'existing-wins', 'import-enabled', 'import-wins']);
    expect(channelIds(merged.disabledChannelIds)).toEqual(['existing-disabled', 'import-disabled']);
    expect(merged.includeNewChannels).toBe(true);
    expect(merged.description).toBe('Imported description');
    expect(state.writes[0].parts.updatedCodeTemplates.list.codeTemplate.map(value => value.id)).toEqual(['tpl-new']);
});

test('cancelling a library conflict sends no update and preserves the collection', async ({ page }) => {
    const state = await installEngine(page, [alpha(), beta()]);
    await openLibraries(page);
    await startImport(page, [alpha()]);
    await chooseConflict(page, 'Library', 'Cancel');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(state.writes).toHaveLength(0);
    expect(state.libraries).toEqual([alpha(), beta()]);
});

test('same library name with a different ID requires a new name and keeps the existing library', async ({ page }) => {
    const imported = beta();
    imported.name = 'ALPHA LIBRARY';
    const state = await installEngine(page, [alpha()]);
    await openLibraries(page);
    await startImport(page, [imported]);
    const dialog = page.getByRole('dialog', { name: 'Import Library Name', exact: true });
    await expect(dialog).toBeVisible();
    expect(state.writes).toHaveLength(0);
    await dialog.getByRole('textbox').fill('Imported Alpha Library');
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(page.getByText('Imported Alpha Library', { exact: true })).toBeVisible();
    await expect(page.getByText('Alpha Function', { exact: true })).toBeVisible();
    assertAdditiveWrite(state.writes[0]);
    expect(state.libraries.find(value => value.id === 'lib-a')).toEqual(alpha());
    expect(state.libraries.find(value => value.id === 'lib-b')?.name).toBe('Imported Alpha Library');
});

test('same-owner template replacement requires explicit overwrite and keeps unrelated members', async ({ page }) => {
    const existing = alpha();
    members(existing).push(template('tpl-keep', 'Preserved Function'));
    const imported = library('lib-a', 'Alpha Library', [template('tpl-a', 'Alpha Function', 'return "replacement";')]);
    const state = await installEngine(page, [existing, beta()]);
    await openLibraries(page);
    await startImport(page, [imported]);
    await chooseConflict(page, 'Library', 'Overwrite');
    await expect(page.getByRole('dialog', { name: 'Import Code Template Conflict', exact: true })).toBeVisible();
    expect(state.writes).toHaveLength(0);
    await chooseConflict(page, 'Code Template', 'Overwrite');
    await expect(page.getByText('Imported libraries.xml', { exact: true })).toBeVisible();
    assertAdditiveWrite(state.writes[0]);
    const merged = state.libraries.find(value => value.id === 'lib-a')!;
    expect(memberIds(merged)).toEqual(['tpl-a', 'tpl-keep']);
    expect(members(merged).find(value => value.id === 'tpl-a')?.properties.code).toBe('return "replacement";');
    expect(state.libraries.find(value => value.id === 'lib-b')).toEqual(beta());
});

test('a template ID owned by another library is copied without changing or moving the original', async ({ page }) => {
    const imported = library('lib-b', 'Beta Library', [template('tpl-a', 'Imported Alpha Function', 'return "copied";')]);
    const state = await installEngine(page, [alpha()]);
    await openLibraries(page);
    await startImport(page, [imported]);
    await expect(page.getByText('Imported Alpha Function', { exact: true })).toBeVisible();
    assertAdditiveWrite(state.writes[0]);
    expect(state.libraries.find(value => value.id === 'lib-a')).toEqual(alpha());
    const copy = members(state.libraries.find(value => value.id === 'lib-b')!)[0];
    expect(copy.id).not.toBe('tpl-a');
    expect(copy.id).toBeTruthy();
    expect(copy.properties.code).toBe('return "copied";');
    expect(state.writes[0].parts.updatedCodeTemplates.list.codeTemplate.map(value => value.id)).toEqual([copy.id]);
});

test('import reads current libraries after confirmation and preserves a library added since page load', async ({ page }) => {
    const state = await installEngine(page, [alpha()]);
    await openLibraries(page);
    await chooseImport(page, libraryXml([beta()]));
    // Another administrator adds a library after this page loaded and while
    // the import confirmation is open.
    state.libraries.push(gamma());
    const previousReads = state.reads;
    await confirmImport(page);
    await expect(page.getByText('Beta Function', { exact: true })).toBeVisible();
    await expect(page.getByText('Gamma Function', { exact: true })).toBeVisible();
    expect(state.reads).toBeGreaterThan(previousReads);
    expect(state.writes[0].parts.libraries.list.codeTemplateLibrary.map(value => value.id).sort())
        .toEqual(['lib-a', 'lib-b', 'lib-c']);
    assertAdditiveWrite(state.writes[0]);
});

test('failure to fetch current libraries aborts import before any update', async ({ page }) => {
    const state = await installEngine(page, [alpha()]);
    await openLibraries(page);
    state.failReads = true;
    await startImport(page, [beta()]);
    await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toBeVisible();
    expect(state.writes).toHaveLength(0);
    expect(state.libraries).toEqual([alpha()]);
});

test('a concurrent change refuses import without an override retry', async ({ page }) => {
    const state = await installEngine(page, [alpha()]);
    state.result = { overrideNeeded: true };
    await openLibraries(page);
    await startImport(page, [beta()]);
    const dialog = page.getByRole('dialog', { name: 'Error', exact: true });
    await expect(dialog).toContainText(/changed during import/i);
    await closeError(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(state.writes).toHaveLength(1);
    assertAdditiveWrite(state.writes[0]);
    expect(state.libraries).toEqual([alpha()]);
});

test('malformed library XML fails before any update', async ({ page }) => {
    const state = await installEngine(page, [alpha()]);
    await openLibraries(page);
    await selectImportFile(page, '<list><codeTemplateLibrary></list>');
    await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toBeVisible();
    expect(state.writes).toHaveLength(0);
    expect(state.libraries).toEqual([alpha()]);
});

test('repeated explicit overwrite preserves the same library and member IDs without duplicates', async ({ page }) => {
    const state = await installEngine(page, [alpha()]);
    await openLibraries(page);
    await startImport(page, [beta()]);
    await expect(page.getByText('Beta Function', { exact: true })).toBeVisible();
    await startImport(page, [beta()]);
    await chooseConflict(page, 'Library', 'Overwrite');
    await chooseConflict(page, 'Code Template', 'Overwrite');
    await expect.poll(() => state.writes.length).toBe(2);
    await expect(page.getByText('2 Libraries, 2 Code Templates', { exact: true })).toBeVisible();
    state.writes.forEach(assertAdditiveWrite);
    expect(state.libraries.map(value => value.id).sort()).toEqual(['lib-a', 'lib-b']);
    expect(memberIds(state.libraries.find(value => value.id === 'lib-b')!)).toEqual(['tpl-b']);
    expect(state.libraries.find(value => value.id === 'lib-a')).toEqual(alpha());
});

test('cancelling the import confirmation leaves the server unchanged', async ({ page }) => {
    const state = await installEngine(page, [alpha()]);
    await openLibraries(page);
    await chooseImport(page, libraryXml([beta()]));
    await page.getByRole('dialog', { name: 'Import Libraries', exact: true })
        .getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(state.writes).toHaveLength(0);
    expect(state.libraries).toEqual([alpha()]);
});

test('a failed library update is reported and does not claim import success', async ({ page }) => {
    const state = await installEngine(page, [alpha()]);
    state.result = { overrideNeeded: false, librariesSuccess: false, librariesCause: { detailMessage: 'Library write rejected' } };
    await openLibraries(page);
    await startImport(page, [beta()]);
    await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toContainText('Library write rejected');
    await closeError(page);
    await expect(page.getByText('Imported libraries.xml', { exact: true })).toHaveCount(0);
    expect(state.writes).toHaveLength(1);
    assertAdditiveWrite(state.writes[0]);
    expect(state.libraries).toEqual([alpha()]);
});

test('a partial template failure is reported and the saved library collection is refreshed', async ({ page }) => {
    const state = await installEngine(page, [alpha()]);
    state.result = {
        overrideNeeded: false, librariesSuccess: true,
        codeTemplateResults: { 'tpl-b': { success: false, cause: { detailMessage: 'Template write rejected' } } }
    };
    await openLibraries(page);
    await startImport(page, [beta()]);
    await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toContainText('Template write rejected');
    await closeError(page);
    await expect(page.getByText('Beta Library', { exact: true })).toBeVisible();
    await expect(page.getByText('Alpha Function', { exact: true })).toBeVisible();
    await expect(page.getByText('Imported libraries.xml', { exact: true })).toHaveCount(0);
    expect(state.writes).toHaveLength(1);
    assertAdditiveWrite(state.writes[0]);
    expect(memberIds(state.libraries.find(value => value.id === 'lib-b')!)).toEqual([]);
    await expect(page.getByText('2 Libraries, 1 Code Template', { exact: true })).toBeVisible();
});

test('retrying a partially saved library copy reuses its generated library and template IDs', async ({ page }) => {
    const imported = library('lib-a', 'Alpha Library', [template('tpl-a', 'Alpha Function', 'return "copied after retry";')]);
    const state = await installEngine(page, [alpha()]);
    state.result = (write: Write) => ({
        overrideNeeded: false, librariesSuccess: true,
        codeTemplateResults: Object.fromEntries(write.parts.updatedCodeTemplates.list.codeTemplate.map(value =>
            [value.id, { success: false, cause: { detailMessage: 'Copied template write rejected' } }]))
    });
    await openLibraries(page);
    await startImport(page, [imported]);
    await chooseConflict(page, 'Library', 'Import as Copy');
    const nameDialog = page.getByRole('dialog', { name: 'Import Library Name', exact: true });
    await nameDialog.getByRole('textbox').fill('Alpha Library Copy');
    await nameDialog.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toContainText('Copied template write rejected');
    await closeError(page);
    await expect(page.getByText('Alpha Library Copy', { exact: true })).toBeVisible();
    await expect(page.getByText('2 Libraries, 1 Code Template', { exact: true })).toBeVisible();
    expect(state.writes).toHaveLength(1);
    const copiedLibrary = state.writes[0].parts.libraries.list.codeTemplateLibrary.find(value => value.id !== 'lib-a')!;
    const copiedTemplate = state.writes[0].parts.updatedCodeTemplates.list.codeTemplate[0];
    expect(copiedLibrary.id).not.toBe('lib-a');
    expect(copiedTemplate.id).not.toBe('tpl-a');
    expect(memberIds(copiedLibrary)).toEqual([copiedTemplate.id]);
    expect(memberIds(state.libraries.find(value => value.id === copiedLibrary.id)!)).toEqual([]);

    state.result = undefined;
    await startImport(page, [imported]);
    await chooseConflict(page, 'Library', 'Import as Copy');
    // The generated library survived the first request. Reusing its ID must
    // require a new decision before changing that now-persisted library.
    const persistedConflict = page.getByRole('dialog', { name: 'Import Library Conflict', exact: true });
    await expect(persistedConflict).toContainText('Alpha Library Copy');
    expect(state.writes).toHaveLength(1);
    await chooseConflict(page, 'Library', 'Overwrite');
    await nameDialog.getByRole('textbox').fill('Alpha Library Copy');
    await nameDialog.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(page.getByText('2 Libraries, 2 Code Templates', { exact: true })).toBeVisible();
    expect(state.writes).toHaveLength(2);
    state.writes.forEach(assertAdditiveWrite);
    expect(state.libraries.map(value => value.id).sort()).toEqual(['lib-a', copiedLibrary.id].sort());
    expect(state.libraries.find(value => value.id === 'lib-a')).toEqual(alpha());
    expect(memberIds(state.libraries.find(value => value.id === copiedLibrary.id)!)).toEqual([copiedTemplate.id]);
    expect(state.writes[1].parts.updatedCodeTemplates.list.codeTemplate.map(value => value.id)).toEqual([copiedTemplate.id]);
    expect(members(state.libraries.find(value => value.id === copiedLibrary.id)!)[0].properties.code)
        .toBe('return "copied after retry";');
});

test('an import holds the editor lock and prevents a duplicate picker or write', async ({ page }) => {
    const state = await installEngine(page, [alpha()]);
    await openLibraries(page);
    let pickerCount = 0;
    page.on('filechooser', () => { pickerCount++; });
    await chooseImport(page, libraryXml([beta()]));
    await expect(page.locator('.content-row')).toHaveAttribute('inert', '');
    await page.getByRole('button', { name: 'Import Libraries', exact: true, includeHidden: true })
        .evaluate(button => (button as HTMLButtonElement).click());
    await expect(page.getByRole('dialog', { name: 'Import Libraries', exact: true })).toHaveCount(1);
    await confirmImport(page);
    await expect(page.getByText('Beta Function', { exact: true })).toBeVisible();
    await expect(page.locator('.content-row')).not.toHaveAttribute('inert');
    expect(pickerCount).toBe(1);
    expect(state.writes).toHaveLength(1);
    assertAdditiveWrite(state.writes[0]);
});

test('cancelling an import with unsaved edits leaves the draft intact and opens no picker', async ({ page }) => {
    const state = await installEngine(page, [alpha()]);
    await openLibraries(page);
    await page.getByText('Alpha Library', { exact: true }).click();
    await page.locator('textarea').fill('Unsaved library description');
    await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeVisible();
    let pickerCount = 0;
    page.on('filechooser', () => { pickerCount++; });
    await page.getByRole('button', { name: 'Import Libraries', exact: true }).click();
    await page.getByRole('dialog', { name: 'Unsaved Changes', exact: true })
        .getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('textarea')).toHaveValue('Unsaved library description');
    await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeVisible();
    expect(state.writes).toHaveLength(0);
    expect(pickerCount).toBe(0);
});

test('a failed draft save prevents the import picker and preserves unsaved edits', async ({ page }) => {
    const state = await installEngine(page, [alpha()]);
    state.result = { overrideNeeded: false, librariesSuccess: false, librariesCause: { detailMessage: 'Draft save rejected' } };
    await openLibraries(page);
    await page.getByText('Alpha Library', { exact: true }).click();
    await page.locator('textarea').fill('Unsaved library description');
    let pickerCount = 0;
    page.on('filechooser', () => { pickerCount++; });
    await page.getByRole('button', { name: 'Import Libraries', exact: true }).click();
    await page.getByRole('dialog', { name: 'Unsaved Changes', exact: true })
        .getByRole('button', { name: 'Save and Import', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toContainText('Draft save rejected');
    await closeError(page);
    await expect(page.locator('textarea')).toHaveValue('Unsaved library description');
    await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeVisible();
    expect(state.writes).toHaveLength(1);
    expect(pickerCount).toBe(0);
    expect(state.libraries).toEqual([alpha()]);
});

test('saving a draft before import preserves the saved changes in the merged collection', async ({ page }) => {
    const state = await installEngine(page, [alpha()]);
    await openLibraries(page);
    await page.getByText('Alpha Library', { exact: true }).click();
    await page.locator('textarea').fill('Saved before adding another library');
    await page.getByRole('button', { name: 'Import Libraries', exact: true }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('dialog', { name: 'Unsaved Changes', exact: true })
        .getByRole('button', { name: 'Save and Import', exact: true }).click();
    const file = await chooser;
    expect(state.writes).toHaveLength(1);
    expect(state.libraries[0].description).toBe('Saved before adding another library');
    await file.setFiles({ name: 'libraries.xml', mimeType: 'application/xml', buffer: Buffer.from(libraryXml([beta()])) });
    await confirmImport(page);
    await expect(page.getByText('Beta Function', { exact: true })).toBeVisible();
    expect(state.writes).toHaveLength(2);
    state.writes.forEach(assertAdditiveWrite);
    expect(state.libraries.find(value => value.id === 'lib-a')?.description).toBe('Saved before adding another library');
    expect(memberIds(state.libraries.find(value => value.id === 'lib-a')!)).toEqual(['tpl-a']);
    await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toHaveCount(0);
});

test('keeping an existing template still imports library metadata and new members', async ({ page }) => {
    const imported = library('lib-a', 'Alpha Library', [
        template('tpl-a', 'Alpha Function', 'return "must not replace existing code";'),
        template('tpl-new', 'New Function')
    ]);
    imported.description = 'Updated library metadata';
    const state = await installEngine(page, [alpha()]);
    await openLibraries(page);
    await startImport(page, [imported]);
    await chooseConflict(page, 'Library', 'Overwrite');
    await chooseConflict(page, 'Code Template', 'Keep Existing');
    await expect(page.getByText('New Function', { exact: true })).toBeVisible();
    assertAdditiveWrite(state.writes[0]);
    const merged = state.libraries[0];
    expect(merged.description).toBe('Updated library metadata');
    expect(memberIds(merged)).toEqual(['tpl-a', 'tpl-new']);
    expect(members(merged).find(value => value.id === 'tpl-a')).toEqual(members(alpha())[0]);
    expect(state.writes[0].parts.updatedCodeTemplates.list.codeTemplate.map(value => value.id)).toEqual(['tpl-new']);
});

test('importing a library as a copy gives its templates new IDs and preserves original ownership', async ({ page }) => {
    const state = await installEngine(page, [alpha()]);
    await openLibraries(page);
    await startImport(page, [alpha()]);
    await chooseConflict(page, 'Library', 'Import as Copy');
    const nameDialog = page.getByRole('dialog', { name: 'Import Library Name', exact: true });
    await nameDialog.getByRole('textbox').fill('Alpha Library Copy');
    await nameDialog.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(page.getByText('Alpha Library Copy', { exact: true })).toBeVisible();
    assertAdditiveWrite(state.writes[0]);
    expect(state.libraries.find(value => value.id === 'lib-a')).toEqual(alpha());
    const copied = state.libraries.find(value => value.name === 'Alpha Library Copy')!;
    expect(copied.id).not.toBe('lib-a');
    expect(memberIds(copied)).toHaveLength(1);
    expect(memberIds(copied)[0]).not.toBe('tpl-a');
    expect(members(copied)[0].properties).toEqual(members(alpha())[0].properties);
});

test('importing a matching template as a copy keeps both versions in the target library', async ({ page }) => {
    const imported = library('lib-a', 'Alpha Library', [template('tpl-a', 'Alpha Function', 'return "copied version";')]);
    const state = await installEngine(page, [alpha()]);
    await openLibraries(page);
    await startImport(page, [imported]);
    await chooseConflict(page, 'Library', 'Overwrite');
    await chooseConflict(page, 'Code Template', 'Import as Copy');
    const nameDialog = page.getByRole('dialog', { name: 'Import Code Template Name', exact: true });
    await nameDialog.getByRole('textbox').fill('Alpha Function Copy');
    await nameDialog.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(page.getByText('Alpha Function Copy', { exact: true })).toBeVisible();
    assertAdditiveWrite(state.writes[0]);
    const saved = members(state.libraries[0]);
    expect(saved).toHaveLength(2);
    expect(saved.find(value => value.id === 'tpl-a')).toEqual(members(alpha())[0]);
    const copied = saved.find(value => value.id !== 'tpl-a')!;
    expect(copied.name).toBe('Alpha Function Copy');
    expect(copied.properties.code).toBe('return "copied version";');
});

test('skipping a conflicting library still imports other selected libraries', async ({ page }) => {
    const imported = alpha();
    imported.description = 'Must not overwrite skipped library';
    const state = await installEngine(page, [alpha()]);
    await openLibraries(page);
    await startImport(page, [imported, beta()]);
    await chooseConflict(page, 'Library', 'Skip Library');
    await expect(page.getByText('Beta Function', { exact: true })).toBeVisible();
    assertAdditiveWrite(state.writes[0]);
    expect(state.libraries.find(value => value.id === 'lib-a')).toEqual(alpha());
    expect(state.writes[0].parts.updatedCodeTemplates.list.codeTemplate.map(value => value.id)).toEqual(['tpl-b']);
});

test('changing the session during import confirmation prevents every import write', async ({ page }) => {
    const state = await installEngine(page, [alpha()]);
    await openLibraries(page);
    await chooseImport(page, libraryXml([beta()]));
    const previousReads = state.reads;
    await adoptReplacementSession(page);
    await confirmImport(page);
    await expect(page.locator('.content-row')).not.toHaveAttribute('inert');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(state.reads).toBe(previousReads);
    expect(state.writes).toHaveLength(0);
});

test('changing the session during a prerequisite save conflict prevents overwrite retry and import', async ({ page }) => {
    const state = await installEngine(page, [alpha()]);
    state.result = { overrideNeeded: true };
    await openLibraries(page);
    await page.getByText('Alpha Library', { exact: true }).click();
    await page.locator('textarea').fill('Unsaved description before session change');
    let pickerCount = 0;
    page.on('filechooser', () => { pickerCount++; });
    await page.getByRole('button', { name: 'Import Libraries', exact: true }).click();
    await page.getByRole('dialog', { name: 'Unsaved Changes', exact: true })
        .getByRole('button', { name: 'Save and Import', exact: true }).click();
    const conflict = page.getByRole('dialog', { name: 'Code Templates Modified', exact: true });
    await expect(conflict).toBeVisible();
    expect(state.writes).toHaveLength(1);
    await adoptReplacementSession(page);
    await conflict.getByRole('button', { name: 'Overwrite', exact: true }).click();
    await expect(page.locator('.content-row')).not.toHaveAttribute('inert');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0].override).toBe('false');
    expect(pickerCount).toBe(0);
    expect(state.libraries).toEqual([alpha()]);
});


async function selectIndividualFile(page: Page, imported: Model) {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Code Templates', exact: true }).click();
    await (await chooser).setFiles({ name: 'template.xml', mimeType: 'application/xml', buffer: Buffer.from(xmlElement('codeTemplate', imported)) });
}

for (const choice of ['Overwrite', 'Import as Copy', 'Keep Existing', 'Cancel'] as const) {
    test(`individual template conflict requires the explicit ${choice} decision`, async ({ page }) => {
        const state = await installEngine(page, [alpha()]);
        await openLibraries(page);
        await selectIndividualFile(page, template('tpl-a', 'Alpha Function', 'return "imported";'));
        await expect(page.getByRole('dialog', { name: 'Import Code Template Conflict', exact: true })).toBeVisible();
        expect(state.writes).toHaveLength(0);
        await chooseConflict(page, 'Code Template', choice);
        if (choice === 'Cancel' || choice === 'Keep Existing') {
            await expect(page.locator('.content-row')).not.toHaveAttribute('inert');
            expect(state.writes).toHaveLength(0);
        } else {
            if (choice === 'Import as Copy') {
                const rename = page.getByRole('dialog', { name: 'Import Code Template Name', exact: true });
                await rename.getByRole('textbox').fill('Alpha Function Copy');
                await rename.getByRole('button', { name: 'OK', exact: true }).click();
            }
            await expect.poll(() => state.writes.length).toBe(1);
            assertAdditiveWrite(state.writes[0]);
            const saved = state.writes[0].parts.updatedCodeTemplates.list.codeTemplate[0];
            expect(saved.properties.code).toBe('return "imported";');
            if (choice === 'Overwrite') expect(saved).toMatchObject({ id: 'tpl-a', revision: 3 });
            else { expect(saved.id).not.toBe('tpl-a'); expect(saved.revision).toBe(0); }
        }
    });
}

test('individual cross-library import generates a new ID and preserves the original', async ({ page }) => {
    const state = await installEngine(page, [alpha(), beta()]);
    await openLibraries(page);
    await page.getByText('Beta Library', { exact: true }).click();
    await selectIndividualFile(page, template('tpl-a', 'Alpha Function'));
    await expect.poll(() => state.writes.length).toBe(1);
    assertAdditiveWrite(state.writes[0]);
    const saved = state.writes[0].parts.updatedCodeTemplates.list.codeTemplate[0];
    expect(saved.id).not.toBe('tpl-a');
    expect(memberIds(state.libraries.find(value => value.id === 'lib-a')!)).toEqual(['tpl-a']);
    expect(memberIds(state.libraries.find(value => value.id === 'lib-b')!)).toEqual([saved.id, 'tpl-b'].sort());
});

test('individual import saves dirty library edits before opening the file picker', async ({ page }) => {
    const state = await installEngine(page, [alpha()]);
    await openLibraries(page);
    await page.getByText('Alpha Library', { exact: true }).click();
    await page.locator('textarea').fill('Saved before importing');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Code Templates', exact: true }).click();
    await page.getByRole('dialog', { name: 'Unsaved Changes', exact: true }).getByRole('button', { name: 'Save and Import', exact: true }).click();
    await (await chooser).setFiles({ name: 'template.xml', mimeType: 'application/xml', buffer: Buffer.from(xmlElement('codeTemplate', template('tpl-new', 'New Function'))) });
    await expect.poll(() => state.writes.length).toBe(2);
    expect(state.writes[0].parts.libraries.list.codeTemplateLibrary[0].description).toBe('Saved before importing');
    expect(state.writes[0].parts.updatedCodeTemplates.list.codeTemplate).toEqual([]);
    expect(state.writes[1].parts.updatedCodeTemplates.list.codeTemplate[0].id).toBe('tpl-new');
});

test('individual import re-reads server libraries and never force-overwrites a later conflict', async ({ page }) => {
    const state = await installEngine(page, [alpha()]);
    await openLibraries(page);
    state.libraries.push(beta());
    state.result = { overrideNeeded: true };
    await selectIndividualFile(page, template('tpl-new', 'New Function'));
    await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toContainText('changed during import');
    expect(state.writes).toHaveLength(1);
    assertAdditiveWrite(state.writes[0]);
    expect(state.writes[0].parts.libraries.list.codeTemplateLibrary.map(value => value.id).sort()).toEqual(['lib-a','lib-b']);
    await expect(page.getByRole('dialog', { name: 'Code Templates Modified', exact: true })).toHaveCount(0);
});
