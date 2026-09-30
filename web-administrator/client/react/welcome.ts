import { COUNTRIES } from '../core/country-regions.js';
import { formatList, t, locale, compareText } from '../core/i18n.js';
/*
 * First-login "Welcome" dialog — the web port of Swing's FirstLoginDialog /
 * UserEditPanel (com.mirth.connect.client.ui.FirstLoginDialog). On a user's
 * first login the engine carries a "firstlogin" user preference (unset or
 * "true" => not yet completed). We prompt them to set a password and fill out
 * their account profile, then clear the flag — exactly like the Swing wizard.
 *
 * The trigger and flag are SERVER-SIDE user preferences (not the per-browser
 * localStorage core/prefs.js): read via api.users.getPreferences, cleared via
 * the single-key api.users.setPreference('firstlogin', 'false').
 */
import { h, modal, field, textInput, select, toast } from '@oie/web-ui';
import api from '@oie/web-api';
import { passwordRequirementHints } from '../core/passwords.js';

export const DEFAULT_OPTION = t('--Select an option--');

/* US state/territory codes (Swing UserEditPanel.STATE_TERRITORY_CODES). The
   State/Territory field is US-only — disabled for any other country. */
export const US_STATES = ['AL', 'AK', 'AS', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'GU', 'HI',
    'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MP', 'MS', 'MO', 'MT', 'NE', 'NV',
    'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'PR', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
    'VA', 'VI', 'WA', 'WV', 'WI', 'WY'];

/* Swing UserEditPanel.ROLES — its leading "Primary Role*" prompt entry is
   represented here by the DEFAULT_OPTION placeholder instead. */
export const ROLES = ['C-Suite', 'Consultant - Advisor', 'Consultant - Engineer', 'Consultant - Implementer',
    'Employee - Engineer', 'Employee - Manager', 'Employee - Director', 'Employee - VP',
    'Independent Contractor', 'Other'];

/* Swing UserEditPanel.INDUSTRIES (labelled "Business"). */
export const INDUSTRIES = ['ACO', 'CHC/FQHC', 'Clinic', 'HIE', 'HIT Consulting', 'HIT Software', 'Hospital', 'Lab',
    'Network', 'Other', 'Payer', 'Physicians Group', 'Private Practice', 'Public Health Agency',
    'Radiology Center', 'University'];

/* The engine returns password-policy violations as a list of strings. */
function passwordViolations(result: any) {
    return api.asList(result, 'string').map(String).filter(s => s.trim());
}

/* A label with a red required-asterisk (Swing's red "*" markers). */
function req(label: any) {
    return h('span', label + ' ', h('span', { style: { color: 'var(--danger, #d9534f)' } }, '*'));
}

const profileLabels: Record<string, string> = {
    "C-Suite": t("C-Suite"),
    "Consultant - Advisor": t("Consultant - Advisor"),
    "Consultant - Engineer": t("Consultant - Engineer"),
    "Consultant - Implementer": t("Consultant - Implementer"),
    "Employee - Engineer": t("Employee - Engineer"),
    "Employee - Manager": t("Employee - Manager"),
    "Employee - Director": t("Employee - Director"),
    "Employee - VP": t("Employee - VP"),
    "Independent Contractor": t("Independent Contractor"),
    "Other": t("Other"),
    "ACO": t("ACO"),
    "CHC/FQHC": t("CHC/FQHC"),
    "Clinic": t("Clinic"),
    "HIE": t("HIE"),
    "HIT Consulting": t("HIT Consulting"),
    "HIT Software": t("HIT Software"),
    "Hospital": t("Hospital"),
    "Lab": t("Lab"),
    "Network": t("Network"),
    "Payer": t("Payer"),
    "Physicians Group": t("Physicians Group"),
    "Private Practice": t("Private Practice"),
    "Public Health Agency": t("Public Health Agency"),
    "Radiology Center": t("Radiology Center"),
    "University": t("University"),
};

export function countryOptions() {
    if (locale() === 'en' || locale() === 'en-XA') return COUNTRIES.map(([, name]) => ({ value: name, label: name }));
    const names = new Intl.DisplayNames(locale(), { type: 'region' });
    return COUNTRIES.map(([code, name]) => ({ value: name, label: names.of(code) || name }))
        .sort((a, b) => compareText(a.label, b.label));
}

/* Prepend the "--Select an option--" placeholder to a value list. */
export function placeholderOpts(list: any) {
    return [{ value: '', label: DEFAULT_OPTION }, ...list.map((v: any) => ({ value: v, label: profileLabels[v] || v }))];
}

