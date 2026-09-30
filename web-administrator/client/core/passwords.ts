import { t } from './i18n.js';
/*
 * Human-readable password-policy hints from the engine's PasswordRequirements
 * (GET /server/passwordRequirements). Field semantics mirror the engine's
 * PasswordRequirementsChecker: for the character-class fields, 0 = no
 * requirement, -1 = must NOT contain, N > 0 = at least N; minLength: 0 = off,
 * N = minimum length. Used to show users the rules up front (the engine remains
 * the authority — checkUserPassword/updateUserPassword enforce them).
 */
import type { OieObject } from './wire-types.js';

export function passwordRequirementHints(req: OieObject | null | undefined): string[] {
    const r: Record<string, unknown> = (req && (req.passwordRequirements || req)) || {};
    const num = (k: string) => { const v = Number(r[k]); return Number.isFinite(v) ? v : 0; };
    const hints: string[] = [];

    const minLength = num('minLength');
    if (minLength > 0) hints.push(t('{count, plural, one {at least {count} character} other {at least {count} characters}}', { count: minLength }));
    const upper = num('minUpper'), lower = num('minLower'), numeric = num('minNumeric'), special = num('minSpecial');
    if (upper) hints.push(upper === -1 ? t('no uppercase letters') : t('{count, plural, one {{count} uppercase letter} other {{count} uppercase letters}}', { count: upper }));
    if (lower) hints.push(lower === -1 ? t('no lowercase letters') : t('{count, plural, one {{count} lowercase letter} other {{count} lowercase letters}}', { count: lower }));
    if (numeric) hints.push(numeric === -1 ? t('no numbers') : t('{count, plural, one {{count} number} other {{count} numbers}}', { count: numeric }));
    if (special) hints.push(special === -1 ? t('no special characters') : t('{count, plural, one {{count} special character} other {{count} special characters}}', { count: special }));

    return hints;
}
