/*
 * HTTP Authentication — web admin plugin (httpauth ConnectorPropertiesPlugin
 * equivalent). Adds an "Authentication" panel to HTTP-based source connectors,
 * editing the httpauth entry in connector.properties.pluginProperties (keyed by
 * the selected auth type's FQCN). Registered through registerConnectorPropertiesPanel,
 * the same hook a third-party connector-properties plugin (e.g. an SSL manager)
 * would use. Defaults mirror server/src/com/mirth/connect/plugins/httpauth.
 */

import { h, clear, checkbox, select } from '/core/ui.js';
import { buildForm, asBool } from '/connectors/forms.js';

const AUTH_TYPE_OPTIONS = [
    { value: 'NONE', label: 'None' },
    { value: 'BASIC', label: 'Basic Authentication' },
    { value: 'DIGEST', label: 'Digest Authentication' },
    { value: 'JAVASCRIPT', label: 'JavaScript' },
    { value: 'CUSTOM', label: 'Custom Java Class' },
    { value: 'OAUTH2_VERIFICATION', label: 'OAuth 2.0 Token Verification' }
];

const AUTH_CLASSES = {
    NONE: 'com.mirth.connect.plugins.httpauth.NoneHttpAuthProperties',
    BASIC: 'com.mirth.connect.plugins.httpauth.basic.BasicHttpAuthProperties',
    DIGEST: 'com.mirth.connect.plugins.httpauth.digest.DigestHttpAuthProperties',
    JAVASCRIPT: 'com.mirth.connect.plugins.httpauth.javascript.JavaScriptHttpAuthProperties',
    CUSTOM: 'com.mirth.connect.plugins.httpauth.custom.CustomHttpAuthProperties',
    OAUTH2_VERIFICATION: 'com.mirth.connect.plugins.httpauth.oauth2.OAuth2HttpAuthProperties'
};

/* XStream inner-class element names for the Digest enum sets. */
const DIGEST_ALGORITHM_CLASS = 'com.mirth.connect.plugins.httpauth.digest.DigestHttpAuthProperties_-Algorithm';
const DIGEST_QOP_CLASS = 'com.mirth.connect.plugins.httpauth.digest.DigestHttpAuthProperties_-QOPMode';

/* JavaScriptHttpAuthProperties constructor default. */
const DEFAULT_AUTH_SCRIPT = '// Return an AuthenticationResult object to authenticate users.\n'
    + '// Boolean return values may also be used.\n'
    + '// You have access to the source map here.\n\n'
    + 'return AuthenticationResult.Success();';

function findAuthEntry(properties) {
    const pp = properties.pluginProperties;
    if (!pp || typeof pp !== 'object') return null;
    for (const [key, value] of Object.entries(pp)) {
        if (!key.toLowerCase().includes('httpauth')) continue;
        const entry = Array.isArray(value) ? value[0] : value;
        if (entry && typeof entry === 'object' && entry.authType) {
            return { key, entry };
        }
    }
    return null;
}

function currentAuthType(properties) {
    const state = findAuthEntry(properties);
    return state ? String(state.entry.authType) : 'NONE';
}

function defaultAuthProperties(type, version) {
    const base = { '@version': version, authType: type };
    switch (type) {
        case 'BASIC':
            return Object.assign(base, {
                realm: 'My Realm',
                credentials: { '@class': 'linked-hash-map' },
                isUseCredentialsVariable: false,
                credentialsVariable: ''
            });
        case 'DIGEST':
            return Object.assign(base, {
                realm: 'My Realm',
                algorithms: { '@class': 'linked-hash-set', [DIGEST_ALGORITHM_CLASS]: ['MD5', 'MD5_SESS'] },
                qopModes: { '@class': 'linked-hash-set', [DIGEST_QOP_CLASS]: ['AUTH', 'AUTH_INT'] },
                opaque: '${UUID}',
                credentials: { '@class': 'linked-hash-map' },
                isUseCredentialsVariable: false,
                credentialsVariable: ''
            });
        case 'JAVASCRIPT':
            return Object.assign(base, { script: DEFAULT_AUTH_SCRIPT });
        case 'CUSTOM':
            return Object.assign(base, {
                authenticatorClass: '',
                properties: { '@class': 'linked-hash-map' }
            });
        case 'OAUTH2_VERIFICATION':
            return Object.assign(base, {
                tokenLocation: 'HEADER',
                locationKey: 'Authorization',
                verificationURL: ''
            });
        default:
            return base;
    }
}

/* Replace the httpauth entry with a fresh properties object of the new type
   (other pluginProperties entries are preserved). */
function setAuthType(properties, type) {
    const state = findAuthEntry(properties);
    if (state && String(state.entry.authType) === type) return;
    if (!state && type === 'NONE') return;
    if (!properties.pluginProperties || typeof properties.pluginProperties !== 'object') {
        properties.pluginProperties = {};
    }
    if (state) delete properties.pluginProperties[state.key];
    properties.pluginProperties[AUTH_CLASSES[type]] = defaultAuthProperties(type, properties['@version']);
}

/* Checkbox group over an XStream enum set ({ '@class': 'linked-hash-set',
   <enum FQCN>: [names] }); preserves canonical option order when writing. */
