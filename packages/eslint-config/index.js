/*
 * @oie/eslint-config — shared ESLint flat config for OIE web-admin plugins.
 *
 * Exports:
 *  - default: a ready-to-use flat config for a plugin repo (strict boundary —
 *    a plugin may reach the web-admin framework ONLY through the @oie/* public
 *    API, never through shell internals).
 *  - noDeepPackageImports: the deep-import guard, reused by the monorepo's own
 *    (more lenient) root config.
 */
import globals from 'globals';

// Everyone, everywhere: use "@oie/web-ui", never "@oie/web-ui/dist/...".
export const noDeepPackageImports = {
    patterns: [{
        group: ['@oie/web-api/*', '@oie/web-ui/*', '@oie/web-shell/*'],
        message: 'Import the public package entry (e.g. "@oie/web-ui"), not a deep path into the package.',
    }],
};

// Stricter, for external plugins: the @oie/* public API is the only way to the
// framework. Reaching into web-admin shell internals breaks the single-instance
// contract and couples the plugin to private code.
const pluginBoundary = {
    patterns: [
        ...noDeepPackageImports.patterns,
        {
            // Shell internals are off-limits however the path is spelled: a
            // relative reach into the web-admin source tree, or the bundled
            // absolute-URL form (/core/*, /connectors/*, /views/*). ESLint matches
            // an absolute "/core/api.js" only via "**/core/**" (a leading-slash
            // pattern won't), so we glob whole directories rather than the three
            // named files the old rule listed — that's where store.js, router.js,
            // serialize.js, etc. slipped through. Plugins use @oie/* only.
            group: [
                '**/web-administrator/**',
                '**/core/**',
                '**/connectors/**',
                '**/views/**',
            ],
            message: 'Plugins must use the @oie/* public API, not web-admin shell internals.',
        },
    ],
};

// Drop-in flat config for a plugin repo:
//   import oie from '@oie/eslint-config';
//   export default oie;
export default [
    {
        ignores: ['**/node_modules/**', '**/dist/**'],
    },
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.browser },
        },
        rules: {
            'no-restricted-imports': ['error', pluginBoundary],
            'no-undef': 'warn',
            'no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true }],
        },
    },
];
