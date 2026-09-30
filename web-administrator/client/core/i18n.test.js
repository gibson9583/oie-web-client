import assert from 'node:assert/strict';
import { test } from 'node:test';
let serial = 0;
const fresh = () => import('./i18n.js?test=' + serial++);
const initialize = (i, options = {}) => i.initializeI18n({ languages: ['zh-CN'], loadCatalog: async () => ({}), ...options });

test('negotiates scripts, browser priority and malformed preferences', async () => {
    const i = await fresh();
    for (const tag of ['zh', 'zh-Hans', 'zh-CN', 'zh-SG', 'ZH-cn']) assert.equal(i.negotiateLocale([tag]), 'zh-CN');
    for (const tag of ['zh-TW', 'zh-HK', 'zh-Hant', 'fr', 'invalid_locale']) assert.equal(i.negotiateLocale([tag]), 'en');
    assert.equal(i.negotiateLocale(['zh-Hant', 'zh-Hans']), 'zh-CN');
    assert.equal(i.negotiateLocale(['en-GB', 'zh-CN']), 'en');
    assert.equal(i.negotiateLocale(['bad_tag', 'zh-SG']), 'zh-CN');
    await initialize(i, { storedLocale: 'en' });
    assert.equal(i.locale(), 'en');
    const supported = i.locales(); supported[0].tag = 'changed';
    assert.equal(i.locales()[0].tag, 'en');
});

test('English is the source and ICU numbers, apostrophes, literal tags and rich nodes work', async () => {
    const i = await fresh();
    await initialize(i, { languages: ['en'] });
    assert.equal(i.t('Don\'\'t Save'), "Don't Save");
    assert.equal(i.t('Expected a <map>'), 'Expected a <map>');
    const plural = '{n, plural, =0 {None} one {# channel} other {# channels}}';
    assert.deepEqual([0, 1, 2].map(n => i.t(plural, { n })), ['None', '1 channel', '2 channels']);
    const node = { element: 'strong' };
    assert.deepEqual(i.tx('Read <strong>{name}</strong>.', { name: 'report', strong: chunks => { assert.deepEqual(chunks, ['report']); return node; } }), ['Read ', node, '.']);
});

test('catalog overrides fall back plugin → host → English, including malformed ICU contracts', async () => {
    const i = await fresh();
    await initialize(i, { loadCatalog: async () => ({ 'Hello {name}': '你好 {name}', 'noun\u0004Open': '打开状态' }) });
    const scoped = i.scope('example');
    assert.equal(scoped.t('Hello {name}', { name: '<script>' }), '你好 <script>');
    i.registerCatalog('example', { 'Hello {name}': '插件 {name}' });
    assert.equal(scoped.t('Hello {name}', { name: 'Alice' }), '插件 Alice');
    i.registerCatalog('example', { 'Hello {name}': '损坏 {other}' });
    assert.equal(scoped.t('Hello {name}', { name: 'Alice' }), '你好 Alice');
    assert.equal(i.tc('noun', 'Open'), '打开状态');
    assert.equal(i.tc('verb', 'Open'), 'Open');
    assert.equal(i.t('Unknown {id}', { id: 4 }), 'Unknown 4');
    assert.equal(i.t('Hello {name}'), 'Hello {name}');
    assert.equal(i.t('bad {'), 'bad {');
    i.registerCatalog('example');
    assert.equal(scoped.t('Hello {name}', { name: 'Bob' }), '你好 Bob');
    assert.throws(() => i.registerCatalog('example', { invalid: 1 }));
    assert.throws(() => i.registerCatalog('example', []));
});