function enumSetField(key, elementClass, label, options) {
    return {
        label, type: 'custom',
        render: (entry, { onChange }) => {
            const read = () => {
                const set = entry[key];
                let values = set && typeof set === 'object' ? set[elementClass] : null;
                if (values === null || values === undefined || values === '') values = [];
                if (!Array.isArray(values)) values = [values];
                return values.map(String);
            };
            const wrap = h('div.radio-group.inline');
            for (const opt of options) {
                wrap.appendChild(checkbox(opt.label, read().includes(opt.value), {
                    onChange: (e) => {
                        const selected = read().filter(v => v !== opt.value);
                        if (e.target.checked) selected.push(opt.value);
                        const values = options.map(o => o.value).filter(v => selected.includes(v));
                        entry[key] = { '@class': 'linked-hash-set', [elementClass]: values };
                        onChange();
                    }
                }).el);
            }
            return wrap;
        }
    };
}

/* Per-type editor rendered below the Authentication Type select. The nested
   buildForm operates on the auth entry object itself (its keys are not
   reachable by dot path from the receiver properties — FQCN keys contain dots). */
function authEditor(properties, onChange) {
    const wrap = h('div');
    const state = findAuthEntry(properties);
    if (!state) return wrap;
    const entry = state.entry;
    const useVar = (e) => asBool(e.isUseCredentialsVariable);
    const credentialFields = [
        { key: 'isUseCredentialsVariable', label: 'Use Credentials', type: 'radio', refresh: true, options: [
            { value: false, label: 'Table' },
            { value: true, label: 'Variable' }
        ] },
        { key: 'credentials', label: 'Credentials (user / password)', type: 'keyvalue', visible: (e) => !useVar(e) },
        { key: 'credentialsVariable', label: 'Credentials Variable', type: 'text', width: '220px', visible: useVar }
    ];
    let fields;
    switch (String(entry.authType)) {
        case 'BASIC':
            fields = [
                { key: 'realm', label: 'Realm', type: 'text', width: '220px' },
                ...credentialFields
            ];
            break;
        case 'DIGEST':
            fields = [
                { key: 'realm', label: 'Realm', type: 'text', width: '220px' },
                enumSetField('algorithms', DIGEST_ALGORITHM_CLASS, 'Algorithms', [
                    { value: 'MD5', label: 'MD5' },
                    { value: 'MD5_SESS', label: 'MD5-sess' }
                ]),
                enumSetField('qopModes', DIGEST_QOP_CLASS, 'QOP Modes', [
                    { value: 'AUTH', label: 'auth' },
                    { value: 'AUTH_INT', label: 'auth-int' }
                ]),
                { key: 'opaque', label: 'Opaque', type: 'text', width: '220px' },
                ...credentialFields
            ];
            break;
        case 'JAVASCRIPT':
            fields = [
                { key: 'script', label: 'Script', type: 'code', language: 'javascript', minHeight: '200px' }
            ];
            break;
        case 'CUSTOM':
            fields = [
                { key: 'authenticatorClass', label: 'Class Name', type: 'text', width: '420px', placeholder: 'com.example.MyAuthenticator' },
                { key: 'properties', label: 'Properties', type: 'keyvalue' }
            ];
            break;
        case 'OAUTH2_VERIFICATION':
            fields = [
                { key: 'tokenLocation', label: 'Token Location', type: 'select', width: '160px', options: [
                    { value: 'HEADER', label: 'Request Header' },
                    { value: 'QUERY', label: 'Query Parameter' }
                ] },
                { key: 'locationKey', label: 'Token Field Name', type: 'text', width: '220px' },
                { key: 'verificationURL', label: 'Verification URL', type: 'text', width: '420px' }
            ];
            break;
        default:
            fields = [];
    }
    if (fields.length) buildForm(wrap, entry, fields, onChange);
    return wrap;
}

/* Authentication Type select + per-type editor, re-rendering on type change. */
function renderAuth(host, properties, onChange) {
    clear(host);
    const sel = select(AUTH_TYPE_OPTIONS, currentAuthType(properties), {
        onChange: (e) => { setAuthType(properties, e.target.value); onChange(); renderAuth(host, properties, onChange); }
    });
    sel.style.width = '220px';
    host.appendChild(h('div.field', h('label', 'Authentication Type'), sel));
    if (currentAuthType(properties) !== 'NONE') host.appendChild(authEditor(properties, onChange));
}

export function register(platform) {
    platform.registerConnectorPropertiesPanel({
        id: 'httpauth',
        title: 'Authentication',
        // A truthy fqcn so the channel editor renders this panel; the auth type
        // (and thus the stored class) is managed inside render() via pluginProperties.
        propertiesClass: (transportName, mode, connector) =>
            AUTH_CLASSES[currentAuthType((connector && connector.properties) || {})] || AUTH_CLASSES.NONE,
        isSupported: (transportName, mode) => transportName === 'HTTP Listener' && mode === 'SOURCE',
        render(host, { connector, onChange }) {
            if (!connector || !connector.properties) return;
            renderAuth(host, connector.properties, onChange);
        }
    });
}
