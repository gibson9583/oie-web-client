import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';
import { CASES, channelWithSourceElement } from './step-rule-fixtures.js';

/*
 * Guards Monaco's TypeScript language-service worker, which powers IntelliSense
 * (member completions / hover / signature help from the generated userapi .d.ts).
 *
 * Regression this catches: the worker is spawned from a blob: URL, so the AMD
 * worker bootstrap must be loaded with a FULLY-QUALIFIED same-origin URL — a
 * root-relative importScripts('/vendor/monaco/...') is invalid inside a blob:
 * worker and silently kills the worker (Monaco falls back to the main thread and
 * completions hang). That degraded IntelliSense with no visible error. Here we
 * drive a real completion through the worker and require member results.
 */
test('Monaco TS worker answers member completions (IntelliSense)', async ({ page }) => {
    // Fail loudly if the worker can't load its bootstrap (the regression's signature).
    const workerErrors = [];
    page.on('pageerror', (e) => { if (/importScripts|web worker/i.test(e.message)) workerErrors.push(e.message); });

    await mockEngine(page);
    await page.goto('/global-scripts');
    // Monaco must upgrade from the baseline textarea first.
    await page.waitForSelector('.monaco-editor', { timeout: 15000 });

    const result = await page.evaluate(async () => {
        const withTimeout = (p, ms, tag) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + tag)), ms))]);
        const monaco = window.monaco;
        // monaco >=0.53 exposes the TS service at monaco.typescript (was monaco.languages.typescript).
        const tsLang = (monaco.languages && monaco.languages.typescript) || monaco.typescript;
        const accessor = await withTimeout(tsLang.getJavaScriptWorker(), 8000, 'getWorker');
        const model = monaco.editor.createModel('DateUtil.', 'javascript');
        try {
            const client = await withTimeout(accessor(model.uri), 8000, 'accessor');
            const info = await withTimeout(client.getCompletionsAtPosition(model.uri.toString(), 'DateUtil.'.length), 8000, 'completions');
            return (info && info.entries || []).map((e) => e.name);
        } finally {
            model.dispose();
        }
    });

    expect(workerErrors, `worker failed to load: ${workerErrors.join('; ')}`).toEqual([]);
    // convertDate is a real DateUtil method declared in the userapi .d.ts — proves
    // the language service read the extra lib through a live worker, not just that
    // some worker exists.
    expect(result).toContain('convertDate');
});

/*
 * A code template is more than one named function: a template can build a whole
 * namespace object (toolbox.widgets.spin = function …). The scoped template
 * SOURCES are fed to the language service as extra libs (script-completions
 * templateSourcesInScope → monaco.js), so members complete after every dot —
 * with no JSDoc required. Scope rules still hold: a library not linked to the
 * channel contributes nothing.
 */
