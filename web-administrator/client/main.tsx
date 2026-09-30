/// <reference types="vite/client" />
// No UI import may enter this static graph: registration captures translated labels.
import { initializeI18n, readLocalePreference } from './core/i18n.js';
const catalogs = import.meta.glob('./locales/zh-CN.json');
await initializeI18n({
    languages: navigator.languages,
    storedLocale: readLocalePreference(),
    development: import.meta.env.DEV || import.meta.env.MODE === 'i18n-test',
    pseudo: (import.meta.env.DEV || import.meta.env.MODE === 'i18n-test') && new URLSearchParams(location.search).get('locale') === 'en-XA',
    loadCatalog: async tag => (await catalogs[`./locales/${tag}.json`]() as { default: unknown }).default
});
await import('./app-main.jsx');
