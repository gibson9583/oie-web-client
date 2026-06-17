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

/* The active scope's completions — set when a script editor gains focus, read
   synchronously by the Monaco completion provider. */
let active = [];

export async function setActiveScope(channelId, contexts) {
    if (!completionsEnabled() || !channelId || !contexts || !contexts.length) { active = []; return; }
    try { active = await templatesInScope(String(channelId), contexts); }
    catch { active = []; }
}

export function clearActiveScope() { active = []; }

export function getActiveCompletions() { return active; }
