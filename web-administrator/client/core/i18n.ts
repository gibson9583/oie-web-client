/*
 * Shared, page-lifetime i18n. The bootstrap loads this module and its catalog
 * BEFORE importing the application. Keep its static graph free of UI modules.
 * Engine values, user content, identifiers and exported data never enter t().
 */
import { IntlMessageFormat } from 'intl-messageformat';

// Keep the public plugin declarations independent of formatter package types.
type PrimitiveType = string | number | bigint | boolean | null | undefined | Date;
type FormatXMLElementFn<T> = (parts: Array<string | T>) => string | T | Array<string | T>;

export type MessageValues = Record<string, unknown>;
export type Catalog = Record<string, string>;
const shipped = [{ tag: 'en', name: 'English' }, { tag: 'zh-CN', name: '简体中文' }];
const catalogs = new Map<string, Catalog>();
const formatters = new Map<string, IntlMessageFormat>();
const validated = new Map<string, boolean>();
const warned = new Set<string>();
let active = 'en';
let development = false;
let initialized: Promise<void> | undefined;
let changeGuard: () => boolean | Promise<boolean> = () => true;
let changing = false;
let reloading = false;

export const locale = (): string => active;
export const locales = (): Array<{ tag: string; name: string }> => shipped.map(l => ({ ...l }));

/** Script-aware negotiation: zh-Hant must never silently become zh-Hans. */
export function negotiateLocale(languages: readonly string[]): string {
    for (const language of languages) {
        try {
            const exact = shipped.find(l => l.tag.toLowerCase() === language.toLowerCase());
            if (exact) return exact.tag;
            const candidate = new Intl.Locale(language).maximize();
            const match = shipped.find(l => {
                const supported = new Intl.Locale(l.tag).maximize();
                return candidate.language === supported.language && candidate.script === supported.script;
            });
            if (match) return match.tag;
        } catch { /* A malformed preference does not prevent boot. */ }
    }
    return 'en';
}

export function readLocalePreference(): string | null {
    try { return localStorage.getItem('oie-locale'); } catch { return null; }
}

function catalogFrom(value: unknown): Catalog {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid locale catalog');
    const result: Catalog = Object.create(null);
    for (const [key, entry] of Object.entries(value)) {
        if (typeof entry !== 'string') throw new Error('Invalid locale entry');
        result[key] = entry;
    }
    return result;
}

/** Internal bootstrap API. The first call wins; late fetches cannot change the language. */
export function initializeI18n(options: {
    languages: readonly string[];
    storedLocale?: string | null;
    loadCatalog: (tag: string) => Promise<unknown>;
    pseudo?: boolean;
    development?: boolean;
    timeoutMs?: number;
}): Promise<void> {
    if (initialized) return initialized;
    initialized = (async () => {
        development = !!options.development;
        active = options.pseudo && development ? 'en-XA'
            : shipped.some(l => l.tag === options.storedLocale) ? options.storedLocale!
                : negotiateLocale(options.languages);
        if (active !== 'en' && active !== 'en-XA') {
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                const data = await Promise.race([
                    options.loadCatalog(active),
                    new Promise<never>((_, reject) => {
                        timer = setTimeout(() => reject(new Error('Locale catalog timed out')), options.timeoutMs ?? 2000);
                    })
                ]);
                catalogs.set('', catalogFrom(data));
            } catch (error) {
                console.warn('[i18n] Catalog unavailable; using English.', error);
                active = 'en';
            } finally { clearTimeout(timer); }
        }
        if (typeof document !== 'undefined') document.documentElement.lang = active;
    })();
    return initialized;
}

/** Internal host hook: evaluate ALL dirty editors at action time, before persistence. */
export function setLocaleChangeGuard(guard: () => boolean | Promise<boolean>): void { changeGuard = guard; }
export function isLocaleReloading(): boolean { return reloading; }

/** Returns false when cancelled, already switching, unsupported, or storage is unavailable. */
export async function setLocale(tag: string): Promise<boolean> {
    if (!shipped.some(l => l.tag === tag) || changing) return false;
    if (tag === active) {
        // Repair a stored preference whose catalog failed during bootstrap.
        // The current page already uses this language, so no reload or discard.
        try { localStorage.setItem('oie-locale', tag); return true; } catch { return false; }
    }
    changing = true;
    try {
        if (!await changeGuard()) return false;
        // A cancelled guard never updates the browser's preference.
        localStorage.setItem('oie-locale', tag);
        reloading = true;
        window.location.reload();
        return true;
    } catch (error) {
        reloading = false;
        console.warn('[i18n] Could not save language preference.', error);
        return false;
    } finally { changing = false; }
}

/** Replace, rather than merge: reconnecting to another engine cannot retain its catalog. */
export function registerCatalog(pluginId: string, data?: unknown): void {
    catalogs.delete(pluginId);
    if (data !== undefined) catalogs.set(pluginId, catalogFrom(data));
}

function warnOnce(key: string): void {
    if (!development || warned.has(key)) return;
    warned.add(key);
    console.warn('[i18n] Invalid message or missing argument:', key);
}

