/*
 * Configuration loader for the OIE Web Administrator.
 *
 * Resolution order (later wins):
 *   1. Built-in defaults
 *   2. ONE config document: WEBADMIN_CONFIG_JSON (inline JSON), else the file
 *      named by WEBADMIN_CONFIG, else config.json in the project root (optional)
 *   3. Environment variables (the per-setting overrides below)
 *
 * Environment variables:
 *   WEBADMIN_CONFIG      Path to the config JSON document (absolute, or resolved
 *                        against the working directory) — the full surface:
 *                        engine/allowedUrls, tls, pluginDirs, plugin settings.
 *                        Lets a container mount the config anywhere. Startup
 *                        fails if the file is missing or invalid.
 *   WEBADMIN_CONFIG_JSON The config JSON document itself, passed inline (e.g. an
 *                        orchestrator-injected env var or secret). Takes
 *                        precedence over WEBADMIN_CONFIG. Startup fails on
 *                        invalid JSON.
 *   WEBADMIN_PORT        Port the web administrator listens on (default 3030)
 *   WEBADMIN_HOST        Bind address (default 0.0.0.0)
 *   OIE_URL              Base URL of the engine, e.g. https://localhost:8443
 *   OIE_VERIFY_TLS       "true" to verify the engine's TLS certificate (default false,
 *                        engines ship with self-signed certs)
 *   WEBADMIN_DEV_MODE    "true" to let a user type an arbitrary engine URL at login
 *                        (a manual URL field). Trusted/dev deployments only — the
 *                        proxy will forward to whatever host is entered. Default false.
 *   WEBADMIN_PLUGIN_DIRS Additional local plugin directories (':'-separated) scanned
 *                        alongside the bundled ./plugins (e.g. for local development).
 *   WEBADMIN_CODE_TEMPLATE_COMPLETIONS
 *                        "false" to disable code-template autocompletion in the
 *                        script editors (avoids fetching large catalogs).
 *   WEBADMIN_TRUSTED_PROXIES
 *                        Comma-separated peer IPs trusted to set X-Forwarded-For
 *                        (loopback is always trusted). Default none.
 *   WEBADMIN_TLS_KEY / WEBADMIN_TLS_CERT / WEBADMIN_TLS_PASSPHRASE
 *                        PEM key + cert (and optional passphrase) to serve the UI
 *                        over HTTPS directly. Both key and cert required to enable;
 *                        default is plain HTTP (terminate TLS at a reverse proxy).
 */

import * as fs from 'fs';
import * as path from 'path';

export interface EngineEntry { name?: string | null; url: string; verifyTls?: boolean; }
export interface ResolvedEngine { name: string; key: string; url: string; verifyTls: boolean; }
export interface TlsConfig { key: string; cert: string; passphrase?: string; }
export interface OidcProviderConfig {
    enabled: boolean;
    discoveryUrl?: string;
    clientId?: string;
    clientSecret: string;
    scopes: string[];
    providerLabel: string;
    autoRedirect: boolean;
    endSession?: boolean;
}

/** The resolved runtime configuration (defaults + config.json + env). */
export interface WebAdminConfig {
    port: number;
    host: string;
    engine: { url: string; verifyTls: boolean };
    allowedUrls: EngineEntry[];
    devMode: boolean;
    codeTemplateCompletions: boolean;
    trustedProxies: string[];
    tls: TlsConfig | null;
    pluginDirs: string[];
    engines: ResolvedEngine[];
    oidc: Record<string, OidcProviderConfig>;
    root: string;
    /** config.json is user-authored and may carry extra keys (e.g. plugin-specific
        settings); `unknown` keeps that openness while forcing readers to narrow. */
    [key: string]: unknown;
}

const ROOT = path.resolve(__dirname, '..');

const defaults = {
    port: 3030,
    host: '0.0.0.0',
    engine: {
        // Base URL of the Open Integration Engine REST API host — the CURRENT/default
        // engine (used when the client hasn't selected one).
        url: 'https://127.0.0.1:8443',
        // Engines ship with self-signed certificates; verification is opt-in.
        verifyTls: false
    },
    // Selectable engines shown as a login dropdown (by `name`). Each entry:
    // { name, url, verifyTls? }. Empty → single-engine mode (just engine.url, no
    // picker). verifyTls falls back to engine.verifyTls when omitted.
    allowedUrls: [],
    // Let a user type an arbitrary engine URL at login (a manual URL field). The
    // proxy forwards to whatever is entered, so this is for trusted/dev deployments
    // only. Default false. (Distinct from WEBADMIN_DEV=1, which is Vite HMR.)
    devMode: false,
    // Offer the channel's own Code Template functions as autocompletions in the
    // script editors (scoped to the channel + editor context). This fetches the
    // full code-template library set; on servers with very large catalogs an
    // admin may want to turn it off. Default on.
    codeTemplateCompletions: true,
    // Peer IPs trusted to set X-Forwarded-For (a front TLS terminator / reverse
    // proxy). Loopback is always trusted; list a non-loopback front proxy here.
    // Requests from untrusted peers can't spoof the engine's audit-log client IP.
    trustedProxies: [],
    // Optional built-in TLS for the browser <-> web admin hop. Off by default
    // (plain HTTP) — most deployments terminate TLS at a reverse proxy. Set
    // { key, cert, passphrase? } (PEM file paths, relative to the app root or
    // absolute) to serve HTTPS directly; both key and cert are required.
    tls: null
};

