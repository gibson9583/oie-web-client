/*
 * Human-readable password-policy hints from the engine's PasswordRequirements
 * (GET /server/passwordRequirements). Field semantics mirror the engine's
 * PasswordRequirementsChecker: for the character-class fields, 0 = no
 * requirement, -1 = must NOT contain, N > 0 = at least N; minLength: 0 = off,
 * N = minimum length. Used to show users the rules up front (the engine remains
 * the authority — checkUserPassword/updateUserPassword enforce them).
 */
export function passwordRequirementHints(req) {
    const r = (req && (req.passwordRequirements || req)) || {};
    const num = (k) => { const v = Number(r[k]); return Number.isFinite(v) ? v : 0; };
    const hints = [];

    const minLength = num('minLength');
    if (minLength > 0) hints.push(`at least ${minLength} character${minLength === 1 ? '' : 's'}`);

    const rule = (key, noun) => {
        const v = num(key);
        if (v === -1) hints.push(`no ${noun}s`);
        else if (v === 1) hints.push(`1 ${noun}`);
        else if (v > 1) hints.push(`${v} ${noun}s`);
    };
    rule('minUpper', 'uppercase letter');
    rule('minLower', 'lowercase letter');
    rule('minNumeric', 'number');
    rule('minSpecial', 'special character');

    return hints;
}