function pseudoAst(nodes: any[]): any[] {
    const plain = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const accent = 'àƀçðéƒĝĥîĵķļɱñöþɋŕšţûṽŵẋýžÀɃÇÐÉƑĜĤÎĴĶĻṀÑÖÞɊŔŠŢÛṼŴẊÝŽ';
    return nodes.map(node => {
        if (node.type === 0) return { ...node, value: node.value.replace(/[a-z]/gi, (c: string) => accent[plain.indexOf(c)]) + '~'.repeat(Math.ceil(node.value.replace(/\s/g, '').length * 0.35)) };
        if (node.options) return { ...node, options: Object.fromEntries(Object.entries(node.options).map(([k, v]: [string, any]) => [k, { ...v, value: pseudoAst(v.value) }])) };
        if (node.children) return { ...node, children: pseudoAst(node.children) };
        return node;
    });
}

function format(message: string, values: MessageValues | undefined, language: string, rich: boolean): unknown {
    const key = JSON.stringify([language, rich, message]);
    let formatter = formatters.get(key);
    if (!formatter) {
        formatter = new IntlMessageFormat(message, language === 'en-XA' ? 'en' : language, undefined, { ignoreTag: !rich });
        if (language === 'en-XA') formatter = new IntlMessageFormat(pseudoAst(formatter.getAst()), 'en');
        formatters.set(key, formatter);
    }
    const output = formatter.format<unknown>(values);
    if (language !== 'en-XA') return output;
    return Array.isArray(output) ? ['[', ...output, ']'] : typeof output === 'string' ? '[' + output + ']' : ['[', output, ']'];
}

/** ICU contract used by both runtime fallback and the catalog CI check. */
export function messageSignature(nodes: readonly any[], out = new Set<string>()): string {
    for (const node of nodes) {
        if (node.type !== 0 && node.type !== 7) out.add(node.type + ':' + node.value + (node.type === 6 ? ':' + node.pluralType + ':' + node.offset : ''));
        if (node.options) {
            if (node.type === 5) out.add('select:' + node.value + ':' + Object.keys(node.options).sort().join(','));
            if (node.type === 6) out.add('exact:' + node.value + ':' + Object.keys(node.options).filter(k => k.startsWith('=')).sort().join(','));
            for (const option of Object.values(node.options) as any[]) messageSignature(option.value, out);
        }
        if (node.children) messageSignature(node.children, out);
    }
    return [...out].sort().join('|');
}

function compatible(source: string, translated: string, rich: boolean): boolean {
    const key = JSON.stringify([source, translated, rich]);
    if (!validated.has(key)) {
        try {
            const options = { ignoreTag: !rich };
            const a = new IntlMessageFormat(source, 'en', undefined, options).getAst();
            const b = new IntlMessageFormat(translated, active, undefined, options).getAst();
            validated.set(key, messageSignature(a) === messageSignature(b));
        } catch { validated.set(key, false); }
    }
    return validated.get(key)!;
}

function translate(pluginId: string, context: string, message: string, values: MessageValues | undefined, rich: boolean): unknown {
    const key = context ? context + '\u0004' + message : message;
    const candidates = pluginId ? [catalogs.get(pluginId)?.[key], catalogs.get('')?.[key]] : [catalogs.get('')?.[key]];
    for (const translated of candidates) {
        if (translated === undefined || active === 'en' || active === 'en-XA') continue;
        try {
            if (compatible(message, translated, rich)) return format(translated, values, active, rich);
            warnOnce(key);
        } catch { warnOnce(key); }
    }
    try { return format(message, values, active === 'en-XA' ? active : 'en', rich); }
    catch { warnOnce(key); return message; }
}

export function t(message: string, values?: MessageValues): string {
    return String(translate('', '', message, values, false));
}
export function tc(context: string, message: string, values?: MessageValues): string {
    return String(translate('', context, message, values, false));
}
export function tx<T = never>(message: string, values: Record<string, PrimitiveType | T | FormatXMLElementFn<T>>): Array<string | T> {
    const output = translate('', '', message, values, true);
    return (Array.isArray(output) ? output : [output]) as Array<string | T>;
}
export function scope(pluginId: string): { t: typeof t; tc: typeof tc; tx: typeof tx } {
    return {
        t: (message, values) => String(translate(pluginId, '', message, values, false)),
        tc: (context, message, values) => String(translate(pluginId, context, message, values, false)),
        tx: (<T>(message: string, values: MessageValues) => {
            const output = translate(pluginId, '', message, values, true);
            return (Array.isArray(output) ? output : [output]) as Array<string | T>;
        })
    };
}

const numbers = new Map<string, Intl.NumberFormat>();
export function formatNumber(n: number, options?: Intl.NumberFormatOptions): string {
    const key = JSON.stringify([active, options]);
    if (!numbers.has(key)) numbers.set(key, new Intl.NumberFormat(active, options));
    return numbers.get(key)!.format(n);
}
export function formatList(items: string[], options?: Intl.ListFormatOptions): string {
    return new Intl.ListFormat(active, options).format(items);
}
let collator: Intl.Collator | undefined;
let collatorLocale: string | undefined;
export function compareText(a: string, b: string): number {
    if (collatorLocale !== active) {
        collator = new Intl.Collator(active, { numeric: true, sensitivity: 'base' });
        collatorLocale = active;
    }
    return collator!.compare(a, b);
}
