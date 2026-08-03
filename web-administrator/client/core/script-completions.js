/*
 * Channel + context scoped code-template completions for the script editors —
 * the web equivalent of the Swing "References" that surface a channel's code
 * template functions. A template's function is offered when its library is
 * linked to the current channel AND the template's context set includes the
 * current editor's context (e.g. a source transformer → SOURCE_FILTER_TRANSFORMER).
 *
 * A script editor sets the active scope on focus (via mountMonaco); the Monaco
 * completion provider reads getActiveCompletions() synchronously.
 */
import api from './api.js';
import { getState } from './store.js';

const asList = api.asList;

/* Server toggle (config.json "codeTemplateCompletions"): disabling it avoids
   fetching the whole code-template catalog on servers with very large sets.
   Default on — treat an absent/older config as enabled. */
function completionsEnabled() {
    const cfg = getState('webadminConfig');
    return !cfg || cfg.codeTemplateCompletions !== false;
}

let librariesPromise = null;

/** Force a refetch (call after the user edits Code Templates). */
export function invalidate() { librariesPromise = null; }

function loadLibraries() {
    if (!librariesPromise) {
        librariesPromise = api.codeTemplates.libraries(true).catch((e) => {
            // Don't cache a transient failure — retry on the next focus instead
            // of going silently empty for the whole session.
            librariesPromise = null;
            console.warn('[script-completions] could not load code templates:', e && e.message);
            return [];
        });
    }
    return librariesPromise;
}

const idSet = (v) => asList(v, 'string').map(String);
const templatesOf = (lib) => asList(lib.codeTemplates, 'codeTemplate').filter((t) => t && typeof t === 'object');
const contextsOf = (t) => asList(t.contextSet && t.contextSet.delegate, 'contextType').map(String);

function libraryInScope(lib, channelId) {
    if (idSet(lib.enabledChannelIds).includes(channelId)) return true;
    return !!lib.includeNewChannels && !idSet(lib.disabledChannelIds).includes(channelId);
}

/* A FUNCTION template's code → { name, params, doc } (its signature + leading
   JSDoc), or null when there's no parseable `function name(...)`. */