test('a host catalog failure or timeout boots English and a late result cannot change it', async () => {
    for (const data of [[], { Hello: 1 }, null]) {
        const i = await fresh(); await initialize(i, { loadCatalog: async () => data });
        assert.equal(i.locale(), 'en');
    }
    const i = await fresh(); let finish;
    await initialize(i, { timeoutMs: 5, loadCatalog: () => new Promise(resolve => { finish = resolve; }) });
    finish({ Hello: '你好' }); await Promise.resolve();
    assert.equal(i.locale(), 'en'); assert.equal(i.t('Hello'), 'Hello');
    await initialize(i, { languages: ['zh-CN'] });
    assert.equal(i.locale(), 'en');
});

test('pseudo expands literal text while retaining IDs, values and rich elements', async () => {
    const prod = await fresh(); await initialize(prod, { pseudo: true, languages: ['en'] });
    assert.equal(prod.locale(), 'en');
    const i = await fresh(); await initialize(i, { pseudo: true, development: true });
    assert.equal(i.locale(), 'en-XA');
    const result = i.t('Channel {id}', { id: 'UNCHANGED-123' });
    assert.match(result, /^\[/); assert.match(result, /UNCHANGED-123\]$/);
    assert.ok(result.length > 'Channel UNCHANGED-123'.length);
    const node = {};
    assert.ok(i.tx('Use <b>this</b>', { b: () => node }).includes(node));
});

test('locale switch guards storage and reload at action time, serializes requests and permits retry', async () => {
    const i = await fresh(); await initialize(i, { languages: ['en'] });
    const originalStorage = globalThis.localStorage, originalWindow = globalThis.window;
    const calls = [];
    globalThis.localStorage = { setItem: (...args) => calls.push(args), getItem: () => 'en' };
    globalThis.window = { location: { reload: () => calls.push('reload') } };
    try {
        i.setLocaleChangeGuard(() => false);
        assert.equal(await i.setLocale('zh-CN'), false); assert.deepEqual(calls, []);
        let finish;
        i.setLocaleChangeGuard(() => new Promise(resolve => { finish = resolve; }));
        const pending = i.setLocale('zh-CN');
        assert.equal(await i.setLocale('zh-CN'), false); assert.deepEqual(calls, []);
        finish(false); await pending;
        i.setLocaleChangeGuard(() => true);
        globalThis.localStorage.setItem = () => { throw new Error('blocked storage'); };
        assert.equal(await i.setLocale('zh-CN'), false); assert.equal(i.isLocaleReloading(), false);
        globalThis.localStorage.setItem = (...args) => calls.push(args);
        assert.equal(await i.setLocale('unsupported'), false);
        assert.equal(await i.setLocale('zh-CN'), true);
        assert.deepEqual(calls, [['oie-locale', 'zh-CN'], 'reload']);
        assert.equal(i.locale(), 'en'); // page lifetime; next bootstrap chooses Chinese
        assert.equal(i.isLocaleReloading(), true);
    } finally { globalThis.localStorage = originalStorage; globalThis.window = originalWindow; }
});

test('localized number/list/collation follows the active locale', async () => {
    const i = await fresh(); await initialize(i);
    assert.equal(i.formatNumber(12345.6), new Intl.NumberFormat('zh-CN').format(12345.6));
    assert.equal(i.formatList(['甲', '乙']), new Intl.ListFormat('zh-CN').format(['甲', '乙']));
    assert.ok(i.compareText('channel 2', 'channel 10') < 0);
});

test('choosing the active fallback language repairs the preference without discarding work', async () => {
    const i = await fresh();
    await initialize(i, { storedLocale: 'zh-CN', loadCatalog: async () => { throw new Error('missing'); } });
    const previous = globalThis.localStorage;
    const writes = [];
    globalThis.localStorage = { setItem: (...args) => writes.push(args) };
    i.setLocaleChangeGuard(() => { throw new Error('must not discard a draft'); });
    try {
        assert.equal(await i.setLocale('en'), true);
        assert.deepEqual(writes, [['oie-locale', 'en']]);
        assert.equal(i.isLocaleReloading(), false);
    } finally { globalThis.localStorage = previous; }
});
