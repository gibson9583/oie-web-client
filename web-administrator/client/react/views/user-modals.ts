/*
 * Shared user create/edit/password modals. Extracted from views/users.js so the
 * top-bar account menu (react/shell.jsx) can offer self-service "Edit Account" /
 * "Change Password" without duplicating the Users grid's logic — one source of
 * truth for the field set and the password-policy enforcement (issue #7).
 */

import { h, toast, modal, field, textInput, select } from '@oie/web-ui';
import api from '@oie/web-api';
import { passwordRequirementHints } from '../../core/passwords.js';
import { COUNTRIES, US_STATES, ROLES, INDUSTRIES, placeholderOpts } from '../welcome.js';

/* Fields editable in the web UI; everything else on the User object is
   preserved on round-trip. Extended profile fields (country, state/territory,
   role, business/industry, description) mirror the first-login welcome flow
   (react/welcome.js) — same labels, option sources and model keys, so the
   round-trip to the engine's User model is identical. `type` selects the input
   (text by default); `default` seeds an empty select. */
export const USER_FIELDS = [
    { key: 'username', label: 'Username' },
    { key: 'firstName', label: 'First Name' },
    { key: 'lastName', label: 'Last Name' },
    { key: 'email', label: 'Email' },
    { key: 'country', label: 'Country', type: 'select', options: COUNTRIES, default: 'United States' },
    { key: 'stateTerritory', label: 'State/Territory', type: 'select', options: placeholderOpts(US_STATES) },
    { key: 'phoneNumber', label: 'Phone' },
    { key: 'organization', label: 'Organization' },
    { key: 'role', label: 'Role', type: 'select', options: placeholderOpts(ROLES) },
    { key: 'industry', label: 'Business', type: 'select', options: placeholderOpts(INDUSTRIES) },
    { key: 'description', label: 'Description', type: 'textarea' }
];

export function passwordViolations(result: any) {
    return api.asList(result, 'string').map(String).filter(s => s.trim());
}

/* A label with a red required-asterisk — Swing's mandatory-field marker
   (UserEditPanel asterisk labels). */
function req(label: any) {
    return h('span', label + ' ', h('span', { style: { color: 'var(--err, #d9534f)' } }, '*'));
}

export function userForm(user: any = {}) {
    const inputs: any = {};
    const grid = h('div.form-grid');
    for (const def of USER_FIELDS) {
        let el: any;
        if (def.type === 'select') {
            el = select(def.options || [], (user as any)[def.key] ?? def.default ?? '');
        } else if (def.type === 'textarea') {
            el = h('textarea', { rows: 4, style: { width: '100%', resize: 'vertical' } });
            el.value = (user as any)[def.key] ?? '';
        } else {
            el = textInput((user as any)[def.key] ?? '');
        }
        inputs[def.key] = el;
        // Username is the only always-required profile field (Swing UserEditPanel).
        grid.appendChild(field(def.key === 'username' ? req(def.label) : def.label, el));
    }
    // State/Territory is US-only (Swing enables it only for United States) —
    // same behaviour as the welcome flow.
    if (inputs.country && inputs.stateTerritory) {
        const syncState = () => {
            const isUS = inputs.country.value === 'United States';
            inputs.stateTerritory.disabled = !isUS;
            if (!isUS) inputs.stateTerritory.value = '';
        };
        inputs.country.addEventListener('change', syncState);
        syncState();
    }
    return { grid, inputs };
}

/* Password + Confirm inputs with up-front policy hints. `optional: true` (Edit
   User) lets a blank pair leave the password unchanged; the default (New User /
   Change Password) requires both. `label` renames the field ("New Password"). */
export function passwordFields({ optional = false, label = 'Password' }: any = {}) {
    // autocomplete=new-password: this pair SETS a password (create user / reset)
    // — the hint stops the browser autofilling the admin's saved login into it
    // and prompts its generator/update flow instead (#24).
    const password = h('input', { type: 'password', autocomplete: 'new-password' });
    const confirm = h('input', { type: 'password', autocomplete: 'new-password' });
    // Show the configured policy up front (the engine still enforces on submit).
    const hint = h('div.hint', { class: 'mt-1.5' });
    api.server.passwordRequirements()
        .then((reqs: any) => { const hs = passwordRequirementHints(reqs); if (hs.length) hint.textContent = `Password must include ${hs.join(', ')}.`; })
        .catch(() => { /* requirements unavailable */ });
    // Required (asterisk) when setting a password; plain when it's optional.
    const passLabel = optional ? label : req(label);
    const confLabel = optional ? `Confirm ${label}` : req(`Confirm ${label}`);
    const children = [h('div.form-grid', field(passLabel, password), field(confLabel, confirm)), hint];
    if (optional) children.push(h('div.hint', { class: 'mt-1.5' }, 'Leave blank to keep the current password.'));
    // True once either field has input — the caller only pushes a password change then.
    const hasValue = () => Boolean((password as any).value || (confirm as any).value);
    return {
        password, confirm, hasValue,
        grid: h('div', ...children),
        validate() {
            // Optional + untouched → no password change, nothing to validate.
            if (optional && !hasValue()) return true;
            if (!(password as any).value) { toast('Password is required', 'warn'); return false; }
            if ((password as any).value !== (confirm as any).value) { toast('Passwords do not match', 'warn'); return false; }
            return true;
        }
    };
}

/* Edit an existing user's profile. `onSaved(user)` fires after a successful
   save (the Users grid refreshes; the account menu re-reads the current user). */
export function openEditUserModal(user: any, { onSaved }: any = {}) {
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
                            const violations = passwordViolations(await api.users.checkPassword((pw.password as any).value));
                            if (violations.length) { toast(`Password rejected: ${violations.join('; ')}`, 'warn'); return false; }
                        }
                        for (const def of USER_FIELDS) user[def.key] = form.inputs[def.key].value.trim();
                        await api.users.update(user.id, user);
                        if (pw.hasValue()) await api.users.updatePassword(user.id, (pw.password as any).value);
                        toast(`User "${username}" saved`);
                        if (onSaved) onSaved(user);
                        return true;
                    } catch (e: any) {
                        toast(e.message, 'error');
                        return false;
                    }
                }
            }
        ]
    });
}

/* Change an existing user's password (enforces the server policy up front). */
export function openChangePasswordModal(user: any, { onSaved }: any = {}) {
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
                        const violations = passwordViolations(await api.users.updatePassword(user.id, (pw.password as any).value));
                        if (violations.length) { toast(violations.join('; '), 'warn'); return false; }
                        toast(`Password updated for "${user.username}"`);
                        if (onSaved) onSaved(user);
                        return true;
                    } catch (e: any) {
                        toast(e.message, 'error');
                        return false;
                    }
                }
            }
        ]
    });
}