function parseFunction(template) {
    const code = String((template.properties && template.properties.code) || '');
    const fn = code.match(/function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/);
    if (!fn) return null;
    const params = fn[2].split(',').map((p) => p.trim()).filter(Boolean);
    const doc = (code.match(/\/\*\*([\s\S]*?)\*\//) || [, ''])[1]
        .split('\n').map((l) => l.replace(/^\s*\*?\s?/, '').trimEnd()).filter(Boolean).join('\n');
    return { name: fn[1], params, doc, library: '' };
}

/** The in-scope code-template functions for a channel + editor contexts. */
export async function templatesInScope(channelId, contexts) {
    const ctx = new Set(contexts);
    const out = [];
    const seen = new Set();
    for (const lib of asList(await loadLibraries())) {
        if (!libraryInScope(lib, String(channelId))) continue;
        for (const t of templatesOf(lib)) {
            const type = t.properties && t.properties.type;
            if (type && type !== 'FUNCTION') continue;
            if (!contextsOf(t).some((c) => ctx.has(c))) continue;
            const parsed = parseFunction(t);
            if (!parsed || seen.has(parsed.name)) continue;
            seen.add(parsed.name);
            parsed.library = lib.name || '';
            out.push(parsed);
        }
    }
    return out;
}

/* A template wrapped in a single top-level IIFE — the common library pattern,
   `(function (global) { … global.mylib = mylib; })(this)` — is fed to the
   language service UNWRAPPED. The service cannot see through parameter-mediated
   global assignment, but Rhino runs the wrapper at script scope, so its inner
   `var mylib` genuinely is a runtime global: the unwrapped body models what
   exists at run time, and a top-level var with expando assignments is exactly
   what the service infers. Both ends must match (open at the start, invocation
   at the very end) or the code is left alone; a rare false positive (e.g. two
   sibling IIFEs) yields an unparseable lib, which mutes only that template's
   contributions — diagnostics are off. */
function unwrapIife(code) {
    const src = String(code);
    // Real libraries open with a banner comment — skip leading comments and
    // whitespace (kept in the output) before looking for the wrapper.
    const lead = src.match(/^(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)*/)[0].length;
    const open = src.slice(lead).match(/^[;!]?\s*\(\s*function\s*\(\s*[A-Za-z_$][\w$]*\s*\)\s*\{/);
    const close = src.match(/\}\s*\)\s*\(\s*[^()]*\s*\)\s*;?\s*$/);
    if (!open || !close) return src;
    return src.slice(0, lead) + src.slice(lead + open[0].length, src.length - close[0].length);
}

/* `ns = { sub: {} }` freezes `sub` as type {} in the language service's JS
   inference — later `ns.sub.fn = …` expando assignments never merge into an
   object-literal-typed property, so everything under `sub` completes as
   nothing. Assignment CHAINS (`ns = {}; ns.sub = {};`) do merge. Rewrite the
   literal form into the chain form when every property value is exactly `{}` —
   semantically identical at runtime, and the shape libraries actually use to
   scaffold namespaces. Anything else is left alone. */
function normalizeNamespaceLiterals(code) {
    // A single unambiguous repetition (each turn MUST consume `ident: {}`), so a
    // near-miss input cannot backtrack combinatorially — this runs on the main
    // thread over operator-authored template text.
    return String(code).replace(
        /((?:var\s+)?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*=\s*\{((?:[\s,]*[A-Za-z_$][\w$]*\s*:\s*\{\})+[\s,]*)\}/g,
        (whole, lhs, body) => {
            const target = lhs.replace(/^var\s+/, '');
            const keys = [...body.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map((m) => m[1]);
            return `${lhs} = {}; ` + keys.map((k) => `${target}.${k} = {}`).join('; ');
        });
}

/* The same scope walk, but returning each in-scope template's SOURCE — fed to
   Monaco's language service as extra libs (core/monaco.js), so a template's
   whole shape completes: a template that builds a namespace object
   (lib.strings.pad = function …) gets member completion after every dot, which
   the flat function list above cannot describe. Drag-and-drop snippets are
   excluded: they are paste material, not part of the script's runtime scope. */
export async function templateSourcesInScope(channelId, contexts) {
    const ctx = new Set(contexts);
    const out = [];
    const seen = new Set();
    for (const lib of asList(await loadLibraries())) {
        if (!libraryInScope(lib, String(channelId))) continue;
        for (const t of templatesOf(lib)) {
            const type = t.properties && t.properties.type;
            if (type === 'DRAG_AND_DROP_CODE') continue;
            if (!contextsOf(t).some((c) => ctx.has(c))) continue;
            const raw = String((t.properties && t.properties.code) || '');
            // A code template is human-authored library code, KBs in practice; a
            // pathological megabyte-scale one is not worth main-thread transform
            // time or worker churn — skip it, losing only its own completions.
            if (raw.length > 500_000) continue;
            const code = normalizeNamespaceLiterals(unwrapIife(raw));
            const id = String(t.id || t.name || '');
            if (!code || !id || seen.has(id)) continue;
            seen.add(id);
            out.push({ id, code });
        }
    }
    return out;
}

/* The active scope's completions — set when a script editor gains focus, read
   synchronously by the Monaco completion provider. */
let active = [];

/* The active scope's template sources, mirrored into the language service as
   extra libs by core/monaco.js (which may load after the first scope is set —
   hence both the getter and the change listener). */
let activeLibs = [];
const libListeners = new Set();

/** Subscribe to active template-lib changes. Returns an unsubscribe. */
export function onActiveLibsChange(cb) { libListeners.add(cb); return () => libListeners.delete(cb); }

export function getActiveLibs() { return activeLibs; }

function setActiveLibs(next) {
    activeLibs = next;
    for (const cb of [...libListeners]) { try { cb(activeLibs); } catch { /* listener error */ } }
}

export async function setActiveScope(channelId, contexts) {
    if (!completionsEnabled() || !channelId || !contexts || !contexts.length) { active = []; setActiveLibs([]); return; }
    try {
        const [fns, libs] = await Promise.all([
            templatesInScope(String(channelId), contexts),
            templateSourcesInScope(String(channelId), contexts)
        ]);
        active = fns;
        setActiveLibs(libs);
    } catch { active = []; setActiveLibs([]); }
}

export function clearActiveScope() { active = []; setActiveLibs([]); }

export function getActiveCompletions() { return active; }
