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
import api, { onSessionExpired, onEngineUnknown } from '@oie/web-api';
import { passwordRequirementHints, passwordRejectedMessage } from '../core/passwords.js';
import { captureEngineSession } from '../core/engine-fetch.js';

export const DEFAULT_OPTION = '--Select an option--';

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

/* Country display names. Swing derives these at runtime from libphonenumber's
   supported regions (alphabetically sorted); mirrored here as a static list. */
export const COUNTRIES = `Åland Islands
Afghanistan
Albania
Algeria
American Samoa
Andorra
Angola
Anguilla
Antarctica
Antigua and Barbuda
Argentina
Armenia
Aruba
Australia
Austria
Azerbaijan
Bahamas
Bahrain
Bangladesh
Barbados
Belarus
Belgium
Belize
Benin
Bermuda
Bhutan
Bolivia
Bosnia and Herzegovina
Botswana
Bouvet Island
Brazil
British Indian Ocean Territory
Brunei
Bulgaria
Burkina Faso
Burundi
Cambodia
Cameroon
Canada
Cape Verde
Cayman Islands
Central African Republic
Chad
Chile
China
Christmas Island
Cocos (Keeling) Islands
Colombia
Comoros
Congo
Congo (Democratic Republic)
Cook Islands
Costa Rica
Croatia
Cuba
Cyprus
Czech Republic
Côte d'Ivoire
Denmark
Djibouti
Dominica
Dominican Republic
East Timor
Ecuador
Egypt
El Salvador
Equatorial Guinea
Eritrea
Estonia
Eswatini
Ethiopia
Falkland Islands
Faroe Islands
Fiji
Finland
France
French Guiana
French Polynesia
French Southern Territories
Gabon
Gambia
Georgia
Germany
Ghana
Gibraltar
Greece
Greenland
Grenada
Guadeloupe
Guam
Guatemala
Guernsey
Guinea
Guinea-Bissau
Guyana
Haiti
Heard Island and McDonald Islands
Honduras
Hong Kong
Hungary
Iceland
India
Indonesia
Iran
Iraq
Ireland
Isle of Man
Israel
Italy
Jamaica
Japan
Jersey
Jordan
Kazakhstan
Kenya
Kiribati
Kosovo
Kuwait
Kyrgyzstan
Laos
Latvia
Lebanon
Lesotho
Liberia
Libya
Liechtenstein
Lithuania
Luxembourg
Macao
Madagascar
Malawi
Malaysia
Maldives
Mali
Malta
Marshall Islands
Martinique
Mauritania
Mauritius
Mayotte
Mexico
Micronesia
Moldova
Monaco
Mongolia
Montenegro
Montserrat
Morocco
Mozambique
Myanmar
Namibia
Nauru
Nepal
Netherlands
New Caledonia
New Zealand
Nicaragua
Niger
Nigeria
Niue
Norfolk Island
North Korea
North Macedonia
Northern Mariana Islands
Norway
Oman
Pakistan
Palau
Palestine
Panama
Papua New Guinea
Paraguay
Peru
Philippines
Poland
Portugal
Puerto Rico
Qatar
Réunion
Romania
Russia
Rwanda
Saint Barthélemy
Saint Helena
Saint Kitts and Nevis
Saint Lucia
Saint Martin
Saint Pierre and Miquelon
Saint Vincent and the Grenadines
Samoa
San Marino
Sao Tome and Principe
Saudi Arabia
Senegal
Serbia
Seychelles
Sierra Leone
Singapore
Sint Maarten
Slovakia
Slovenia
Solomon Islands
Somalia
South Africa
South Georgia and the South Sandwich Islands
South Korea
South Sudan
Spain
Sri Lanka
Sudan
Suriname
Svalbard and Jan Mayen
Sweden
Switzerland
Syria
Taiwan
Tajikistan
Tanzania
Thailand
Togo
Tokelau
Tonga
Trinidad and Tobago
Tunisia
Turkey
Turkmenistan
Turks and Caicos Islands
Tuvalu
Uganda
Ukraine
United Arab Emirates
United Kingdom
United States
United States Virgin Islands
Uruguay
Uzbekistan
Vanuatu
Vatican City
Venezuela
Vietnam
Wallis and Futuna
Western Sahara
Yemen
Zambia
Zimbabwe`.split('\n').map(s => s.trim()).filter(Boolean);

/* The engine returns password-policy violations as a list of strings. */
function passwordViolations(result: any) {
    return api.asList(result, 'string').map(String).filter(s => s.trim());
}

/* A label with a red required-asterisk (Swing's red "*" markers). */
function req(label: any) {
    return h('span', label + ' ', h('span', { style: { color: 'var(--danger, #d9534f)' } }, '*'));
}

/* Prepend the "--Select an option--" placeholder to a value list. */
export function placeholderOpts(list: any) {
    return [{ value: '', label: DEFAULT_OPTION }, ...list.map((v: any) => ({ value: v, label: v }))];
}