export function load(): WebAdminConfig {
    const config: any = JSON.parse(JSON.stringify(defaults));

    // ONE config document feeds this layer: inline JSON (WEBADMIN_CONFIG_JSON),
    // else an explicit file (WEBADMIN_CONFIG), else the optional ./config.json.
    // Explicit sources fail hard — a typo'd path or bad JSON must not silently
    // boot a default-configured server. Relative paths inside the document
    // (tls.key/cert, pluginDirs) resolve against the app root regardless of
    // where the document came from, so mounted configs should use absolute paths.
    let doc: any = null;
    if (process.env.WEBADMIN_CONFIG_JSON) {
        if (process.env.WEBADMIN_CONFIG)
            console.error('[config] WEBADMIN_CONFIG_JSON is set — ignoring WEBADMIN_CONFIG');
        try {
            doc = JSON.parse(process.env.WEBADMIN_CONFIG_JSON);
        } catch (e) {
            console.error(`[config] Failed to parse WEBADMIN_CONFIG_JSON: ${(e as Error).message}`);
            process.exit(1);
        }
    } else {
        const explicit = process.env.WEBADMIN_CONFIG;
        const configFile = explicit ? path.resolve(explicit) : path.join(ROOT, 'config.json');
        if (explicit || fs.existsSync(configFile)) {
            try {
                doc = JSON.parse(fs.readFileSync(configFile, 'utf8'));
            } catch (e) {
                console.error(`[config] Failed to read ${configFile}: ${(e as Error).message}`);
                process.exit(1);
            }
        }
    }
    if (doc) {
        Object.assign(config, doc, {
            engine: Object.assign({}, config.engine, doc.engine || {})
        });
    }

    if (process.env.WEBADMIN_PORT) config.port = parseInt(process.env.WEBADMIN_PORT, 10);
    if (process.env.WEBADMIN_HOST) config.host = process.env.WEBADMIN_HOST;
    if (process.env.OIE_URL) config.engine.url = process.env.OIE_URL;
    if (process.env.OIE_VERIFY_TLS) config.engine.verifyTls = process.env.OIE_VERIFY_TLS === 'true';
    if (process.env.WEBADMIN_DEV_MODE) config.devMode = process.env.WEBADMIN_DEV_MODE === 'true';
    if (process.env.WEBADMIN_CODE_TEMPLATE_COMPLETIONS) config.codeTemplateCompletions = process.env.WEBADMIN_CODE_TEMPLATE_COMPLETIONS === 'true';
    if (process.env.WEBADMIN_TRUSTED_PROXIES) config.trustedProxies = process.env.WEBADMIN_TRUSTED_PROXIES.split(',').map(s => s.trim()).filter(Boolean);

    // Optional built-in TLS (config.json "tls" or the env vars below). Enabled only
    // when BOTH key and cert are given; paths resolve against the app root. Off →
    // plain HTTP. The server reads the PEM files at startup (index.js).
    const tls = Object.assign({}, config.tls);
    if (process.env.WEBADMIN_TLS_KEY) tls.key = process.env.WEBADMIN_TLS_KEY;
    if (process.env.WEBADMIN_TLS_CERT) tls.cert = process.env.WEBADMIN_TLS_CERT;
    if (process.env.WEBADMIN_TLS_PASSPHRASE) tls.passphrase = process.env.WEBADMIN_TLS_PASSPHRASE;
    config.tls = (tls.key && tls.cert)
        ? { key: path.resolve(ROOT, tls.key), cert: path.resolve(ROOT, tls.cert), passphrase: tls.passphrase || undefined }
        : null;

    // Plugin SEARCH list: the shipped first-party (bundled framework) plugins in
    // ./plugins — ALWAYS scanned — plus any extra LOCAL dirs from config.json
    // ("pluginDirs": [...]) or WEBADMIN_PLUGIN_DIRS (ROOT-anchored). Extensions
    // installed on the engine are served by the engine itself (GET /api/webplugins),
    // not stored here. De-duped.
    const extra = ([] as string[])
        .concat(Array.isArray(config.pluginDirs) ? config.pluginDirs : [])
        .concat(process.env.WEBADMIN_PLUGIN_DIRS ? process.env.WEBADMIN_PLUGIN_DIRS.split(path.delimiter) : [])
        .filter(Boolean)
        .map((p: string) => path.resolve(ROOT, p));
    config.pluginDirs = [...new Set([path.join(ROOT, 'plugins'), ...extra])];

    // Normalize the selectable engine list. `allowedUrls` (when set) is the picker;
    // otherwise the single default engine. Each entry gets a display name (falling
    // back to the URL host), a stable key derived from that name (what the client
    // remembers and the proxy routes by — NOT the entry's position, so editing the
    // list can't silently repoint an existing selection), and a verifyTls (falling
    // back to the default engine's). Invalid URLs are dropped with a warning;
    // colliding keys fail startup (same posture as a broken config document).
    try {
        config.engines = buildEngines(config);
    } catch (e) {
        console.error(`[config] ${(e as Error).message}`);
        process.exit(1);
    }

    // Operators key OIDC providers by the engine's explicit name; normalizeOidc
    // re-keys them to the engine's stable key, which is what routing carries, so
    // identity policy cannot move when allowedUrls is reordered. A single set of
    // env overrides configures the default engine.
    config.oidc = normalizeOidc(config.oidc, config.engines);

    config.root = ROOT;
    return config;
}

