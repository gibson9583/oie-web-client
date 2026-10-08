import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transform } from 'esbuild';
import * as oie from '../web-administrator/client/core/oie.js';
import { channelResponseVariables } from '../web-administrator/client/core/channel-response.js';

// Exercise the shared scanner and private settings render without mounting the editor,
// running effects/HTTP requests, or evaluating channel scripts.
const source = await readFile(new URL('../web-administrator/client/react/views/channel-editor.tsx', import.meta.url), 'utf8');
const start = source.indexOf('function SourceSettings(');
const end = source.indexOf('function SourceTab(', start);
assert.ok(start >= 0 && end > start, 'source settings source boundaries exist');
const { code } = await transform(source.slice(start, end), { loader: 'tsx', jsxFactory: 'jsx' });
const jsx = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) });
const scan = channel => channelResponseVariables(channel).variables;
const render = new Function('oie', 'channelResponseVariables', 'useReducer', 'useState', 'useEffect', 'jsx',
    `${code}\nreturn SourceSettings;`)(oie, channelResponseVariables,
    () => [0, () => {}], initial => [initial, () => {}], () => {}, jsx);
const JS = 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep';
const RULE = 'com.mirth.connect.plugins.javascriptrule.JavaScriptRule';
const MAPPER = 'com.mirth.connect.plugins.mapper.MapperStep';
const stage = (type, elements) => ({ elements: { [type]: elements } });
const fromScript = script => scan({ postprocessingScript: script });

test('response keys decode JavaScript escapes in both put forms', () => {
    const cases = [
        [String.raw`\u0061ck`, 'ack'],
        [String.raw`\uD83D\uDE00`, '😀'],
        [String.raw`\x61ck`, 'ack'],
        [String.raw`\141ck`, 'ack'],
        [String.raw`\b\f\n\r\t\v\0`, '\b\f\n\r\t\v\0'],
        [String.raw`\377\400\777\08`, 'ÿ 0?7\0' + '8'],
        [String.raw`can\'t`, "can't"],
        [String.raw`say\"yes`, 'say"yes'],
        [String.raw`a\\b`, 'a\\b'],
        [String.raw`\\u0061`, String.raw`\u0061`],
        [String.raw`\q\8\9`, 'q89'],
    ];
    for (const [literal, expected] of cases) {
        for (const put of ['responseMap.put', '$r']) {
            assert.deepEqual(fromScript(`${put}('${literal}', response);`), [expected], `${put}: ${literal}`);
        }
    }
});

test('response Mapper names survive primitive wire values', () => {
    for (const variable of [0, false, '0', 'false', 'ack']) {
        assert.deepEqual(scan({ sourceConnector: { transformer: stage(MAPPER, { scope: 'RESPONSE', variable }) } }), [String(variable)]);
    }
    for (const variable of [undefined, null, '']) {
        assert.deepEqual(scan({ sourceConnector: { transformer: stage(MAPPER, { scope: 'RESPONSE', variable }) } }), []);
    }
    assert.deepEqual(scan({ sourceConnector: { transformer: stage(MAPPER, { scope: 'CHANNEL', variable: 'other' }) } }), []);
});

test('loaded primitive selections do not duplicate discovered response options', () => {
    for (const variable of [0, false, true]) {
        const channel = { sourceConnector: { transformer: stage(MAPPER, { scope: 'RESPONSE', variable }) } };
        const scp = { respondAfterProcessing: true, responseVariable: variable };
        const tree = render({ channel, scp, markDirty: () => {} });
        const field = tree.children.find(node => node.children?.some(child => child?.type === 'label' && child.children[0] === 'Response'));
        const select = field.children.find(node => node?.type === 'select');
        assert.equal(select.props.value, String(variable));
        assert.equal(select.children.filter(option => String(option.props.value) === String(variable)).length, 1);
        assert.equal(scp.responseVariable, variable, 'render must not mutate the saved model');
    }
});

test('scanner retains put/get distinction, whitespace support and decoded deduplication', () => {
    const script = String.raw`responseMap . put ( 'ack', response); $r('\u0061ck', response); $r('getOnly'); responseMap.get('readOnly');`;
    assert.deepEqual(fromScript(script), ['ack']);
    assert.deepEqual(fromScript(script), ['ack'], 'repeated scans do not share regex cursor state');
});

test('scanner keeps existing source, destination and writer inclusion rules', () => {
    const channel = {
        sourceConnector: {
            filter: stage(RULE, [{ script: "$r('sourceRule', 1)" }, { enabled: false, script: "$r('disabledRule', 1)" }]),
            transformer: stage(JS, [{ script: "$r('sourceStep', 1)" }, { enabled: 'false', script: "$r('disabledStep', 1)" }]),
        },
        destinationConnectors: { connector: [
            { enabled: false, filter: stage(RULE, { enabled: false, script: "$r('destRule', 1)" }),
                transformer: stage(MAPPER, { enabled: false, scope: 'RESPONSE', variable: 'mapped' }),
                responseTransformer: stage(JS, { enabled: 'false', script: "$r('destResponse', 1)" }) },
            { transportName: 'JavaScript Writer', properties: { script: "$r('writer', 1)" } },
            ...[true, 'true', false, 'false'].map(useScript => ({ transportName: 'Database Writer', properties: { useScript, query: "$r('db', 1)" } })),
        ] },
        preprocessingScript: "$r('pre', 1)", postprocessingScript: "$r('post', 1)",
    };
    const before = structuredClone(channel);
    assert.deepEqual(scan(channel), ['sourceRule', 'sourceStep', 'destRule', 'mapped', 'destResponse', 'writer', 'db', 'pre', 'post']);
    assert.deepEqual(channel, before, 'discovery must not mutate the working channel');
    for (const useScript of [false, 'false']) assert.deepEqual(scan({ destinationConnectors: { connector: {
        transportName: 'Database Writer', properties: { useScript, query: "$r('sql', 1)" },
    } } }), []);
});

test('script-only channels, absent data and malformed escapes remain safe to scan', () => {
    assert.deepEqual(scan({ preprocessingScript: "$r('pre', 1)", postprocessingScript: "$r('post', 1)" }), ['pre', 'post']);
    assert.deepEqual(scan({}), []);
    for (const script of [undefined, null, false, 0, {}]) assert.deepEqual(fromScript(script), []);
    for (const literal of [String.raw`bad\u12`, String.raw`bad\xZ1`]) {
        assert.doesNotThrow(() => fromScript(`$r('${literal}', response)`));
    }
    delete globalThis.__responseScanExecuted;
    assert.deepEqual(fromScript("responseMap.put('safe', (globalThis.__responseScanExecuted = true));"), ['safe']);
    assert.equal(globalThis.__responseScanExecuted, undefined, 'discovery never executes channel code');
});