function showWelcomeDialog(user: any): Promise<boolean> {
    return new Promise((resolve: any) => {
        const assertSession = captureEngineSession();
        const userId = user.id;
        let completed = false;
        let closed = false;
        let busy = false;
        // Receipts belong only to this dialog. Never persist a password or a
        // client-side flag that could bypass setup after another sign-in.
        let acceptedPassword: string | null = null;
        let acceptedProfile: string | null = null;
        const current = () => {
            if (closed) return false;
            try { assertSession(); return true; } catch { return false; }
        };
        const usernameInput = textInput(user.username || '', { disabled: true });
        const pwInput = h('input', { type: 'password', autocomplete: 'new-password' });
        const confirmInput = h('input', { type: 'password', autocomplete: 'new-password' });
        const pwHint = h('div.hint.span-2');
        api.server.passwordRequirements()
            .then((req: any) => { const hs = passwordRequirementHints(req); if (current() && hs.length) pwHint.textContent = `Password must include ${hs.join(', ')}.`; })
            .catch(() => { /* requirements unavailable */ });
        const firstName = textInput(user.firstName || '');
        const lastName = textInput(user.lastName || '');
        const email = textInput(user.email || '');
        const phone = textInput(user.phoneNumber || '');
        const organization = textInput(user.organization || '');
        const country = select(COUNTRIES, user.country || 'United States');
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

        const progress = h('div.hint', { role: 'status' });
        const body = h('div',
            h('div.hint', { style: { marginBottom: '12px' } },
                'You may now customize your account information. You also have the option of changing your account password.'),
            h('div.form-grid',
                field('Username', usernameInput),
                field(req('New Password'), pwInput),
                field(req('Confirm New Password'), confirmInput),
                pwHint,
                field('First Name', firstName),
                field('Last Name', lastName),
                field('Email', email),
                field('Country', country),
                field('State/Territory', state),
                field('Phone', phone),
                field('Organization', organization),
                field('Role', role),
                field('Business', industry),
                field('Description', description)), progress);

        let offExpired = () => {};
        let offEngine = () => {};
        const endSession = () => dialog.close();
        const dialog = modal({
            title: 'Welcome to Open Integration Engine',
            size: 'wide',
            body,
            onClose: () => {
                closed = true;
                acceptedPassword = null;
                (pwInput as any).value = '';
                (confirmInput as any).value = '';
                offExpired(); offEngine();
                window.removeEventListener('oie-session-changed', endSession);
                resolve(completed);
            },
            buttons: [
                {
                    label: 'Finish', primary: true,
                    onClick: async () => {
                        if (busy || !current()) return false;
                        const pw = (pwInput as any).value;
                        if (!pw) { toast('New Password is required', 'warn'); return false; }
                        if (pw !== (confirmInput as any).value) { toast('Passwords do not match', 'warn'); return false; }
                        // Freeze the whole attempt before its first await. Do not
                        // alter the caller's account until the profile is accepted.
                        const submitted = { ...user, id: userId,
                            firstName: firstName.value.trim(), lastName: lastName.value.trim(),
                            email: email.value.trim(), country: country.value, stateTerritory: state.value,
                            phoneNumber: phone.value.trim(), organization: organization.value.trim(),
                            role: role.value, industry: industry.value, description: (description as any).value
                        };
                        const signature = JSON.stringify(submitted);
                        progress.textContent = '';
                        busy = true;
                        try {
                            // Set the password first (Swing order); the engine answers
                            // with a list of policy violations if it's rejected.
                            if (acceptedPassword !== pw) {
                                const violations = passwordViolations(await api.users.updatePassword(userId, pw));
                                if (!current()) return false;
                                if (violations.length) { toast(passwordRejectedMessage(violations), 'error'); return false; }
                                acceptedPassword = pw;
                            }
                            if (acceptedProfile !== signature) {
                                await api.users.update(userId, submitted);
                                if (!current()) return false;
                                acceptedProfile = signature;
                                Object.assign(user, submitted);
                            }
                            await api.users.setPreference(userId, 'firstlogin', 'false');
                            if (!current()) return false;
                            toast('Welcome — your account is ready');
                            completed = true;
                            return true;   // closes the modal → onClose resolves
                        } catch (e: any) {
                            if (!current()) return false;
                            if (acceptedPassword === pw) progress.textContent = acceptedProfile === signature
                                ? 'Your password and profile were saved. Select Finish to retry the remaining changes.'
                                : 'Your password was saved. Select Finish to retry the remaining changes.';
                            toast(e.message || 'Could not complete setup', 'error');
                            return false;
                        } finally { busy = false; }
                    }
                }
            ]
        });
        offExpired = onSessionExpired(endSession);
        offEngine = onEngineUnknown(endSession);
        window.addEventListener('oie-session-changed', endSession);
        // Focus the password field once the modal has settled — but only if the
        // user hasn't already tabbed/clicked into the form. A blind focus here
        // steals it back mid-input (e.g. a fast typist, or a test filling the
        // confirm field, within 30ms of the modal opening), landing their next
        // keystrokes in the wrong field.
        const finish = dialog.el.querySelector('.modal-foot .btn-primary') as HTMLButtonElement | null;
        const syncFinish = () => { if (finish) finish.disabled = !((pwInput as any).value && (confirmInput as any).value); };
        body.addEventListener('input', syncFinish);
        syncFinish();
        setTimeout(() => { if (current() && !body.contains(document.activeElement)) pwInput.focus(); }, 30);
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
export async function maybeShowWelcome(user: any, assertSession: () => void): Promise<boolean> {
    if (!user || user.id == null) return true;
    let fl: any;
    try { fl = await api.users.getPreference(user.id, 'firstlogin'); }
    catch { assertSession(); return true; }
    // Expiry can arrive from another request before this dialog has subscribed.
    // Consult the enclosing login operation before opening any setup controls.
    assertSession();
    const show = !fl || /^(true|yes|on|1)$/i.test(String(fl).trim());
    return show ? showWelcomeDialog(user) : true;
}