test('a namespace code template completes its members, scoped to the channel', async ({ page }) => {
    const kase = CASES.find((c) => c.kind === 'transformer');
    const id = 'tpl-lib-scope';
    const channel = channelWithSourceElement(id, kase.kind, kase.class, kase.element());

    await mockEngine(page, {
        [`GET /channels/${id}`]: { channel },
        'GET /codeTemplateLibraries': { list: { codeTemplateLibrary: [
            {
                '@version': '4.5.0', id: 'lib-ns', name: 'Toolbox Helpers', revision: 1,
                includeNewChannels: false, disabledChannelIds: '',
                enabledChannelIds: { string: [id] },
                codeTemplates: { codeTemplate: [{
                    '@version': '4.5.0', id: 'tpl-ns', name: 'Toolbox Namespace', revision: 1,
                    contextSet: { delegate: { contextType: ['SOURCE_FILTER_TRANSFORMER'] } },
                    properties: {
                        '@class': 'com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties',
                        type: 'FUNCTION',
                        code: 'var toolbox = toolbox || {};\ntoolbox.widgets = {};\ntoolbox.widgets.spin = function (speed) { return speed; };\ntoolbox.widgets.paint = function (color) { return color; };\n'
                    }
                }] }
            },
            {
                // The common library shape: a single top-level IIFE assigning its
                // namespace through a `global` parameter. The language service
                // can't see through that, so the source is fed UNWRAPPED — Rhino
                // runs the wrapper at script scope anyway, so the inner var IS a
                // runtime global.
                '@version': '4.5.0', id: 'lib-iife', name: 'Test Library', revision: 1,
                includeNewChannels: false, disabledChannelIds: '',
                enabledChannelIds: { string: [id] },
                codeTemplates: { codeTemplate: [{
                    '@version': '4.5.0', id: 'tpl-iife', name: 'Test.js', revision: 1,
                    contextSet: { delegate: { contextType: ['SOURCE_FILTER_TRANSFORMER'] } },
                    properties: {
                        '@class': 'com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties',
                        type: 'FUNCTION',
                        code: '/*! Test.js v1.0 | (c) Example | MIT\n * a banner comment ahead of the wrapper, like real libraries ship */\n(function (global) {\n  "use strict";\n  var testlib = global.testlib || {};\n  testlib.version = "1.0";\n  /* namespace scaffolded as an object literal of empty objects — the form the\n     language service cannot merge later assignments into (normalized in the\n     feed) */\n  testlib.rockets = { launchpad: {} };\n  testlib.rockets.launchpad.ignite = function (fuel) { return fuel; };\n  testlib.rockets.launchpad.countdown = function (seconds) { return seconds; };\n  global.testlib = testlib;\n})(this);\n'
                    }
                }] }
            },
            {
                // Linked to a DIFFERENT channel — must contribute nothing here.
                '@version': '4.5.0', id: 'lib-other', name: 'Elsewhere', revision: 1,
                includeNewChannels: false, disabledChannelIds: '',
                enabledChannelIds: { string: ['some-other-channel'] },
                codeTemplates: { codeTemplate: [{
                    '@version': '4.5.0', id: 'tpl-other', name: 'Other Namespace', revision: 1,
                    contextSet: { delegate: { contextType: ['SOURCE_FILTER_TRANSFORMER'] } },
                    properties: {
                        '@class': 'com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties',
                        type: 'FUNCTION',
                        code: 'var elsewhere = { hidden: function () {} };\n'
                    }
                }] }
            }
        ] } },
    });

    // Reach a transformer editor so setActiveScope(channel, SOURCE_FILTER_TRANSFORMER) fires.
    await page.goto(`/channels/${id}/edit`);
    await expect(page.getByRole('tab', { name: 'Summary', exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('tab', { name: 'Source', exact: true }).click();
    await page.getByRole('button', { name: /^Edit Transformer/ }).click();
    await page.waitForSelector('.monaco-editor', { timeout: 15_000 });

    const membersOf = (prefix) => page.evaluate(async (pfx) => {
        const monaco = window.monaco;
        const tsLang = (monaco.languages && monaco.languages.typescript) || monaco.typescript;
        const accessor = await tsLang.getJavaScriptWorker();
        const model = monaco.editor.createModel(pfx, 'javascript');
        try {
            const client = await accessor(model.uri);
            const info = await client.getCompletionsAtPosition(model.uri.toString(), pfx.length);
            return (info && info.entries || []).map((e) => e.name);
        } finally {
            model.dispose();
        }
    }, prefix);

    // The scope loads async after the editor mounts; poll until the lib lands.
    await expect.poll(() => membersOf('toolbox.widgets.'), { timeout: 10_000 }).toContain('spin');
    expect(await membersOf('toolbox.widgets.')).toContain('paint');
    // The namespace root itself is a known global now.
    expect(await membersOf('toolb')).toContain('toolbox');
    // The IIFE-wrapped library completes through every dot of its namespace.
    expect(await membersOf('testlib.rockets.launchpad.')).toEqual(expect.arrayContaining(['ignite', 'countdown']));
    expect(await membersOf('testl')).toContain('testlib');
    // The other channel's library stayed out of scope.
    expect(await membersOf('elsewh')).not.toContain('elsewhere');
});
