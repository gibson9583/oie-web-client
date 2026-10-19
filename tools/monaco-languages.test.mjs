import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { assertHostMonacoLanguages, hostMonacoLanguages, HOST_DEFINITIONS, HOST_SERVICES } from '../web-administrator/tools/monaco-languages.mjs';
import { embeddedSanitizer, monacoMain, sanitizerEntry } from '../web-administrator/tools/sanitizer.mjs';

// Exercise the installed Monaco package, including its transitive grammars and
// editor contributions. write:false keeps this independent of a running app.
const result = await build({
    entryPoints: { 'editor.main': monacoMain },
    outdir: '/unused-monaco-test-output', write: false,
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
    loader: { '.ttf': 'file' }, metafile: true, logLevel: 'silent',
    plugins: [hostMonacoLanguages(monacoMain), {
        name: 'patched-monaco-sanitizer',
        setup(builder) {
            builder.onResolve({ filter: /dompurify[/\\]dompurify\.js$/ }, args => {
                if (resolve(args.resolveDir, args.path) === embeddedSanitizer) return { path: sanitizerEntry };
            });
        }
    }]
});

test('the installed Monaco bundles only stock editor languages and intrinsic JavaScript dependencies', () => {
    assert.deepEqual(assertHostMonacoLanguages(result.metafile, monacoMain), {
        definitions: [...HOST_DEFINITIONS], services: [...HOST_SERVICES], definitionDependencies: ['typescript']
    });
});

test('language selection preserves generic editing features and the patched sanitizer', () => {
    const inputs = Object.keys(result.metafile.inputs).map(input => resolve(input));
    for (const contribution of ['suggestController.js', 'findController.js', 'folding.js', 'diffEditor.contribution.js', 'contextmenu.js']) {
        assert.ok(inputs.some(input => input.endsWith(`/${contribution}`)), `${contribution} must remain available`);
    }
    assert.ok(inputs.includes(sanitizerEntry));
    assert.ok(!inputs.includes(embeddedSanitizer));
});

function withExtraInput(path) {
    return { inputs: { ...result.metafile.inputs, [resolve(dirname(monacoMain), '../languages', path)]: {} } };
}

test('an intrinsic grammar dependency cannot silently become a registered scripting language', () => {
    assert.throws(() => assertHostMonacoLanguages(withExtraInput('definitions/typescript/register.js'), monacoMain), /Unselected.*registration/);
});

test('a future unselected grammar or service fails the build graph guard', () => {
    for (const path of ['definitions/plugin-only/grammar.js', 'definitions/plugin-only/register.js', 'features/plugin-only/service.js']) {
        assert.throws(() => assertHostMonacoLanguages(withExtraInput(path), monacoMain), /Unselected Monaco/);
    }
});

test('missing required language registrations fail the build graph guard', () => {
    const inputs = { ...result.metafile.inputs };
    for (const input of Object.keys(inputs)) {
        if (input.endsWith('/definitions/javascript/register.js')) delete inputs[input];
    }
    assert.throws(() => assertHostMonacoLanguages({ inputs }, monacoMain), /required.*missing/);
});
