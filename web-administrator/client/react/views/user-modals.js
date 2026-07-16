/*
 * Shared user create/edit/password modals. Extracted from views/users.js so the
 * top-bar account menu (react/shell.jsx) can offer self-service "Edit Account" /
 * "Change Password" without duplicating the Users grid's logic — one source of
 * truth for the field set and the password-policy enforcement (issue #7).
 */

import { h, toast, modal, field, textInput } from '@oie/web-ui';
import api from '@oie/web-api';
import { passwordRequirementHints } from '../../core/passwords.js';

/* Fields editable in the web UI; everything else on the User object is
   preserved on round-trip. */
export const USER_FIELDS = [
    { key: 'username', label: 'Username' },
    { key: 'firstName', label: 'First Name' },
    { key: 'lastName', label: 'Last Name' },
    { key: 'organization', label: 'Organization' },
    { key: 'email', label: 'Email' },
    { key: 'phoneNumber', label: 'Phone' }
];

export function passwordViolations(result) {
    return api.asList(result, 'string').map(String).filter(s => s.trim());
}

/* A label with a red required-asterisk — Swing's mandatory-field marker
   (UserEditPanel asterisk labels). */
function req(label) {
    return h('span', label + ' ', h('span', { style: { color: 'var(--err, #d9534f)' } }, '*'));
}

export function userForm(user = {}) {
    const inputs = {};
    const grid = h('div.form-grid');
    for (const def of USER_FIELDS) {
        inputs[def.key] = textInput(user[def.key] ?? '');
        // Username is the only always-required profile field (Swing UserEditPanel).
        grid.appendChild(field(def.key === 'username' ? req(def.label) : def.label, inputs[def.key]));
    }
    return { grid, inputs };
}

/* Password + Confirm inputs with up-front policy hints. `optional: true` (Edit
   User) lets a blank pair leave the password unchanged; the default (New User /
   Change Password) requires both. `label` renames the field ("New Password"). */
export function passwordFields({ optional = false, label = 'Password' } = {}) {
    const password = h('input', { type: 'password' });
    const confirm = h('input', { type: 'password' });
    // Show the configured policy up front (the engine still enforces on submit).
    const hint = h('div.hint', { class: 'mt-1.5' });
    api.server.passwordRequirements()
        .then((reqs) => { const hs = passwordRequirementHints(reqs); if (hs.length) hint.textContent = `Password must include ${hs.join(', ')}.`; })
        .catch(() => { /* requirements unavailable */ });
    // Required (asterisk) when setting a password; plain when it's optional.
    const passLabel = optional ? label : req(label);
    const confLabel = optional ? `Confirm ${label}` : req(`Confirm ${label}`);
    const children = [h('div.form-grid', field(passLabel, password), field(confLabel, confirm)), hint];
    if (optional) children.push(h('div.hint', { class: 'mt-1.5' }, 'Leave blank to keep the current password.'));
    // True once either field has input — the caller only pushes a password change then.
    const hasValue = () => Boolean(password.value || confirm.value);
    return {
        password, confirm, hasValue,
        grid: h('div', ...children),
        validate() {
            // Optional + untouched → no password change, nothing to validate.
            if (optional && !hasValue()) return true;
            if (!password.value) { toast('Password is required', 'warn'); return false; }
            if (password.value !== confirm.value) { toast('Passwords do not match', 'warn'); return false; }
            return true;
        }
    };
}

/* Edit an existing user's profile. `onSaved(user)` fires after a successful
   save (the Users grid refreshes; the account menu re-reads the current user). */
export function openEditUserModal(user, { onSaved } = {}) {
    const form = userForm(user);
    // Mirror the New User form — profile fields + password — but the password is
    // optional here (blank leaves it unchanged), so an admin can reset a forgotten
    // password from the same place they edit the profile.
    const pw = passwordFields({ optional: true, label: 'New Password' });
    modal({
        title: `Edit User — ${user.username}`,
        size: 'wide',
        body: h('div', form.grid, pw.grid),
        buttons: [
            { label: 'Cancel' },
            {
                label: 'Save', primary: true,
                onClick: async () => {
                    const username = form.inputs.username.value.trim();
                    if (!username) { toast('Username is required', 'warn'); return false; }
                    if (!pw.validate()) return false;
                    try {
                        // Enforce the password policy before saving anything (as New
                        // User does) so a rejected password never leaves a half-applied
                        // edit (profile saved, password not).
                        if (pw.hasValue()) {
                            const violations = passwordViolations(await api.users.checkPassword(pw.password.value));
                            if (violations.length) { toast(`Password rejected: ${violations.join('; ')}`, 'warn'); return false; }
                        }
                        for (const def of USER_FIELDS) user[def.key] = form.inputs[def.key].value.trim();
                        await api.users.update(user.id, user);
                        if (pw.hasValue()) await api.users.updatePassword(user.id, pw.password.value);
                        toast(`User "${username}" saved`);
                        if (onSaved) onSaved(user);
                        return true;
                    } catch (e) {
                        toast(e.message, 'error');
                        return false;
                    }
                }
            }
        ]
    });
}

/* Change an existing user's password (enforces the server policy up front). */
export function openChangePasswordModal(user, { onSaved } = {}) {
    const pw = passwordFields();
    modal({
        title: `Change Password — ${user.username}`,
        body: pw.grid,
        buttons: [
            { label: 'Cancel' },
            {
                label: 'Change Password', primary: true,
                onClick: async () => {
                    if (!pw.validate()) return false;
                    try {
                        const violations = passwordViolations(await api.users.updatePassword(user.id, pw.password.value));
                        if (violations.length) { toast(violations.join('; '), 'warn'); return false; }
                        toast(`Password updated for "${user.username}"`);
                        if (onSaved) onSaved(user);
                        return true;
                    } catch (e) {
                        toast(e.message, 'error');
                        return false;
                    }
                }
            }
        ]
    });
}
