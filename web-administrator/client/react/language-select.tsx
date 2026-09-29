import { locale, locales, setLocale, t } from '../core/i18n.js';

/** Controlled by the page locale; cancellation restores the current selection. */
export function LanguageSelect() {
    return <select data-language-select aria-label={t('Language')} value={locale()} onChange={async e => {
        const input = e.currentTarget;
        const changed = await setLocale(input.value);
        if (!changed) input.value = locale();
    }}>
        {locales().map(language => <option key={language.tag} value={language.tag} lang={language.tag}>{language.name}</option>)}
    </select>;
}
