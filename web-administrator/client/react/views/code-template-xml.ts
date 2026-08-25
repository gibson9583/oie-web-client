/* Code-template plumbing shared by the Code Templates view and channel import:
   both convert Swing code-template XML exports into the JSON shape the engine's
   multipart _bulkUpdate endpoint consumes, and both have to read the same
   CodeTemplateLibrarySaveResult back. Keeping it here means one version-stamping
   rule and one error-reporting rule for every caller. */

import api, { uuid } from '@oie/web-api';
import { strictWireList } from '../../core/wire-safety.js';

/* ---- reading CodeTemplateLibrarySaveResult ---------------------------------
   _bulkUpdate answers with a CodeTemplateLibrarySaveResult, not the bare "false"
   the per-object PUTs returned. overrideNeeded is that same someone-else-saved
   revision conflict; librariesSuccess and the per-template results carry an
   engine-side failure that never reaches the HTTP status. Booleans are compared
   as text because XStream-JSON and the XML fallback disagree on their type. */
export function needsOverride(result: any) {
    return Boolean(result) && typeof result === 'object' && String(result.overrideNeeded) === 'true';
}

/* The engine serializes this response with XStream, which writes a Throwable's
   PRIVATE FIELDS — so the text lives in `detailMessage`. (`message` is what the
   Swagger-derived oie-schema.d.ts advertises, because that is Jackson's view of
   the bean, not the wire.) Same reason the library failure is `librariesCause`
   and not `cause`: the field name is what ships, not the getter name. */
function throwableMessage(cause: any): string {
    if (!cause || typeof cause !== 'object') return '';
    return String(cause.detailMessage || cause.message || cause.localizedMessage || '');
}

/* One template-result map entry per attempted object, tolerant of the map
   encodings XStream-JSON produces ({entry:[...]}, one bare entry, or a plain
   object). Each entry pairs a <string> id with a result object. */
function templateResultEntries(node: any): Map<string, any> {
    const out = new Map<string, any>();
    if (!node || typeof node !== 'object') return out;
    for (const entry of api.asList((node as any).entry ?? node)) {
        if (!entry || typeof entry !== 'object') continue;
        const id = (entry as any).string;
        const value = Object.entries(entry).find(([k]) => k !== 'string' && !k.startsWith('@'))?.[1];
        if (id != null && value && typeof value === 'object') out.set(String(id), value);
    }
    return out;
}

/**
 * '' when the save is CONFIRMED; otherwise what went wrong.
 *
 * The engine's _bulkUpdate is one request but NOT one transaction: libraries
 * are applied first, then each template and removal individually with each
 * failure caught (updateLibrariesAndTemplates) and nothing rolled back. The
 * result is therefore the only truth about what actually happened, so this
 * demands it: a malformed/empty 200 is an UNKNOWN outcome (not a success), and
 * every attempted template/removal must be individually confirmed.
 */
export function verifySaveResult(result: any, updatedTemplateIds: any[] = [], removedTemplateIds: any[] = []): string {
    /* AFFIRMATIVE check: only an explicit librariesSuccess=true counts.
       undefined, null, or any other non-true value is an unknown outcome —
       "not undefined" let a malformed {librariesSuccess: null} read as saved. */
    if (!result || typeof result !== 'object' || String((result as any).librariesSuccess) !== 'true') {
        return saveFailure(result)
            || 'the engine did not return a usable save result — the outcome is unknown; Refresh before retrying';
    }
    const failure = saveFailure(result);
    if (failure) return failure;
    const perTemplate = templateResultEntries((result as any).codeTemplateResults);
    for (const rawId of [...updatedTemplateIds, ...removedTemplateIds]) {
        const id = String(rawId);
        const entry = perTemplate.get(id);
        if (!entry) return `the engine did not confirm code template ${id} — the save may be partial; Refresh before retrying`;
        if (String((entry as any).success) !== 'true') {
            return throwableMessage((entry as any).cause) || `code template ${id} was not saved`;
        }
    }
    return '';
}

/** '' when the save succeeded; otherwise every engine-side failure it reported. */
export function saveFailure(result: any) {
    if (!result || typeof result !== 'object') return '';   // no body = nothing to report
    const problems: string[] = [];
    if (String(result.librariesSuccess) === 'false') {
        problems.push(throwableMessage(result.librariesCause) || 'the library set could not be saved');
    }
    // codeTemplateResults is a Java Map, whose XStream encoding varies with the
    // key type, so scan the subtree for a failed result rather than assume one.
    const scan = (node: any) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(scan); return; }
        if (String(node.success) === 'false') {
            problems.push(throwableMessage(node.cause) || 'a code template could not be saved');
        } else Object.values(node).forEach(scan);
    };
    scan(result.codeTemplateResults);
    return problems.join('; ');
}

export function xmlToJson(el: any): any {
    const obj: any = {};
    for (const attr of el.attributes) obj['@' + attr.name] = attr.value;
    if (!el.children.length) {
        const text = el.textContent || '';
        if (!Object.keys(obj).length) return text;
        if (text) obj.$ = text;
        return obj;
    }
    for (const child of el.children) {
        const value = xmlToJson(child);
        if (Object.prototype.hasOwnProperty.call(obj, child.tagName)) {
            if (!Array.isArray(obj[child.tagName])) obj[child.tagName] = [obj[child.tagName]];
            obj[child.tagName].push(value);
        } else {
            obj[child.tagName] = value;
        }
    }
    return obj;
}

export function templateFromXml(el: any, version: any) {
    const template: any = xmlToJson(el);
    if (!template.id) template.id = uuid();
    if (template.properties && typeof template.properties === 'object' && !template.properties['@version']) {
        template.properties = { '@version': version, ...template.properties };
    }
    return { '@version': template['@version'] || version, ...template };
}

