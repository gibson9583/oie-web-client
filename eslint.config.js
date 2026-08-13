/*
 * Monorepo ESLint config (flat). Two jobs:
 *
 *  1. Enforce the @oie/* package boundary — nobody imports a package's deep
 *     internals; everyone goes through the public entry. This is the contract
 *     the single-instance runtime model depends on.
 *  2. Basic hygiene — catch undefined references and unused code (the class of
 *     bug `node --check` silently misses, e.g. an unbalanced paren in an ES
 *     module). Warnings, so they surface without blocking.
 *
 * The plugin-author boundary (external plugins may use ONLY @oie/*, never shell
 * internals) ships separately from ./packages/eslint-config so plugin repos can
 * extend it. See that package's README.
 */
import globals from 'globals';
import babelParser from '@babel/eslint-parser';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
// Shell uses the lenient boundary (it legitimately owns the core internals a
// plugin may not touch), so it reuses only the deep-import guard from the
// shared plugin config rather than the full strict ruleset.
import { noDeepPackageImports } from './packages/eslint-config/index.js';

/* TypeScript sources are linted through the Babel parser (syntax-only — the
   type checking itself is tsc's job via `npm run typecheck`). typescript-eslint
   is not an option while the repo compiles with TypeScript 7 (its parser peers
   on <= 6). This restores the react-hooks rules the .jsx -> .tsx move would
   otherwise have lost; no-undef/no-unused-vars stay off here because scope
   analysis over type annotations false-positives — tsc covers both. */
const tsLanguageOptions = {
    parser: babelParser,
    parserOptions: {
        requireConfigFile: false,
        babelOptions: { presets: ['@babel/preset-typescript'] },
    },
    globals: { ...globals.browser },
};
// .tsx needs JSX enabled explicitly; kept OFF for .ts, where `<T>(...)` generic
// arrows would otherwise parse as JSX.
const tsxLanguageOptions = {
    parser: babelParser,
    parserOptions: {
        requireConfigFile: false,
        babelOptions: { presets: ['@babel/preset-typescript'], plugins: ['@babel/plugin-syntax-jsx'] },
    },
    globals: { ...globals.browser },
};

export default [
    {
        ignores: [
            '**/node_modules/**',
            '**/dist/**',
            'web-administrator/client/assets/**', // vendored (Monaco, fonts)
            'web-administrator/client/vendor/**',  // vendored third-party libs (zip.js)
            'web-administrator/client/core/userapi.generated.js', // generated User API .d.ts string
        ],
    },

    // Shell app + framework source — browser runtime.
    {
        files: ['web-administrator/client/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.browser },
        },
        // The generated .js twins of the TypeScript sources carry over
        // eslint-disable comments for react-hooks rules; the plugin must be
        // present for those rule names to resolve.
        plugins: { 'react-hooks': reactHooks },
        rules: {
            'no-restricted-imports': ['error', noDeepPackageImports],
            'no-undef': 'warn',
            'no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true }],
        },
    },

    // React shell/views + datatypes (.tsx/.ts, automatic JSX runtime) — the
    // hooks rules guard the same effect-deps/once-only-setup bugs they did on
    // the .jsx sources.
    {
        files: ['web-administrator/client/react/**/*.tsx', 'web-administrator/client/datatypes/*.tsx', 'web-administrator/client/main.tsx'],
        languageOptions: tsxLanguageOptions,
        plugins: { react, 'react-hooks': reactHooks },
        settings: { react: { version: 'detect' } },
        rules: {
            'no-restricted-imports': ['error', noDeepPackageImports],
            'react/jsx-uses-vars': 'error',
            'react/jsx-key': 'warn',
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'warn',
        },
    },

    // Raw-served TypeScript core + connector panels + bundled plugin sources
    // (classic JSX runtime against the lazy host React), plus the @oie/*
    // package barrels — the public entries third-party plugins import.
    {
        files: ['web-administrator/client/react/**/*.ts', 'web-administrator/client/datatypes/*.ts', 'web-administrator/client/core/*.ts', 'web-administrator/client/connectors/*.ts', 'web-administrator/plugins/*/web/*.ts', 'packages/*/index.ts'],
        ignores: ['**/*.d.ts'],
        languageOptions: tsLanguageOptions,
        plugins: { 'react-hooks': reactHooks },
        rules: {
            'no-restricted-imports': ['error', noDeepPackageImports],
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'warn',
        },
    },

    // Raw-served connector panels + bundled plugin sources (.tsx, classic JSX
    // runtime against the lazy host React).
    {
        files: ['web-administrator/client/connectors/*.tsx', 'web-administrator/plugins/*/web/*.tsx'],
        languageOptions: tsxLanguageOptions,
        plugins: { react, 'react-hooks': reactHooks },
        settings: { react: { version: 'detect' } },
        rules: {
            'no-restricted-imports': ['error', noDeepPackageImports],
            'react/jsx-uses-vars': 'error',
            'react/jsx-uses-react': 'error',
            'react/jsx-key': 'warn',
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'warn',
        },
    },

    /* Compare Messages handles stored message content, which must never reach
       disk: no browser storage in the modules that touch it, generated .js twins
       included. Cheap insurance against a future edit that adds a "remember the
       last comparison" convenience — see the PHI notes in core/compare.ts. */
    {
        files: [
            'web-administrator/client/core/compare.{ts,js}',
            'web-administrator/client/react/compare-*.{tsx,ts,js}',
        ],
        rules: {
            'no-restricted-globals': ['error',
                { name: 'localStorage', message: 'Compare Messages must never persist content or references — memory only.' },
                { name: 'sessionStorage', message: 'Compare Messages must never persist content or references — memory only.' },
                { name: 'indexedDB', message: 'Compare Messages must never persist content or references — memory only.' },
                { name: 'caches', message: 'Compare Messages must never persist content or references — memory only.' },
            ],
            'no-restricted-properties': ['error',
                { object: 'window', property: 'localStorage', message: 'Compare Messages must never persist content or references — memory only.' },
                { object: 'window', property: 'sessionStorage', message: 'Compare Messages must never persist content or references — memory only.' },
                { object: 'window', property: 'indexedDB', message: 'Compare Messages must never persist content or references — memory only.' },
                { object: 'window', property: 'caches', message: 'Compare Messages must never persist content or references — memory only.' },
            ],
        },
    },

    // Server + build/tooling + tests — node runtime.
    {
        files: [
            'web-administrator/server/**/*.js',
            'eslint.config.js',
            '**/*.test.js',
        ],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.node },
        },
        rules: {
            'no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true }],
        },
    },
];