function envBoolean(name: string, fallback: boolean): boolean {
    const value = process.env[name];
    if (value == null) return fallback;
    if (value !== 'true' && value !== 'false') throw new Error(`[config] ${name} must be "true" or "false"`);
    return value === 'true';
}

export function normalizeOidc(raw: unknown, engines: ResolvedEngine[]): Record<string, OidcProviderConfig> {
    if (raw != null && (typeof raw !== 'object' || Array.isArray(raw))) throw new Error('[config] oidc must be an object keyed by engine name');
    const source: Record<string, any> = { ...((raw || {}) as object) };
    const envPresent = ['WEBADMIN_OIDC_DISCOVERY_URL', 'WEBADMIN_OIDC_CLIENT_ID', 'WEBADMIN_OIDC_CLIENT_SECRET',
        'WEBADMIN_OIDC_ENABLED', 'WEBADMIN_OIDC_SCOPES', 'WEBADMIN_OIDC_PROVIDER_LABEL', 'WEBADMIN_OIDC_AUTO_REDIRECT']
        .some((name) => process.env[name] != null);
    if (envPresent) {
        const first = engines[0]?.name || '0';
        const previous = source[first] || {};
        source[first] = {
            ...previous,
            enabled: envBoolean('WEBADMIN_OIDC_ENABLED', previous.enabled !== false),
            discoveryUrl: process.env.WEBADMIN_OIDC_DISCOVERY_URL ?? previous.discoveryUrl,
            clientId: process.env.WEBADMIN_OIDC_CLIENT_ID ?? previous.clientId,
            clientSecret: process.env.WEBADMIN_OIDC_CLIENT_SECRET ?? previous.clientSecret,
            scopes: process.env.WEBADMIN_OIDC_SCOPES ? process.env.WEBADMIN_OIDC_SCOPES.split(/[ ,]+/).filter(Boolean) : previous.scopes,
            providerLabel: process.env.WEBADMIN_OIDC_PROVIDER_LABEL ?? previous.providerLabel,
            autoRedirect: envBoolean('WEBADMIN_OIDC_AUTO_REDIRECT', !!previous.autoRedirect)
        };
    }
    // The config DOCUMENT is keyed by human engine name — that is what an operator
    // writes and what the errors below name. The map returned here is keyed by the
    // engine's stable key instead, because every runtime lookup arrives holding a
    // key (the oie-engine cookie, /oidc/start?engine=, the sealed transaction) and
    // resolving name→key once here keeps that translation out of the request path.
    const out: Record<string, OidcProviderConfig> = {};
    const keyByName = new Map(engines.map((engine) => [engine.name, engine.key]));
    if (Object.keys(source).length && keyByName.size !== engines.length)
        throw new Error('[config] configured engine names must be unique when OIDC is enabled');
    for (const [key, value] of Object.entries(source)) {
        if (!keyByName.has(key)) throw new Error(`[config] oidc.${key} does not match a configured engine name`);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`[config] oidc.${key} must be an object`);
        const enabled = value.enabled !== false;
        if (!enabled) continue;
        for (const field of ['clientSecret']) {
            if (typeof value[field] !== 'string' || !value[field].trim()) throw new Error(`[config] oidc.${key}.${field} is required when enabled`);
        }
        let discovery: URL | undefined;
        if (value.discoveryUrl) {
            try { discovery = new URL(value.discoveryUrl); } catch { throw new Error(`[config] oidc.${key}.discoveryUrl must be an absolute URL`); }
            if (discovery.protocol !== 'https:' && discovery.hostname !== 'localhost' && discovery.hostname !== '127.0.0.1')
                throw new Error(`[config] oidc.${key}.discoveryUrl must use HTTPS (HTTP is allowed only for localhost)`);
        }
        const scopes = value.scopes == null ? ['openid', 'profile', 'email']
            : (Array.isArray(value.scopes) ? value.scopes.map(String) : String(value.scopes).split(/[ ,]+/)).filter(Boolean);
        if (!scopes.includes('openid')) scopes.unshift('openid');
        out[keyByName.get(key)!] = { enabled, discoveryUrl: discovery?.toString(), clientId: value.clientId ? String(value.clientId) : undefined,
            clientSecret: value.clientSecret, scopes, providerLabel: String(value.providerLabel || 'SSO'),
            autoRedirect: !!value.autoRedirect, endSession: !!value.endSession };
    }
    return out;
}

