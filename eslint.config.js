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
// Shell uses the lenient boundary (it legitimately owns the core internals a
// plugin may not touch), so it reuses only the deep-import guard from the
// shared plugin config rather than the full strict ruleset.
import { noDeepPackageImports } from './packages/eslint-config/index.js';

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
        files: ['web-administrator/client/**/*.js', 'packages/*/index.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.browser },
        },
        rules: {
            'no-restricted-imports': ['error', noDeepPackageImports],
            'no-undef': 'warn',
            'no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true }],
        },
    },

    // Server + build/tooling + tests — node runtime.
    {
        files: [
            'web-administrator/server/**/*.js',
            'packages/**/vite.config.js',
            'web-administrator/vite.config.js',
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
