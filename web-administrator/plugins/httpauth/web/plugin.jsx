/*
 * HTTP Authentication — web admin plugin (httpauth ConnectorPropertiesPlugin
 * equivalent, React). Adds an "Authentication" panel to HTTP-based source
 * connectors, editing the httpauth entry in connector.properties.pluginProperties
 * (keyed by the selected auth type's FQCN). Registered through
 * registerConnectorPropertiesPanel, the same hook a third-party
 * connector-properties plugin (e.g. an SSL manager) would use. Defaults mirror
 * server/src/com/mirth/connect/plugins/httpauth.
 *
 * Authored in JSX against the host's React (platform.React) so the plugin
 * component shares the app's single React instance. The auth-entry data model
 * (find/default/setAuthType, the XStream enum-set + linked-hash-map shapes) is
 * the same as the original imperative plugin; only the rendering became
 * React/JSX. The registry now holds a `component` that receives the same ctx the
 * old render(host, ctx) got — { getEntry, setEntry, propertiesClass, connector,
 * channel, platform, onChange } — as PROPS and returns JSX. The component still
 * mutates connector.properties (the object getEntry/setEntry read) and calls
 * onChange() to mark the channel dirty, matching the imperative version.
 */
import { platform } from '@oie/web-shell';
const React = platform.React;

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

function asBool(value) {
    return value === true || value === 'true';
}

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

/* ---- XStream linked-hash-map (credentials/properties) helpers ----
   Map<String,String> { '@class': 'linked-hash-map', entry: [{ string: [k, v] }] }. */
function mapRows(map) {
    const out = [];
    if (!map || typeof map !== 'object') return out;
    let entries = map.entry;
    if (entries === null || entries === undefined || entries === '') return out;
    if (!Array.isArray(entries)) entries = [entries];
    for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        if (Array.isArray(entry.string)) out.push([String(entry.string[0] ?? ''), String(entry.string[1] ?? '')]);
        else if (entry.string !== undefined) out.push([String(entry.string), '']);
    }
    return out;
}

function writeMapRows(rows) {
    const target = { '@class': 'linked-hash-map' };
    const clean = rows.filter(([k]) => k !== '' && k !== null && k !== undefined);
    if (clean.length) target.entry = clean.map(([k, v]) => ({ string: [k, v] }));
    return target;
}