export function oidcForEngine(config: WebAdminConfig, engineKey: string): OidcProviderConfig | null {
    return config.oidc[engineKey] || null;
}

// Derive a readable label from a URL, e.g. "https://oie-prod:8443/" -> "oie-prod:8443".
function engineLabel(url: string): string {
    try { return new URL(url).host; } catch { return String(url); }
}

// Stable identity for an engine, slugified from its display name — "Prod (US)" →
// "k:prod-us". The remembered login choice and the proxy's routing use this key
// rather than the entry's index into allowedUrls, so reordering or inserting
// entries cannot silently change what a saved choice means; renaming an engine
// changes its key, which correctly reads as "that entry is gone" (issue #53).
// The "k:" prefix keeps a key unambiguous from a pre-key cookie, which held a
// bare index — even for an engine literally named "2024".
function engineKey(name: string): string {
    // NFKC first: the same visible name must yield the same key whether the
    // config document stores it composed or decomposed (é as one codepoint or
    // two) — otherwise a byte-level re-save of an unchanged name would silently
    // invalidate every remembered selection for it.
    return 'k:' + name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
}

// Takes only the slice it reads: it runs inside load() BEFORE the full
// WebAdminConfig exists (engines/root are not resolved yet), so claiming the
// whole interface here would be a lie that happens to compile.
export function buildEngines(config: Pick<WebAdminConfig, 'engine' | 'allowedUrls'>): ResolvedEngine[] {
    const raw = Array.isArray(config.allowedUrls) && config.allowedUrls.length
        ? config.allowedUrls
        : [{ name: null, url: config.engine.url, verifyTls: config.engine.verifyTls }];

    const engines: ResolvedEngine[] = [];
    for (const e of raw) {
        if (!e || !e.url) continue;
        let url: URL;
        try {
            url = new URL(String(e.url));
            if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('scheme');
        } catch {
            console.error(`[config] ignoring engine with invalid url: ${e && e.url}`);
            continue;
        }
        const name = (e.name && String(e.name).trim()) || engineLabel(e.url);
        engines.push({
            name,
            key: engineKey(name),
            url: url.origin + url.pathname.replace(/\/$/, ''),
            verifyTls: e.verifyTls != null ? !!e.verifyTls : !!config.engine.verifyTls
        });
    }
    // Always have at least the default engine so the proxy can route.
    if (!engines.length) {
        const name = engineLabel(config.engine.url);
        engines.push({ name, key: engineKey(name), url: config.engine.url, verifyTls: !!config.engine.verifyTls });
    }
    // Keys must be unique — a collision would silently merge two engines under one
    // remembered choice. Deterministic disambiguation (e.g. a -2 suffix) would be
    // order-dependent, which is the positional bug all over again, so fail loudly.
    const byKey = new Map<string, string>();
    for (const eng of engines) {
        const prior = byKey.get(eng.key);
        if (prior != null) {
            throw new Error(`allowedUrls entries "${prior}" and "${eng.name}" both resolve to the key "${eng.key}" — only letters and digits count toward the key, so give each engine a name that differs in those`);
        }
        byKey.set(eng.key, eng.name);
    }
    return engines;
}
