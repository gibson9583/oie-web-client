type PrimitiveType = string | number | bigint | boolean | null | undefined | Date;
type FormatXMLElementFn<T> = (parts: Array<string | T>) => string | T | Array<string | T>;
export type MessageValues = Record<string, unknown>;
export type Catalog = Record<string, string>;
export declare const locale: () => string;
export declare const locales: () => Array<{
    tag: string;
    name: string;
}>;
/** Script-aware negotiation: zh-Hant must never silently become zh-Hans. */
export declare function negotiateLocale(languages: readonly string[]): string;
export declare function readLocalePreference(): string | null;
/** Internal bootstrap API. The first call wins; late fetches cannot change the language. */
export declare function initializeI18n(options: {
    languages: readonly string[];
    storedLocale?: string | null;
    loadCatalog: (tag: string) => Promise<unknown>;
    pseudo?: boolean;
    development?: boolean;
    timeoutMs?: number;
}): Promise<void>;
/** Internal host hook: evaluate ALL dirty editors at action time, before persistence. */
export declare function setLocaleChangeGuard(guard: () => boolean | Promise<boolean>): void;
export declare function isLocaleReloading(): boolean;
/** Returns false when cancelled, already switching, unsupported, or storage is unavailable. */
export declare function setLocale(tag: string): Promise<boolean>;
/** Replace, rather than merge: reconnecting to another engine cannot retain its catalog. */
export declare function registerCatalog(pluginId: string, data?: unknown): void;
/** ICU contract used by both runtime fallback and the catalog CI check. */
export declare function messageSignature(nodes: readonly any[], out?: Set<string>): string;
export declare function t(message: string, values?: MessageValues): string;
export declare function tc(context: string, message: string, values?: MessageValues): string;
export declare function tx<T = never>(message: string, values: Record<string, PrimitiveType | T | FormatXMLElementFn<T>>): Array<string | T>;
export declare function scope(pluginId: string): {
    t: typeof t;
    tc: typeof tc;
    tx: typeof tx;
};
export declare function formatNumber(n: number, options?: Intl.NumberFormatOptions): string;
export declare function formatList(items: string[], options?: Intl.ListFormatOptions): string;
export declare function compareText(a: string, b: string): number;
export {};