/* ---- library membership for one channel -------------------------------------
   The editor's and wizard's "Code Template Libraries" checkboxes used to PUT the
   panel's library snapshot with override=true — a full-list write that silently
   reverted anything another administrator saved while the panel was open. Same
   optimistic-concurrency rule as every other multi-object write now: fetch the
   CURRENT list, apply only this channel's membership toggles, submit through
   _bulkUpdate with override=false, and re-apply once on a fresh copy if someone
   saved in between. */
export async function saveLibraryAssociations(channelId: any, wantedByLibraryId: Map<any, boolean>, version: any) {
    const wanted = new Map<string, boolean>(
        [...wantedByLibraryId].map(([id, enabled]) => [String(id), enabled])
    );
    // This is a complete-list write. An empty edit set must never be allowed to
    // manufacture an empty payload and delete every library.
    if (!wanted.size) return;

    type ValidatedLibrary = {
        enabledIds: string[];
        disabledIds: string[];
        templateIds: string[];
    };
    const channelKey = String(channelId);
    for (let attempt = 0; ; attempt++) {
        /* STRICT read: asList turns a malformed {} into [{}], which "matches"
           no toggled library and silently drops the association the user just
           chose. '' is the engine's real empty <list>. */
        const rawLibs: any = await api.get('/codeTemplateLibraries', { includeCodeTemplates: false });
        let fresh: any[];
        const validated = new Map<string, ValidatedLibrary>();
        try {
            fresh = strictWireList<any>(rawLibs, 'codeTemplateLibrary', 'code template library list');
            const ids = new Set<string>();
            const templateOwners = new Map<string, string>();
            for (const lib of fresh) {
                if (!lib || typeof lib !== 'object'
                    || typeof lib.id !== 'string' || !lib.id.trim() || ids.has(lib.id)
                    // These are concrete fields on Swing's typed
                    // CodeTemplateLibrary. If any disappeared from the wire,
                    // spreading the object into the complete-list payload would
                    // silently replace the stored value with a Java default.
                    || typeof lib.name !== 'string'
                    || !Number.isInteger(lib.revision) || lib.revision < 1
                    || typeof lib.includeNewChannels !== 'boolean') {
                    throw new Error('the engine returned an unusable code template library list');
                }
                ids.add(lib.id);

                const stringIds = (raw: any, label: string) => {
                    const values = strictWireList<any>(raw, 'string', label);
                    const seen = new Set<string>();
                    for (const value of values) {
                        if (typeof value !== 'string' || !value.trim() || seen.has(value)) {
                            throw new Error(`the engine returned an unusable ${label}`);
                        }
                        seen.add(value);
                    }
                    return [...seen];
                };
                const enabledIds = stringIds(lib.enabledChannelIds, 'enabled channel id list');
                const disabledIds = stringIds(lib.disabledChannelIds, 'disabled channel id list');
                const templateRefs = strictWireList<any>(lib.codeTemplates, 'codeTemplate', 'code template reference list');
                const templateIds: string[] = [];
                const localTemplateIds = new Set<string>();
                for (const ref of templateRefs) {
                    if (!ref || typeof ref !== 'object' || Array.isArray(ref)
                        || typeof ref.id !== 'string' || !ref.id.trim()
                        || localTemplateIds.has(ref.id) || templateOwners.has(ref.id)) {
                        throw new Error('the engine returned an unusable code template reference list');
                    }
                    localTemplateIds.add(ref.id);
                    templateOwners.set(ref.id, lib.id);
                    templateIds.push(ref.id);
                }
                validated.set(lib.id, { enabledIds, disabledIds, templateIds });
            }
        } catch {
            throw new Error('the engine returned an unusable code template library list — the association was NOT saved');
        }

        // Swing only reaches its save worker with concrete library objects. If
        // a requested object disappeared during confirmation, this is a stale
        // edit, not a successful no-op (and not permission to recreate it).
        const missing = [...wanted.keys()].filter(id => !validated.has(id));
        if (missing.length) {
            throw new Error(`code template ${missing.length === 1 ? 'library' : 'libraries'} ${missing.join(', ')} no longer ${missing.length === 1 ? 'exists' : 'exist'} — refresh and retry; the association was NOT saved`);
        }

        const payload = fresh.map((lib: any) => {
            const { '@version': v0, codeTemplates: _refs, ...rest } = lib as any;
            const fields = validated.get(lib.id)!;
            const wantedState = wanted.get(lib.id);
            if (wantedState !== undefined) {
                const enabled = new Set(fields.enabledIds);
                const disabled = new Set(fields.disabledIds);
                if (wantedState) { enabled.add(channelKey); disabled.delete(channelKey); }
                else { enabled.delete(channelKey); disabled.add(channelKey); }
                rest.enabledChannelIds = enabled.size ? { string: [...enabled] } : '';
                rest.disabledChannelIds = disabled.size ? { string: [...disabled] } : '';
            }
            // '@version' must be the FIRST key on both the library and each
            // template ref (array-nested; the engine's JSON→XML reorder fallback
            // doesn't run there).
            return {
                '@version': v0 || version,
                ...rest,
                codeTemplates: fields.templateIds.length
                    ? { codeTemplate: fields.templateIds.map(id => ({ '@version': version, id })) }
                    : null
            };
        });
        const result = await api.codeTemplates.bulkUpdate(payload, [], [], [], false);
        if (needsOverride(result)) {
            // Someone saved between the fetch and the submit. The toggles are
            // still what the user asked for — re-apply them to the newer copy.
            if (attempt >= 1) throw new Error('the code template libraries kept changing while saving — try again');
            continue;
        }
        const failure = verifySaveResult(result);
        if (failure) throw new Error(failure);
        return;
    }
}
