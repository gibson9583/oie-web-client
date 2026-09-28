import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
// Render the real component and Delimited schema without browser-only UI
// services. React stays external so the renderer and component share its hooks.
const bundle = await build({
    stdin: { contents: `
        import { createElement } from 'react';
        import { renderToStaticMarkup } from 'react-dom/server';
        import { DataTypePropertiesEditor } from './web-administrator/client/datatypes/props-editor.tsx';
        import { register } from './web-administrator/plugins/datatype-delimited/web/plugin.tsx';
        import { platform } from '@oie/web-shell';
        register(platform);
        export const defaults = () => platform.dataType('DELIMITED').defaults('4.6.0');
        export const render = props => renderToStaticMarkup(createElement(DataTypePropertiesEditor, props));
    `, resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'tsx' },
    bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic',
    tsconfigRaw: { compilerOptions: { jsx: 'react-jsx', target: 'es2022' } },
    plugins: [{ name: 'render-services', setup(builder) {
        builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
        builder.onResolve({ filter: /^@oie\/web-shell$/ }, () => ({ path: 'registry', namespace: 'test-services' }));
        builder.onResolve({ filter: /^@oie\/web-ui$/ }, () => ({ path: 'ui', namespace: 'test-services' }));
        builder.onResolve({ filter: /\/core\/serialize\.js$/ }, () => ({ path: 'serialize', namespace: 'test-services' }));
        builder.onLoad({ filter: /.*/, namespace: 'test-services' }, args => ({ contents: args.path === 'registry'
            ? 'const types = new Map(); export const platform = { registerDataType: (name, def) => types.set(name, def), dataType: name => types.get(name) };'
            : args.path === 'serialize' ? 'export const validateScript = () => { throw new Error("Unexpected script validation"); };'
                : 'export const toast = () => {}, modal = () => {}, pickFile = () => {}, createCodeEditor = () => {};', loader: 'js' }));
    } }]
});
const { defaults, render } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
}

for (const connectorType of ['SOURCE', 'DESTINATION', 'RESPONSE']) {
    for (const direction of ['inbound', 'outbound']) {
        test(`${connectorType} ${direction}: rendering existing groups does not normalize legacy arrays`, () => {
            for (const widths of [null, [], { int: [] }, '5,3', { int: [5, 3], '@future': 'keep' }, '0']) {
                const props = defaults();
                props.serializationProperties.columnWidths = structuredClone(widths);
                props.serializationProperties.columnNames = 'first,second';
                props.deserializationProperties.columnWidths = structuredClone(widths);
                props.future = { keep: true };
                const before = structuredClone(props);
                freeze(props);
                const args = { typeName: 'DELIMITED', props, version: '4.6.0', direction, connectorType };
                const markup = render(args);
                assert.match(markup, /value="first,second"/);
                if (widths === '0') assert.match(markup, /aria-invalid="true"/);
                if (widths === '5,3') assert.match(markup, /value="5,3"/);
                assert.equal(render(args), markup, 'a repeated render has the same output');
                assert.deepEqual(props, before, 'rendering leaves both visible and hidden array groups intact');
            }
        });
    }
}
