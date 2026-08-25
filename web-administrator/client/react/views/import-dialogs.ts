/*
 * Shared import dialogs — the JOptionPane equivalents the Swing client uses
 * across its import flows, plus the name/id collision resolver that sits on top
 * of them (Swing Frame.checkChannelName / Frame.importAlert).
 *
 * These live outside any one view because channels and alerts run the same
 * conversation on import: warn that the object already exists, then offer
 * overwrite (reuse the existing id) or create-new (prompt for a free name and
 * mint a fresh id). Only the naming rules differ, so they are passed in.
 */

import { h, modal, promptDialog } from '@oie/web-ui';
import { uuid } from '@oie/web-api';

/** OK-only warning (Swing alertWarning). */
export function alertWarning(message: any) {
    return new Promise(resolve => modal({
        title: 'Warning', body: h('div', String(message)), onClose: resolve as any,
        buttons: [{ label: 'OK', primary: true, onClick: resolve as any }]
    }));
}

/* OK-only info (Swing alertInformation, title "Information"). pre-line renders
   the message's \n line breaks the way JOptionPane does. */
export function alertInformation(message: any) {
    return new Promise(resolve => modal({
        title: 'Information',
        body: h('div', { style: 'white-space: pre-line' }, String(message)),
        onClose: resolve as any,
        buttons: [{ label: 'OK', primary: true, onClick: resolve as any }]
    }));
}

/** Yes / No option (Swing alertOption): resolves true on Yes, false on No/closed. */
export function optionYesNo(title: any, message: any) {
    return new Promise(resolve => modal({
        title, body: h('div', { style: 'white-space: pre-line' }, String(message)), onClose: () => resolve(false),
        buttons: [
            { label: 'No', onClick: () => resolve(false) },
            { label: 'Yes', primary: true, onClick: () => resolve(true) }
        ]
    }));
}

/** What the import should apply to the incoming object, or null to abort. */
export interface ImportIdentity {
    id: string;
    name: string;
    revision: number;
    overwrite: boolean;
}

export interface ImportNameRules {
    /** Dialog title, e.g. 'Import Channel'. */
    title: string;
    /** Capitalized noun for messages, e.g. 'Channel'. */
    noun: string;
    /** Extra naming rules beyond empty/duplicate; return the warning, or null. */
    validate?: (name: string) => string | null;
}

/**
 * Resolve a name/id collision on import against `existing` (the current object
 * list). Returns the identity to apply, or null if the user cancelled.
 *
 * An object whose name is free still gets an id check: importing a file whose id
 * is already taken would otherwise silently replace an unrelated object, since
 * the engine's create endpoints are create-or-replace by id.
 */
export async function resolveImportName(
    name: any, id: any, existing: any[], rules: ImportNameRules
): Promise<ImportIdentity | null> {
    const tempId = uuid();
    const lower = (v: any) => String(v || '').toLowerCase();
    const nameClash = (n: any, candidateId: any) =>
        existing.some((c: any) => lower(c.name) === lower(n) && c.id !== candidateId);

    // 'invalid' (empty or failing the naming rules) and 'collision' must stay
    // distinct verdicts: only a real collision has anything to overwrite.
    async function checkName(n: any, candidateId: any): Promise<'ok' | 'invalid' | 'collision'> {
        if (!n) { await alertWarning(`${rules.noun} name cannot be empty.`); return 'invalid'; }
        const problem = rules.validate ? rules.validate(String(n)) : null;
        if (problem) { await alertWarning(problem); return 'invalid'; }
        if (nameClash(n, candidateId)) { await alertWarning(`${rules.noun} "${n}" already exists.`); return 'collision'; }
        return 'ok';
    }

    const verdict = await checkName(name, tempId);
    if (verdict !== 'ok') {
        /* The overwrite offer is only meaningful for a COLLISION. Offering it
           for an invalid name let "Yes" fall through with no name-match and
           return the file's original id and invalid name unchanged — importing
           exactly what the validation just rejected. Invalid names go straight
           to the rename prompt. */
        if (verdict === 'collision'
            && await optionYesNo(rules.title, `Would you like to overwrite the existing ${rules.noun.toLowerCase()}?  Choose 'No' to create a new ${rules.noun.toLowerCase()}.`)) {
            const match = existing.find((c: any) => lower(c.name) === lower(name));
            return { id: match ? match.id : id, name, revision: match ? (Number(match.revision) || 0) : 0, overwrite: true };
        }
        let newName = name;
        do {
            newName = await promptDialog(rules.title, `Please enter a new name for the ${rules.noun.toLowerCase()}.`, newName);
            if (newName == null) return null;             // Cancel → abort
        } while ((await checkName(newName, tempId)) !== 'ok');
        return { id: tempId, name: newName, revision: 0, overwrite: false };
    }
    // No name collision — make sure the id is free too.
    const idClash = existing.some((c: any) => c.id === id);
    return { id: idClash ? tempId : id, name, revision: 0, overwrite: false };
}

/* Revalidate a completed dialog decision immediately before its destructive
   request. The create endpoints replace by id, so an identity that became
   occupied while a warning/rename/version dialog was open must abort instead
   of turning a create decision into an overwrite. */
export function assertImportIdentityCurrent(
    resolved: ImportIdentity, current: any[], rules: ImportNameRules
): void {
    const lower = (value: any) => String(value || '').toLowerCase();
    const byId = current.find(item => String(item?.id || '') === String(resolved.id));
    const byName = current.find(item => lower(item?.name) === lower(resolved.name));
    if (resolved.overwrite) {
        if (!byId || lower(byId.name) !== lower(resolved.name)) {
            throw new Error(`the ${rules.noun.toLowerCase()} list changed while the overwrite was being confirmed — import cancelled; Refresh and retry`);
        }
        return;
    }
    if (byId || byName) {
        throw new Error(`the ${rules.noun.toLowerCase()} list changed while the import was being confirmed — import cancelled rather than overwriting a newer ${rules.noun.toLowerCase()}`);
    }
}