function showWelcomeDialog(user: any) {
    return new Promise((resolve: any) => {
        const usernameInput = textInput(user.username || '', { disabled: true });
        const pwInput = h('input', { type: 'password', autocomplete: 'new-password' });
        const confirmInput = h('input', { type: 'password', autocomplete: 'new-password' });
        const pwHint = h('div.hint.span-2');
        api.server.passwordRequirements()
            .then((req: any) => { const hs = passwordRequirementHints(req); if (hs.length) pwHint.textContent = t("Password must include {value1}.", { value1: String(formatList(hs)) }); })
            .catch(() => { /* requirements unavailable */ });
        const firstName = textInput(user.firstName || '');
        const lastName = textInput(user.lastName || '');
        const email = textInput(user.email || '');
        const phone = textInput(user.phoneNumber || '');
        const organization = textInput(user.organization || '');
        const country = select(countryOptions(), user.country || 'United States');
        const state = select(placeholderOpts(US_STATES), user.stateTerritory || '');
        const role = select(placeholderOpts(ROLES), user.role || '');
        const industry = select(placeholderOpts(INDUSTRIES), user.industry || '');
        const description = h('textarea', { rows: 4, style: { width: '100%', resize: 'vertical' } });
        (description as any).value = user.description || '';

        // State/Territory is US-only (Swing enables it only for United States).
        const syncState = () => {
            const isUS = country.value === 'United States';
            state.disabled = !isUS;
            if (!isUS) state.value = '';
        };
        country.addEventListener('change', syncState);
        syncState();

        const body = h('div',
            h('div.hint', { style: { marginBottom: '12px' } },
                t("You may now customize your account information. You also have the option of changing your account password.")),
            h('div.form-grid',
                field(t("Username"), usernameInput),
                field(req(t("New Password")), pwInput),
                field(req(t("Confirm New Password")), confirmInput),
                pwHint,
                field(t("First Name"), firstName),
                field(t("Last Name"), lastName),
                field(t("Email"), email),
                field(t("Country"), country),
                field(t("State/Territory"), state),
                field(t("Phone"), phone),
                field(t("Organization"), organization),
                field(t("Role"), role),
                field(t("Business"), industry),
                field(t("Description"), description)));

        modal({
            title: t("Welcome to Open Integration Engine"),
            size: 'wide',
            body,
            onClose: () => resolve(),
            buttons: [
                {
                    label: t("Finish"), primary: true,
                    onClick: async () => {
                        const pw = (pwInput as any).value;
                        if (!pw) { toast(t("New Password is required"), 'warn'); return false; }
                        if (pw !== (confirmInput as any).value) { toast(t("Passwords do not match"), 'warn'); return false; }
                        try {
                            // Set the password first (Swing order); the engine answers
                            // with a list of policy violations if it's rejected.
                            const violations = passwordViolations(await api.users.updatePassword(user.id, pw));
                            if (violations.length) { toast(violations.join('; '), 'warn'); return false; }
                            // Round-trip the user object: mutate the editable fields,
                            // preserve everything else the engine sent.
                            user.firstName = firstName.value.trim();
                            user.lastName = lastName.value.trim();
                            user.email = email.value.trim();
                            user.country = country.value;
                            user.stateTerritory = state.value;
                            user.phoneNumber = phone.value.trim();
                            user.organization = organization.value.trim();
                            user.role = role.value;
                            user.industry = industry.value;
                            user.description = (description as any).value;
                            await api.users.update(user.id, user);
                            await api.users.setPreference(user.id, 'firstlogin', 'false');
                            toast(t("Welcome — your account is ready"));
                            return true;   // closes the modal → onClose resolves
                        } catch (e: any) {
                            toast(e.message || t("Could not complete setup"), 'error');
                            return false;
                        }
                    }
                }
            ]
        });
        // Focus the password field once the modal has settled — but only if the
        // user hasn't already tabbed/clicked into the form. A blind focus here
        // steals it back mid-input (e.g. a fast typist, or a test filling the
        // confirm field, within 30ms of the modal opening), landing their next
        // keystrokes in the wrong field.
        setTimeout(() => { if (!body.contains(document.activeElement)) pwInput.focus(); }, 30);
    });
}

/* Show the welcome wizard when the engine's "firstlogin" user preference is
 * unset or true (Swing LoginPanel: firstlogin == null || toBoolean(firstlogin)).
 *
 * Read via the SINGLE-KEY preference endpoint (text/plain): the bulk
 * getPreferences runs through api.js's unwrap(), which collapses a one-entry
 * Properties map to a bare scalar — so a user whose only preference is
 * "firstlogin" would lose the key. The single-key read returns the raw value
 * (empty when unset). Fail-closed on error: a transient read failure skips the
 * wizard rather than forcing it on every login. */
export async function maybeShowWelcome(user: any) {
    if (!user || user.id == null) return;
    let fl: any;
    try { fl = await api.users.getPreference(user.id, 'firstlogin'); }
    catch { return; }
    const show = !fl || /^(true|yes|on|1)$/i.test(String(fl).trim());
    if (show) await showWelcomeDialog(user);
}
