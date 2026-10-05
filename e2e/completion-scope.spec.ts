import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';
import type { Page } from '@playwright/test';

const channelId = 'completion-scope';
const contexts = ['SOURCE_FILTER_TRANSFORMER', 'CHANNEL_BATCH', 'CHANNEL_ATTACHMENT', 'SOURCE_RECEIVER'];
const library = {
    id: 'scope-library', name: 'Scope Library', includeNewChannels: true,
    codeTemplates: { codeTemplate: contexts.map((context, index) => ({
        id: `scope-template-${index}`, name: `scopeTemplate${index}`,
        contextSet: { delegate: { contextType: [context] } },
        properties: { type: 'FUNCTION', code: `function scopeTemplate${index}() {}` }
    })) }
};

async function expectScope(page: Page, index: number | null) {
    await expect.poll(() => page.evaluate(async () => {
        const modulePath = '/core/script-completions.js';
        const scopeModule = await import(modulePath);
        return {
            contexts: scopeModule.activeScope().contexts,
            templates: scopeModule.getActiveCompletions().map((entry: { name: string }) => entry.name),
            libraries: scopeModule.getActiveLibs().map((entry: { id: string }) => entry.id)
        };
    })).toEqual(index === null ? { contexts: [], templates: [], libraries: [] } : {
        contexts: [contexts[index]], templates: [`scopeTemplate${index}`], libraries: [`scope-template-${index}`]
    });
}

async function setup(page: Page) {
    const channel = makeChannel(channelId);
    channel.sourceConnector.transformer.elements = {
        'com.mirth.connect.plugins.javascriptstep.JavaScriptStep': {
            '@version': '4.6.0', name: 'Scope step', sequenceNumber: '0', enabled: true, script: '// step'
        }
    };
    await mockEngine(page, {
        [`GET /channels/${channelId}`]: { channel },
        'GET /codeTemplateLibraries': { list: { codeTemplateLibrary: [library] } }
    });
    await page.goto(`/channels/${channelId}/transformer/0`);
    await expectScope(page, 0);
    await page.evaluate(async ({ channelId, contexts }) => {
        const modulePath = '@oie/web-shell';
        const { platform } = await import(modulePath);
        const host = document.createElement('div');
        host.id = 'scope-editors';
        host.style.cssText = 'position:fixed;inset:20px;z-index:99999;display:flex;background:white';
        document.body.appendChild(host);
        (window as any).scopeEditors = contexts.slice(1).map((context: string, index: number) => {
            const editor = platform.createCodeEditor({ value: '', language: 'javascript', completionScope: { channelId, context } });
            editor.el.id = `scope-editor-${index}`;
            editor.el.style.cssText = 'width:33%;height:100%';
            host.appendChild(editor.el);
            return editor;
        });
    }, { channelId, contexts });
    for (const index of [0, 1, 2]) await expect(page.locator(`#scope-editor-${index} .monaco-editor`)).toBeVisible();
}

async function focus(page: Page, index: number) {
    await page.locator(`#scope-editor-${index} .monaco-editor`).click();
    await expectScope(page, index + 1);
}

async function dispose(page: Page, index: number) {
    await page.evaluate((index) => (window as any).scopeEditors[index].dispose(), index);
}

async function returnToTransformer(page: Page) {
    await page.evaluate(() => {
        for (const editor of (window as any).scopeEditors) editor.dispose();
        document.getElementById('scope-editors')!.remove();
    });
    await page.locator('.monaco-editor:visible').first().click();
    await expectScope(page, 0);
}

for (const order of [[0, 1], [1, 0]]) {
    test(`sibling editor focus cycles restore the transformer after disposal order ${order.join(',')}`, async ({ page }) => {
        await setup(page);
        for (const index of [0, 1, 0]) await focus(page, index);
        await dispose(page, order[0]);
        await expectScope(page, order[1] + 1);
        await dispose(page, order[1]);
        await returnToTransformer(page);
    });
}

for (const order of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
    test(`three editor focus cycles restore live predecessors in disposal order ${order.join(',')}`, async ({ page }) => {
        await setup(page);
        for (const index of [0, 1, 2, 0, 1, 0]) await focus(page, index);
        const remaining = [0, 1, 2];
        for (const index of order) {
            await dispose(page, index);
            remaining.splice(remaining.indexOf(index), 1);
            await expectScope(page, remaining.length ? remaining[0] + 1 : 0);
        }
        await returnToTransformer(page);
    });
}

test('disposing a middle owner preserves the live ancestor and repeated disposal is harmless', async ({ page }) => {
    await setup(page);
    for (const index of [0, 1, 2]) await focus(page, index);
    await dispose(page, 1);
    await expectScope(page, 3);
    await dispose(page, 2);
    await expectScope(page, 1);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await focus(page, 0);
    await dispose(page, 0);
    await dispose(page, 0);
    await returnToTransformer(page);
});

for (const replacement of ['clear', 'replace', 'refocus']) {
    test(`external scope ${replacement} invalidates the old editor chain`, async ({ page }) => {
        await setup(page);
        for (const index of [0, 1, 0]) await focus(page, index);
        await page.evaluate(async ({ replacement, channelId }) => {
            const modulePath = '/core/script-completions.js';
            const scopeModule = await import(modulePath);
            if (replacement === 'clear') scopeModule.clearActiveScope();
            else await scopeModule.setActiveScope(channelId, ['SOURCE_RECEIVER']);
        }, { replacement, channelId });
        if (replacement === 'refocus') {
            await focus(page, 1);
            await focus(page, 0);
        }
        for (const index of [1, 0, 2]) await dispose(page, index);
        await expectScope(page, replacement === 'clear' ? null : 3);
    });
}