export function register(platform) {

    /* CodeMirror/Monaco island: mounts platform.createCodeEditor's .el into a
       ref'd div and pushes edits back through onChange. (Same code editor the
       imperative buildForm 'code' field used.) */
    function CodeField({ value, language, minHeight, onChange }) {
        const hostRef = React.useRef(null);
        const editorRef = React.useRef(null);
        const onChangeRef = React.useRef(onChange);
        onChangeRef.current = onChange;
        React.useEffect(() => {
            const editor = platform.createCodeEditor({
                value: value === null || value === undefined ? '' : String(value),
                language: language || 'text',
                minHeight: minHeight || '240px',
                onChange: (v) => onChangeRef.current(v)
            });
            editorRef.current = editor;
            if (hostRef.current) hostRef.current.appendChild(editor.el);
            return () => {
                if (editor.destroy) editor.destroy();
                if (hostRef.current) hostRef.current.replaceChildren();
            };
            // Mount once; the editor owns its own value after mount.
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, []);
        return <div ref={hostRef} />;
    }

    /* Key/value table over a linked-hash-map (credentials user/password, custom
       properties). Mutates entry[key] in place and notifies. */
    function KeyValueField({ entry, fieldKey, onChange }) {
        const [rows, setRows] = React.useState(() => mapRows(entry[fieldKey]));
        const commit = (next) => {
            entry[fieldKey] = writeMapRows(next);
            setRows(next);
            onChange();
        };
        return (
            <div>
                {rows.map((row, i) => (
                    <div key={i} style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                        <input type="text" placeholder="Name" style={{ flex: '1' }} value={row[0]}
                            onInput={(e) => { const next = rows.slice(); next[i] = [e.target.value, row[1]]; commit(next); }}
                            onChange={(e) => { const next = rows.slice(); next[i] = [e.target.value, row[1]]; commit(next); }} />
                        <input type="text" placeholder="Value" style={{ flex: '2' }} value={row[1]}
                            onInput={(e) => { const next = rows.slice(); next[i] = [row[0], e.target.value]; commit(next); }}
                            onChange={(e) => { const next = rows.slice(); next[i] = [row[0], e.target.value]; commit(next); }} />
                        <button type="button" className="icon-btn" title="Remove"
                            onClick={() => { const next = rows.slice(); next.splice(i, 1); commit(next); }}>
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                                strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M6 6l12 12M18 6L6 18" />
                            </svg>
                        </button>
                    </div>
                ))}
                <button type="button" className="btn"
                    onClick={() => commit([...rows, ['', '']])}>Add</button>
            </div>
        );
    }

    /* Checkbox group over an XStream enum set ({ '@class': 'linked-hash-set',
       <enum FQCN>: [names] }); preserves canonical option order when writing. */
    function EnumSetField({ entry, fieldKey, elementClass, options, onChange }) {
        const read = () => {
            const set = entry[fieldKey];
            let values = set && typeof set === 'object' ? set[elementClass] : null;
            if (values === null || values === undefined || values === '') values = [];
            if (!Array.isArray(values)) values = [values];
            return values.map(String);
        };
        const [selected, setSelected] = React.useState(read);
        const toggle = (optValue, checked) => {
            let next = selected.filter(v => v !== optValue);
            if (checked) next.push(optValue);
            const ordered = options.map(o => o.value).filter(v => next.includes(v));
            entry[fieldKey] = { '@class': 'linked-hash-set', [elementClass]: ordered };
            setSelected(ordered);
            onChange();
        };
        return (
            <div className="radio-group inline">
                {options.map(opt => (
                    <label className="check" key={opt.value}>
                        <input type="checkbox" checked={selected.includes(opt.value)}
                            onChange={(e) => toggle(opt.value, e.target.checked)} />
                        {opt.label}
                    </label>
                ))}
            </div>
        );
    }

    function CformRow({ label, top, children }) {
        return (
            <React.Fragment>
                <label className={'cform-label' + (top ? ' top' : '')}>{label ? `${label}:` : ''}</label>
                <div className={'cform-control' + (top ? ' wide' : '')}>{children}</div>
            </React.Fragment>
        );
    }

    function TextRow({ label, entry, fieldKey, width, placeholder, onChange }) {
        return (
            <CformRow label={label}>
                <input type="text" placeholder={placeholder} style={{ width: width || '320px' }}
                    value={entry[fieldKey] == null ? '' : String(entry[fieldKey])}
                    onInput={(e) => { entry[fieldKey] = e.target.value; onChange(); }}
                    onChange={(e) => { entry[fieldKey] = e.target.value; onChange(); }} />
            </CformRow>
        );
    }

    /* Credentials (table/variable) sub-form shared by BASIC + DIGEST. */
    function CredentialFields({ entry, onChange }) {
        const [useVar, setUseVar] = React.useState(asBool(entry.isUseCredentialsVariable));
        const name = React.useMemo(() => 'httpauth-cred-' + Math.random().toString(36).slice(2), []);
        const setUse = (v) => { entry.isUseCredentialsVariable = v; setUseVar(v); onChange(); };
        return (
            <React.Fragment>
                <CformRow label="Use Credentials">
                    <div className="radio-group inline">
                        <label className="check">
                            <input type="radio" name={name} checked={!useVar} onChange={() => setUse(false)} /> Table
                        </label>
                        <label className="check">
                            <input type="radio" name={name} checked={useVar} onChange={() => setUse(true)} /> Variable
                        </label>
                    </div>
                </CformRow>
                {!useVar && (
                    <CformRow label="Credentials (user / password)" top>
                        <KeyValueField entry={entry} fieldKey="credentials" onChange={onChange} />
                    </CformRow>
                )}
                {useVar && (
                    <TextRow label="Credentials Variable" entry={entry} fieldKey="credentialsVariable"
                        width="220px" onChange={onChange} />
                )}
            </React.Fragment>
        );
    }

    /* Per-type editor rendered below the Authentication Type select. Operates on
       the auth entry object itself (its keys are not reachable by dot path from
       the receiver properties — FQCN keys contain dots). */
    function AuthEditor({ entry, onChange }) {
        switch (String(entry.authType)) {
            case 'BASIC':
                return (
                    <div className="cform"><div className="cform-section"><div className="cform-grid">
                        <TextRow label="Realm" entry={entry} fieldKey="realm" width="220px" onChange={onChange} />
                        <CredentialFields entry={entry} onChange={onChange} />
                    </div></div></div>
                );
            case 'DIGEST':
                return (
                    <div className="cform"><div className="cform-section"><div className="cform-grid">
                        <TextRow label="Realm" entry={entry} fieldKey="realm" width="220px" onChange={onChange} />
                        <CformRow label="Algorithms">
                            <EnumSetField entry={entry} fieldKey="algorithms" elementClass={DIGEST_ALGORITHM_CLASS}
                                options={[{ value: 'MD5', label: 'MD5' }, { value: 'MD5_SESS', label: 'MD5-sess' }]}
                                onChange={onChange} />
                        </CformRow>
                        <CformRow label="QOP Modes">
                            <EnumSetField entry={entry} fieldKey="qopModes" elementClass={DIGEST_QOP_CLASS}
                                options={[{ value: 'AUTH', label: 'auth' }, { value: 'AUTH_INT', label: 'auth-int' }]}
                                onChange={onChange} />
                        </CformRow>
                        <TextRow label="Opaque" entry={entry} fieldKey="opaque" width="220px" onChange={onChange} />
                        <CredentialFields entry={entry} onChange={onChange} />
                    </div></div></div>
                );
            case 'JAVASCRIPT':
                return (
                    <div className="cform"><div className="cform-section"><div className="cform-grid">
                        <CformRow label="Script" top>
                            <CodeField value={entry.script} language="javascript" minHeight="200px"
                                onChange={(v) => { entry.script = v; onChange(); }} />
                        </CformRow>
                    </div></div></div>
                );
            case 'CUSTOM':
                return (
                    <div className="cform"><div className="cform-section"><div className="cform-grid">
                        <TextRow label="Class Name" entry={entry} fieldKey="authenticatorClass" width="420px"
                            placeholder="com.example.MyAuthenticator" onChange={onChange} />
                        <CformRow label="Properties" top>
                            <KeyValueField entry={entry} fieldKey="properties" onChange={onChange} />
                        </CformRow>
                    </div></div></div>
                );
            case 'OAUTH2_VERIFICATION':
                return (
                    <div className="cform"><div className="cform-section"><div className="cform-grid">
                        <CformRow label="Token Location">
                            <select style={{ width: '160px' }} value={entry.tokenLocation == null ? '' : String(entry.tokenLocation)}
                                onChange={(e) => { entry.tokenLocation = e.target.value; onChange(); }}>
                                <option value="HEADER">Request Header</option>
                                <option value="QUERY">Query Parameter</option>
                            </select>
                        </CformRow>
                        <TextRow label="Token Field Name" entry={entry} fieldKey="locationKey" width="220px" onChange={onChange} />
                        <TextRow label="Verification URL" entry={entry} fieldKey="verificationURL" width="420px" onChange={onChange} />
                    </div></div></div>
                );
            default:
                return <div />;
        }
    }

    /* Authentication Type select + per-type editor. Type changes mutate
       connector.properties via setAuthType and force a re-render. ctx (props):
       { connector, onChange } (+ getEntry/setEntry/propertiesClass/channel/platform
       which this panel does not need — it edits connector.properties directly,
       the same object getEntry/setEntry read/write). */
    function HttpAuthPanel({ connector, onChange }) {
        const [, force] = React.useReducer((x) => x + 1, 0);
        if (!connector || !connector.properties) return null;
        const properties = connector.properties;
        const type = currentAuthType(properties);
        const state = findAuthEntry(properties);

        return (
            <div>
                <div className="field">
                    <label>Authentication Type</label>
                    <select style={{ width: '220px' }} value={type}
                        onChange={(e) => { setAuthType(properties, e.target.value); onChange(); force(); }}>
                        {AUTH_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                </div>
                {type !== 'NONE' && state && (
                    <AuthEditor key={state.key} entry={state.entry} onChange={onChange} />
                )}
            </div>
        );
    }

    platform.registerConnectorPropertiesPanel({
        id: 'httpauth',
        title: 'Authentication',
        // A truthy fqcn so the channel editor renders this panel; the auth type
        // (and thus the stored class) is managed inside the component via pluginProperties.
        propertiesClass: (transportName, mode, connector) =>
            AUTH_CLASSES[currentAuthType((connector && connector.properties) || {})] || AUTH_CLASSES.NONE,
        // Engine parity: HttpAuthConnectorPropertiesPlugin.isConnectorPropertiesPluginSupported
        // attaches to these source listeners.
        isSupported: (transportName, mode) => mode === 'SOURCE' && [
            'HTTP Listener', 'Web Service Listener', 'FHIR Listener', 'Health Data Hub Listener'
        ].includes(transportName),
        component: HttpAuthPanel
    });
}
