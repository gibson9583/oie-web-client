/*
 * File Reader (FileReceiverProperties) / File Writer (FileDispatcherProperties).
 *
 * React port: def.render(host, ctx) -> def.component(ctx) => JSX. The scheme
 * defaults, scheme-property class handling, the shared scheme-settings field
 * block, the FTP initial-commands custom field, and all defaults are reused
 * VERBATIM. ensureSchemeProperties runs at the top of component() (idempotent —
 * it only rebuilds schemeProperties when the class no longer matches), matching
 * the imperative render which called it before buildForm.
 */

import { React } from './react-platform.js';
import { h, clear, checkbox, select, textInput } from '@oie/web-ui';
// h is used for the FTP initial-commands textarea and the File Writer
// File-Exists 3-way radio; checkbox is the inline Ignore-Maximum control
// (rendered as custom DOM / append, matching http.jsx idioms).
import {
    ConnectorForm, PollSection, connectorTestButton, asBool, YES_NO,
    defaultSourceProperties, defaultDestinationProperties, defaultPollProperties, CHARSETS, requireFields
} from './react-forms.js';

const SCHEMES = [
    { value: 'FILE', label: 'File' },
    { value: 'FTP', label: 'FTP' },
    { value: 'SFTP', label: 'SFTP' },
    { value: 'S3', label: 'Amazon S3' },
    { value: 'SMB', label: 'SMB' },
    { value: 'WEBDAV', label: 'WebDAV' }
];

/* Per-scheme connection-field enablement, mirroring FileReader/FileWriter
   onSchemeChange(): each connection control is disabled by default and only
   enabled for the schemes listed below (Swing setEnabled). */
const anonymousEnabled = (p) => ['FTP', 'S3', 'WEBDAV'].includes(p.scheme);
const timeoutEnabled = (p) => ['FTP', 'SFTP', 'S3', 'SMB'].includes(p.scheme);
const secureEnabled = (p) => p.scheme === 'WEBDAV';
const passiveEnabled = (p) => p.scheme === 'FTP';
const validateEnabled = (p) => p.scheme === 'FTP';
/* Username/Password follow the Anonymous radios (anonymousYes/NoActionPerformed):
   disabled when scheme==FILE (no credentials) or Anonymous=Yes. */
const credentialsDisabled = (p) => p.scheme === 'FILE' || (anonymousEnabled(p) && asBool(p.anonymous));

/* Swing FileReader/FileWriter.checkProperties credential requirements (shared):
   with Anonymous=No, Username is required unless S3 is using the default
   credential provider chain. Password is additionally required unless SFTP is
   using key-only auth (ignorePassword = SFTP && !passwordAuth). */
const credentialsRequired = (p) => !asBool(p.anonymous)
    && (p.scheme !== 'S3' || !asBool(p.schemeProperties && p.schemeProperties.useDefaultCredentialProviderChain));
const passwordRequired = (p) => credentialsRequired(p)
    && !(p.scheme === 'SFTP' && !asBool(p.schemeProperties && p.schemeProperties.passwordAuth));

/* anonymousYesActionPerformed / anonymousNoActionPerformed forced text:
   Anonymous=Yes -> 'anonymous'/'anonymous' (''/'' for S3); S3+No clears both. */
function applyAnonymous(p) {
    // Anonymous / S3 just clear + disable the credential fields — we do NOT
    // prefill the placeholder 'anonymous'/'anonymous' the Swing client used.
    if (p.scheme === 'S3' || asBool(p.anonymous)) {
        p.username = '';
        p.password = '';
    }
}

/* Selecting Binary forces Encoding back to Default and disables it
   (fileTypeBinaryActionPerformed: setSelectedIndex(0) = DEFAULT_ENCODING). */
function onFileTypeSet(p) {
    if (asBool(p.binary)) p.charsetEncoding = 'DEFAULT_ENCODING';
}

const FILE_TYPE_OPTIONS = [
    { value: true, label: 'Binary' },
    { value: false, label: 'Text' }
];

/* File Writer "File Exists" is a single 3-way radio (Append/Overwrite/Error) in
   Swing, mapping onto the two booleans outputAppend + errorOnExists:
     Append    -> outputAppend=true,  errorOnExists=false
     Error     -> outputAppend=false, errorOnExists=true
     Overwrite -> outputAppend=false, errorOnExists=false
   Selecting Append also forces Create Temp File=No (fileExistsAppendRadioActionPerformed).
   Append is disabled for S3/WEBDAV (onSchemeChange allowAppend=false). Rendered
   as a custom mutually-exclusive group so the invalid both-true combo (which the
   two independent web radios allowed) cannot occur. */
function fileExistsValue(p) {
    if (asBool(p.outputAppend)) return 'append';
    if (asBool(p.errorOnExists)) return 'error';
    return 'overwrite';
}
function fileExistsField() {
    const allowAppend = (p) => p.scheme !== 'S3' && p.scheme !== 'WEBDAV';
    return {
        label: 'File Exists', type: 'custom', refresh: true,
        render: (p, { onChange, repaint }) => {
            const current = fileExistsValue(p);
            const group = h('div.radio-group.inline-row');
            const opts = [
                { value: 'append', label: 'Append' },
                { value: 'overwrite', label: 'Overwrite' },
                { value: 'error', label: 'Error' }
            ];
            opts.forEach((o) => {
                const input = h('input', {
                    type: 'radio', name: 'file-exists',
                    checked: o.value === current,
                    disabled: o.value === 'append' && !allowAppend(p),
                    onChange: () => {
                        p.outputAppend = o.value === 'append';
                        p.errorOnExists = o.value === 'error';
                        if (o.value === 'append') p.temporary = false;
                        onChange();
                        if (repaint) repaint();
                    }
                });
                group.appendChild(h('label.check', input, o.label));
            });
            return group;
        }
    };
}

/* S3 Region helper combo: a <select> of known Region ids plus "Custom".
   Selecting an id fills schemeProperties.region; the combo shows "Custom"
   whenever the typed region isn't a known id. The text field stays the source
   of truth (free-text), mirroring the Swing regionComboBox sitting beside the
   regionField. Rebuilt on every repaint, so it always reflects the field. */
function regionPicker(p, ctx) {
    const sp = p.schemeProperties || {};
    const current = sp.region || '';
    const isKnown = S3_REGIONS.includes(current);
    const opts = [{ value: 'Custom', label: 'Custom' }, ...S3_REGIONS.map((r) => ({ value: r, label: r }))];
    const sel = select(opts, isKnown ? current : 'Custom', {
        onChange: (e) => {
            const v = e.target.value;
            if (v === 'Custom') return; // typing drives "Custom"; selecting it is a no-op (matches Swing)
            sp.region = v;
            ctx.onChange();
            if (ctx.repaint) ctx.repaint();
        }
    });
    sel.style.width = '160px';
    sel.style.marginLeft = '6px';
    return sel;
}

/* Per-scheme host prefix label (FileWriter/FileReader hostLabel): the bare scheme
   for ftp/sftp/smb, http(s):// for WebDAV (secure), "S3 Bucket:" for S3. */
function schemePrefix(p) {
    switch (String(p.scheme)) {
        case 'FTP': return 'ftp://';
        case 'SFTP': return 'sftp://';
        case 'S3': return 'S3 Bucket:';
        case 'SMB': return 'smb://';
        case 'WEBDAV': return asBool(p.secure) ? 'https://' : 'http://';
        default: return '';
    }
}

/* Swing host/path split row, shown for non-FILE schemes (FileWriter hostField +
   pathField). The directory property `host` is "<host>/<path>" — split on the
   first '/' to load, recomposed on edit (getProperties: host + "/" + path). Raw
   inputs commit via the connector onChange (markDirty) WITHOUT repainting, so
   typing keeps focus. */
function hostPathField(onChange) {
    return {
        label: '', type: 'custom',
        visible: (p) => p.scheme !== 'FILE',
        render: (p) => {
            const host = String(p.host ?? '');
            const slash = host.indexOf('/');
            const hostPart = slash === -1 ? host : host.slice(0, slash);
            const pathPart = slash === -1 ? '' : host.slice(slash + 1);
            const hostInput = textInput(hostPart, { class: 'w-[220px]' });
            const pathInput = textInput(pathPart, { class: 'flex-1 min-w-[160px]' });
            const recompose = () => { p.host = hostInput.value + '/' + pathInput.value; onChange(); };
            hostInput.addEventListener('input', recompose);
            pathInput.addEventListener('input', recompose);
            return h('div', { class: 'flex items-center gap-[6px]' },
                h('span', { class: 'text-[var(--muted,#888)] whitespace-nowrap' }, schemePrefix(p)),
                hostInput, h('span', '/'), pathInput);
        }
    };
}

/* ---- scheme-specific properties (FileReceiver/FileDispatcher schemeProperties) ----
 * The abstract SchemeProperties field is null for FILE/WEBDAV; the other
 * schemes carry a concrete subclass identified by '@class'. Defaults mirror
 * the Java constructors (server/src/com/mirth/connect/connectors/file). */

const SCHEME_PROPERTY_CLASSES = {
    FTP: 'com.mirth.connect.connectors.file.FTPSchemeProperties',
    SFTP: 'com.mirth.connect.connectors.file.SftpSchemeProperties',
    S3: 'com.mirth.connect.connectors.file.S3SchemeProperties',
    SMB: 'com.mirth.connect.connectors.file.SmbSchemeProperties'
};

/* Known AWS Region ids (AdvancedS3SettingsDialog populates this combo from the
   SDK's Region.regions()). Mirrored client-side as a static list since the SDK
   enum isn't reachable from the browser and no servlet exposes it. The Region
   text field stays free-text and "Custom" is always available, so an absent id
   never blocks the user — picking an item just fills the field, exactly like the
   Swing regionComboBox. */
const S3_REGIONS = [
    'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
    'af-south-1',
    'ap-east-1', 'ap-south-1', 'ap-south-2',
    'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3',
    'ap-southeast-1', 'ap-southeast-2', 'ap-southeast-3', 'ap-southeast-4',
    'ca-central-1', 'ca-west-1',
    'eu-central-1', 'eu-central-2', 'eu-west-1', 'eu-west-2', 'eu-west-3',
    'eu-north-1', 'eu-south-1', 'eu-south-2',
    'il-central-1',
    'me-south-1', 'me-central-1',
    'sa-east-1',
    'us-gov-east-1', 'us-gov-west-1',
    'cn-north-1', 'cn-northwest-1'
];

/* SFTP authentication: a single 3-way ButtonGroup in Swing (Password | Public
   Key | Both, AdvancedSftpSettingsDialog.privateKeyButtonGroup) mapping onto the
   two booleans passwordAuth + keyAuth:
     Password   -> passwordAuth=true,  keyAuth=false
     Public Key -> passwordAuth=false, keyAuth=true
     Both       -> passwordAuth=true,  keyAuth=true
   Rendered as a custom mutually-exclusive group (like fileExistsField) so the
   invalid "neither" combo the two independent web radios allowed cannot occur,
   and Key File/Passphrase are revealed for Public Key OR Both. */
function sftpAuthValue(sp) {
    const pw = asBool(sp && sp.passwordAuth);
    const key = asBool(sp && sp.keyAuth);
    if (pw && key) return 'both';
    if (key) return 'key';
    return 'password';
}
function sftpKeyEnabled(p) {
    const v = sftpAuthValue(p.schemeProperties);
    return v === 'key' || v === 'both';
}
function sftpAuthField() {
    return {
        label: 'Authentication', type: 'custom', refresh: true,
        visible: (p) => p.scheme === 'SFTP',
        render: (p, { onChange, repaint }) => {
            const sp = p.schemeProperties || {};
            const current = sftpAuthValue(sp);
            const group = h('div.radio-group.inline-row');
            const opts = [
                { value: 'password', label: 'Password' },
                { value: 'key', label: 'Public Key' },
                { value: 'both', label: 'Both' }
            ];
            opts.forEach((o) => {
                const input = h('input', {
                    type: 'radio', name: 'sftp-auth',
                    checked: o.value === current,
                    onChange: () => {
                        sp.passwordAuth = o.value === 'password' || o.value === 'both';
                        sp.keyAuth = o.value === 'key' || o.value === 'both';
                        onChange();
                        if (repaint) repaint();
                    }
                });
                group.appendChild(h('label.check', input, o.label));
            });
            return group;
        }
    };
}

const SMB_VERSIONS = [
    { value: 'SMB1', label: 'SMB v1' },
    { value: 'SMB202', label: 'SMB v2.0.2' },
    { value: 'SMB210', label: 'SMB v2.1' },
    { value: 'SMB300', label: 'SMB v3.0' },
    { value: 'SMB302', label: 'SMB v3.0.2' },
    { value: 'SMB311', label: 'SMB v3.1.1' }
];

function defaultSchemeProperties(scheme) {
    switch (scheme) {
        case 'FTP':
            return {
                '@class': SCHEME_PROPERTY_CLASSES.FTP,
                initialCommands: null
            };
        case 'SFTP':
            return {
                '@class': SCHEME_PROPERTY_CLASSES.SFTP,
                passwordAuth: true,
                keyAuth: false,
                keyFile: '',
                passPhrase: '',
                hostKeyChecking: 'ask',
                knownHostsFile: '',
                configurationSettings: { '@class': 'linked-hash-map' }
            };
        case 'S3':
            return {
                '@class': SCHEME_PROPERTY_CLASSES.S3,
                useDefaultCredentialProviderChain: true,
                useTemporaryCredentials: false,
                duration: 7200,
                region: 'us-east-1',
                customHeaders: { '@class': 'linked-hash-map' }
            };
        case 'SMB':
            return {
                '@class': SCHEME_PROPERTY_CLASSES.SMB,
                smbMinVersion: 'SMB202',
                smbMaxVersion: 'SMB311'
            };
        default:
            return null;
    }
}

/* Create the scheme's properties object when missing or of the wrong class
   (e.g. the user just switched schemes); leave a matching object untouched. */
function ensureSchemeProperties(properties) {
    const cls = SCHEME_PROPERTY_CLASSES[properties.scheme];
    if (!cls) return;
    const sp = properties.schemeProperties;
    if (!sp || typeof sp !== 'object' || sp['@class'] !== cls) {
        properties.schemeProperties = defaultSchemeProperties(properties.scheme);
    }
}

/* Reader scheme switch (FileReader.schemeComboBoxActionPerformed/onSchemeChange):
   rebuild schemeProperties for the new scheme and apply the forced selections
   Swing performs — WEBDAV forces Passive Mode=No, and the Anonymous radios are
   re-applied (forcing username/password defaults). */
function onSchemeChange(properties) {
    if (SCHEME_PROPERTY_CLASSES[properties.scheme]) {
        ensureSchemeProperties(properties);
    } else {
        properties.schemeProperties = null;
    }
    if (properties.scheme === 'WEBDAV') properties.passive = false;
    applyAnonymous(properties);
}

/* Writer scheme switch additionally forces Validate Connection=No for WEBDAV,
   and for S3 forces Create Temp File=No (allowAppend=false; tempFile disabled). */
function onWriterSchemeChange(properties) {
    onSchemeChange(properties);
    if (properties.scheme === 'WEBDAV') properties.validateConnection = false;
    if (properties.scheme === 'S3') {
        properties.temporary = false;
        if (asBool(properties.outputAppend)) properties.outputAppend = false;
    }
}

/* FTP initial commands: List<String> rendered one-per-line. */
function ftpInitialCommandsField() {
    return {
        label: 'Initial Commands', type: 'custom', span: true,
        visible: (p) => p.scheme === 'FTP',
        render: (p, { onChange }) => {
            const sp = p.schemeProperties || {};
            let lines = sp.initialCommands && typeof sp.initialCommands === 'object'
                ? sp.initialCommands.string : null;
            if (lines === null || lines === undefined || lines === '') lines = [];
            if (!Array.isArray(lines)) lines = [lines];
            const area = h('textarea', {
                rows: 3,
                placeholder: 'One FTP command per line, sent after connecting',
                onInput: (e) => {
                    const values = e.target.value.split('\n').map((s) => s.trim()).filter((s) => s !== '');
                    sp.initialCommands = values.length ? { string: values } : null;
                    onChange();
                }
            }, lines.map(String).join('\n'));
            return area;
        }
    };
}

/* Section of scheme-specific fields, shared by File Reader and File Writer. */
function schemeSettingsFields() {
    const sftp = (p) => p.scheme === 'SFTP';
    const s3 = (p) => p.scheme === 'S3';
    return [
        { section: 'FTP Settings', visible: (p) => p.scheme === 'FTP' },
        ftpInitialCommandsField(),
        { section: 'SFTP Settings', visible: sftp },
        sftpAuthField(),
        { key: 'schemeProperties.keyFile', label: 'Public/Private Key File', type: 'text', width: '320px', visible: (p) => sftp(p) && sftpKeyEnabled(p) },
        { key: 'schemeProperties.passPhrase', label: 'Passphrase', type: 'password', width: '220px', visible: (p) => sftp(p) && sftpKeyEnabled(p) },
        { key: 'schemeProperties.hostKeyChecking', label: 'Host Key Checking', type: 'select', width: '120px', visible: sftp, options: [
            { value: 'yes', label: 'Yes' },
            { value: 'ask', label: 'Ask' },
            { value: 'no', label: 'No' }
        ] },
        { key: 'schemeProperties.knownHostsFile', label: 'Known Hosts File', type: 'text', width: '320px', visible: sftp },
        { key: 'schemeProperties.configurationSettings', label: 'Configuration Options', type: 'keyvalue', visible: sftp },
        { section: 'Amazon S3 Settings', visible: s3 },
        {
            key: 'schemeProperties.useDefaultCredentialProviderChain', label: 'Use Default Credential Provider Chain',
            type: 'radio', options: YES_NO, refresh: true, visible: s3,
            // Swing AdvancedS3SettingsDialog greys these + shows a red warning when
            // the connector is using Anonymous credentials.
            disabled: (p) => asBool(p.anonymous),
            append: (p) => asBool(p.anonymous)
                ? h('span', { class: 'text-[#c0392b] ml-3 font-[500]' }, 'Anonymous credentials are currently in use')
                : null,
            tooltip: 'When No, the Username/Password above are used as the AWS access key ID / secret access key'
        },
        { key: 'schemeProperties.useTemporaryCredentials', label: 'Use Temporary Credentials', type: 'radio', options: YES_NO, refresh: true, visible: s3, disabled: (p) => asBool(p.anonymous) },
        { key: 'schemeProperties.duration', label: 'Duration (seconds)', type: 'number', numeric: true, width: '110px', visible: (p) => s3(p) && asBool(p.schemeProperties && p.schemeProperties.useTemporaryCredentials), disabled: (p) => asBool(p.anonymous) },
        {
            key: 'schemeProperties.region', label: 'Region', type: 'text', width: '160px', visible: s3, placeholder: 'us-east-1', refresh: true,
            // Region helper combo (AdvancedS3SettingsDialog.regionComboBox): picking
            // a known Region id fills the text field; a non-matching typed value
            // snaps the combo to "Custom" (regionFieldUpdated/regionComboBoxActionPerformed).
            append: (p, ctx) => regionPicker(p, ctx)
        },
        { key: 'schemeProperties.customHeaders', label: 'Custom HTTP Headers', type: 'keyvalue', mapShape: 'list', visible: s3 },
        { section: 'SMB Settings', visible: (p) => p.scheme === 'SMB' },
        { key: 'schemeProperties.smbMinVersion', label: 'SMB Minimum Version', type: 'select', options: SMB_VERSIONS, width: '140px', visible: (p) => p.scheme === 'SMB' },
        { key: 'schemeProperties.smbMaxVersion', label: 'SMB Maximum Version', type: 'select', options: SMB_VERSIONS, width: '140px', visible: (p) => p.scheme === 'SMB' }
    ];
}

/* File-name template variables (Swing MirthVariableList). A connector-specific
   drag MIME type (not text/plain) so the variables drop ONLY into the move/error
   fields below — never into other text inputs, which ignore an unknown type. */
const FILE_NAME_VARS = ['channelName', 'channelId', 'DATE', 'COUNT', 'UUID', 'SYSTIME', 'originalFilename'];
const FILE_VAR_MIME = 'application/x-oie-filevar';

/* While a file-variable is being dragged, block the drop everywhere EXCEPT the
   move/error fields (marked data-file-var-target). Browsers can expose a dragged
   element's text as text/plain, which any input would otherwise accept; cancelling
   the drop's default at capture phase prevents that on non-target elements. */
const isFileVarDrag = (ev) => ev.dataTransfer && Array.from(ev.dataTransfer.types).includes(FILE_VAR_MIME);
const isFileVarTarget = (t) => t instanceof HTMLElement && t.dataset.fileVarTarget === '1';
function fileVarDocDragOver(ev) {
    if (isFileVarDrag(ev) && !isFileVarTarget(ev.target)) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'none'; }
}
function fileVarDocDrop(ev) {
    if (isFileVarDrag(ev) && !isFileVarTarget(ev.target)) { ev.preventDefault(); ev.stopPropagation(); }
}

/* The After Processing block as one self-laid-out section, mirroring Swing: the
   action radios + Move-to/Error directory & filename fields on the left, and a
   bordered vertical variable list box on the right (spanning the rows). Clicking
   a variable inserts ${var} at the cursor of the last-focused directory/filename
   field. Gating greys the move fields unless their action is "Move". */
function afterProcessingBlock(properties, onChange) {
    return {
        type: 'custom', full: true,
        render: (p) => {
            let lastInput = null;
            const grid = h('div', { class: 'grid grid-cols-[max-content_1fr_max-content] gap-y-[6px] gap-x-3 items-center' });

            const insertVar = (v) => {
                const input = lastInput;
                if (!input || input.disabled) return;
                const token = '${' + v + '}';
                const s = input.selectionStart ?? input.value.length;
                const e = input.selectionEnd ?? input.value.length;
                input.value = input.value.slice(0, s) + token + input.value.slice(e);
                const pos = s + token.length;
                input.focus();
                try { input.setSelectionRange(pos, pos); } catch { /* number/detached input */ }
                input.dispatchEvent(new Event('input', { bubbles: true }));
            };

            function paint() {
                clear(grid);
                const moveDis = p.afterProcessingAction !== 'MOVE';
                const errDis = p.errorReadingAction !== 'MOVE' && p.errorResponseAction !== 'MOVE';

                const labelCell = (text, dim) => h('label.cform-label', { style: dim ? { opacity: '0.5' } : null }, `${text}:`);
                const radioCell = (key, opts) => {
                    const grp = h('div.radio-group.inline-row');
                    opts.forEach((o) => {
                        const inp = h('input', { type: 'radio', name: `apb-${key}`, checked: String(p[key]) === String(o.value) });
                        inp.addEventListener('change', () => { p[key] = o.value; onChange(); paint(); });
                        grp.appendChild(h('label.check', inp, o.label));
                    });
                    return grp;
                };
                const inputCell = (key, width, dis) => {
                    const inp = textInput(String(p[key] ?? ''), {
                        disabled: dis, style: { width, opacity: dis ? '0.5' : '1' },
                        onInput: (ev) => { p[key] = ev.target.value; onChange(); }
                    });
                    inp.addEventListener('focus', () => { lastInput = inp; });
                    inp.dataset.fileVarTarget = '1';   // the only permitted drop targets
                    // Accept ONLY a file-variable drag (the custom MIME type); insert
                    // the token at the cursor and fire input so the property updates.
                    inp.addEventListener('dragover', (ev) => {
                        if (!inp.disabled && Array.from(ev.dataTransfer.types).includes(FILE_VAR_MIME)) {
                            ev.preventDefault();
                            ev.dataTransfer.dropEffect = 'copy';
                        }
                    });
                    inp.addEventListener('drop', (ev) => {
                        const token = ev.dataTransfer.getData(FILE_VAR_MIME);
                        if (!token || inp.disabled) return;
                        ev.preventDefault();
                        const s = inp.selectionStart ?? inp.value.length;
                        const e = inp.selectionEnd ?? inp.value.length;
                        inp.value = inp.value.slice(0, s) + token + inp.value.slice(e);
                        const pos = s + token.length;
                        inp.focus();
                        try { inp.setSelectionRange(pos, pos); } catch { /* ignore */ }
                        inp.dispatchEvent(new Event('input', { bubbles: true }));
                    });
                    return inp;
                };

                const rows = [
                    [labelCell('After Processing Action'), radioCell('afterProcessingAction', [
                        { value: 'NONE', label: 'None' }, { value: 'MOVE', label: 'Move' }, { value: 'DELETE', label: 'Delete' }])],
                    [labelCell('Move-to Directory', moveDis), inputCell('moveToDirectory', '320px', moveDis)],
                    [labelCell('Move-to File Name', moveDis), inputCell('moveToFileName', '220px', moveDis)],
                    [labelCell('Error Reading Action'), radioCell('errorReadingAction', [
                        { value: 'NONE', label: 'None' }, { value: 'MOVE', label: 'Move' }, { value: 'DELETE', label: 'Delete' }])],
                    [labelCell('Error in Response Action'), radioCell('errorResponseAction', [
                        { value: 'AFTER_PROCESSING', label: 'After Processing Action' }, { value: 'MOVE', label: 'Move' }, { value: 'DELETE', label: 'Delete' }])],
                    [labelCell('Error Move-to Directory', errDis), inputCell('errorMoveToDirectory', '320px', errDis)],
                    [labelCell('Error Move-to File Name', errDis), inputCell('errorMoveToFileName', '220px', errDis)]
                ];
                rows.forEach(([lab, ctrl], i) => {
                    lab.style.gridColumn = '1'; lab.style.gridRow = String(i + 1);
                    grid.appendChild(lab);
                    grid.appendChild(h('div.cform-control', { class: 'col-[2]', style: { gridRow: String(i + 1) } }, ctrl));
                });

                // Bordered vertical variable list, spanning all rows on the right.
                const listBox = h('div', {
                    class: 'col-[3] self-stretch border border-line rounded-[4px] py-1 px-0 min-w-[150px] bg-bg1 overflow-auto',
                    style: { gridRow: `1 / ${rows.length + 1}` }
                }, FILE_NAME_VARS.map((v) => {
                    const item = h('div', {
                        class: 'py-[3px] px-3 cursor-grab font-mono text-[12px] select-none',
                        title: `Drag into a Move-to / Error field, or click to insert into the last-focused one`,
                        onClick: () => insertVar(v)
                    }, v);
                    // Draggable: a text/plain ${var} drops natively into the text
                    // inputs (which fire their input event), or click inserts into
                    // the last-focused field.
                    item.draggable = true;
                    item.addEventListener('dragstart', (ev) => {
                        // Custom type only (NOT text/plain), so the drop is accepted
                        // exclusively by the move/error fields' drop handlers. The
                        // document blockers cancel any drop outside those fields.
                        ev.dataTransfer.clearData();
                        ev.dataTransfer.setData(FILE_VAR_MIME, '${' + v + '}');
                        ev.dataTransfer.effectAllowed = 'copy';
                        document.addEventListener('dragover', fileVarDocDragOver, true);
                        document.addEventListener('drop', fileVarDocDrop, true);
                    });
                    item.addEventListener('dragend', () => {
                        document.removeEventListener('dragover', fileVarDocDragOver, true);
                        document.removeEventListener('drop', fileVarDocDrop, true);
                    });
                    item.addEventListener('mouseenter', () => { item.style.background = 'var(--bg2)'; });
                    item.addEventListener('mouseleave', () => { item.style.background = ''; });
                    return item;
                }));
                grid.appendChild(listBox);
            }

            paint();
            return grid;
        }
    };
}

const fileReader = {
    defaults(version) {
        return {
            '@class': 'com.mirth.connect.connectors.file.FileReceiverProperties',
            '@version': version,
            pluginProperties: null,
            pollConnectorProperties: defaultPollProperties(version),
            sourceConnectorProperties: defaultSourceProperties(version),
            scheme: 'FILE',
            schemeProperties: null,
            host: '',
            fileFilter: '*',
            regex: false,
            directoryRecursion: false,
            ignoreDot: true,
            anonymous: true,
            username: '',
            password: '',
            timeout: '10000',
            secure: true,
            passive: true,
            validateConnection: true,
            afterProcessingAction: 'NONE',
            moveToDirectory: '',
            moveToFileName: '',
            errorReadingAction: 'NONE',
            errorResponseAction: 'AFTER_PROCESSING',
            errorMoveToDirectory: '',
            errorMoveToFileName: '',
            checkFileAge: true,
            fileAge: '1000',
            fileSizeMinimum: '0',
            fileSizeMaximum: '',
            ignoreFileSizeMaximum: true,
            sortBy: 'date',
            binary: false,
            charsetEncoding: 'DEFAULT_ENCODING'
        };
    },
    component({ properties, channel, onChange }) {
        ensureSchemeProperties(properties);
        return (
            <div>
                <PollSection properties={properties} onChange={onChange} />
                <ConnectorForm properties={properties} onChange={onChange} fields={[
                    { section: 'Connection Settings' },
                    { key: 'scheme', label: 'Method', type: 'select', options: SCHEMES, refresh: true, width: '160px', onSet: onSchemeChange, append: () => connectorTestButton({ label: 'Test Read', icon: 'folder', path: '/connectors/file/_testRead', channel, properties }) },
                    { key: 'host', label: 'Directory', type: 'text', width: '420px', disabled: (p) => p.scheme !== 'FILE' },
                    hostPathField(onChange),
                    { key: 'fileFilter', label: 'Filename Filter Pattern', type: 'text', width: '220px' },
                    { key: 'regex', label: 'Regular Expression', type: 'radio', options: YES_NO },
                    { key: 'directoryRecursion', label: 'Include All Subdirectories', type: 'radio', options: YES_NO, refresh: true },
                    { key: 'ignoreDot', label: 'Ignore . files', type: 'radio', options: YES_NO },
                    {
                        key: 'anonymous', label: 'Anonymous', type: 'radio', options: YES_NO, refresh: true,
                        disabled: (p) => !anonymousEnabled(p), onSet: applyAnonymous
                    },
                    { key: 'username', label: (p) => p.scheme === 'S3' ? 'AWS Access Key ID' : 'Username', type: 'text', width: '220px', disabled: credentialsDisabled },
                    { key: 'password', label: (p) => p.scheme === 'S3' ? 'AWS Secret Access Key' : 'Password', type: 'password', width: '220px', disabled: credentialsDisabled },
                    { key: 'timeout', label: 'Timeout (ms)', type: 'number', width: '120px', disabled: (p) => !timeoutEnabled(p) },
                    { key: 'secure', label: 'Secure Mode', type: 'radio', options: YES_NO, disabled: (p) => !secureEnabled(p) },
                    { key: 'passive', label: 'Passive Mode', type: 'radio', options: YES_NO, disabled: (p) => !passiveEnabled(p) },
                    { key: 'validateConnection', label: 'Validate Connection', type: 'radio', options: YES_NO, disabled: (p) => !validateEnabled(p) },
                    ...schemeSettingsFields(),
                    { section: 'After Processing' },
                    afterProcessingBlock(properties, onChange),
                    { key: 'checkFileAge', label: 'Check File Age', type: 'radio', options: YES_NO, refresh: true },
                    { key: 'fileAge', label: 'File Age (ms)', type: 'number', width: '120px', disabled: (p) => !asBool(p.checkFileAge) },
                    // Swing renders File Size as one row: [min] - [max] [Ignore Maximum].
                    // Min/Max stay as separate typed fields (a typed input cannot live
                    // in `append`, which is rebuilt on every repaint); the Ignore Maximum
                    // checkbox is appended to the Maximum field and greys it out when set
                    // (ignoreFileSizeMaximumCheckBox.setEnabled), matching Swing.
                    { key: 'fileSizeMinimum', label: 'File Size (bytes)', type: 'number', width: '120px' },
                    {
                        key: 'fileSizeMaximum', label: 'to', type: 'number', width: '120px', refresh: true,
                        disabled: (p) => asBool(p.ignoreFileSizeMaximum),
                        append: (p, ctx) => checkbox('Ignore Maximum', asBool(p.ignoreFileSizeMaximum), {
                            onChange: (e) => { p.ignoreFileSizeMaximum = e.target.checked; ctx.onChange(); ctx.repaint && ctx.repaint(); }
                        }).el
                    },
                    { key: 'sortBy', label: 'Sort Files By', type: 'select', width: '120px', options: [
                        { value: 'date', label: 'Date' },
                        { value: 'name', label: 'Name' },
                        { value: 'size', label: 'Size' }
                    ] },
                    {
                        key: 'binary', label: 'File Type', type: 'radio', refresh: true,
                        onSet: onFileTypeSet, options: FILE_TYPE_OPTIONS
                    },
                    { key: 'charsetEncoding', label: 'Encoding', type: 'select', options: CHARSETS, width: '160px', disabled: (p) => asBool(p.binary) }
                ]} />
            </div>
        );
    },
    // FileReader.checkProperties / setDirHostPath: Directory (FILE) or Host
    // (non-FILE) and Filename Filter Pattern always required; Username/Password
    // per the shared credential rules; Timeout required for FTP/SFTP/SMB; File
    // Age required when Check File Age=Yes; File Size minimum always required and
    // maximum required unless Ignore Maximum is set.
    validate(properties) {
        return requireFields(properties, [
            { key: 'host', label: 'Directory', when: (p) => p.scheme === 'FILE' },
            { key: 'host', label: 'Host', when: (p) => p.scheme !== 'FILE' },
            { key: 'fileFilter', label: 'Filename Filter Pattern' },
            { key: 'username', label: 'Username', when: credentialsRequired },
            { key: 'password', label: 'Password', when: passwordRequired },
            { key: 'timeout', label: 'Timeout', when: (p) => ['FTP', 'SFTP', 'SMB'].includes(p.scheme) },
            { key: 'fileAge', label: 'File Age', when: (p) => asBool(p.checkFileAge) },
            { key: 'fileSizeMinimum', label: 'File Size (bytes)' },
            { key: 'fileSizeMaximum', label: 'File Size Maximum', when: (p) => !asBool(p.ignoreFileSizeMaximum) }
        ]);
    }
};

const fileWriter = {
    defaults(version) {
        return {
            '@class': 'com.mirth.connect.connectors.file.FileDispatcherProperties',
            '@version': version,
            pluginProperties: null,
            destinationConnectorProperties: defaultDestinationProperties(version),
            scheme: 'FILE',
            schemeProperties: null,
            host: '',
            outputPattern: '',
            anonymous: true,
            username: '',
            password: '',
            timeout: '10000',
            keepConnectionOpen: true,
            maxIdleTime: '0',
            secure: true,
            passive: true,
            validateConnection: true,
            outputAppend: true,
            errorOnExists: false,
            temporary: false,
            binary: false,
            charsetEncoding: 'DEFAULT_ENCODING',
            template: ''
        };
    },
    component({ properties, channel, onChange }) {
        ensureSchemeProperties(properties);
        return (
            <div>
                <ConnectorForm properties={properties} onChange={onChange} fields={[
                    { section: 'Connection Settings' },
                    { key: 'scheme', label: 'Method', type: 'select', options: SCHEMES, refresh: true, width: '160px', onSet: onWriterSchemeChange, append: () => connectorTestButton({ label: 'Test Write', icon: 'folder', path: '/connectors/file/_testWrite', channel, properties }) },
                    { key: 'host', label: 'Directory', type: 'text', width: '420px', disabled: (p) => p.scheme !== 'FILE' },
                    hostPathField(onChange),
                    { key: 'outputPattern', label: 'File Name', type: 'text', width: '220px' },
                    {
                        key: 'anonymous', label: 'Anonymous', type: 'radio', options: YES_NO, refresh: true,
                        disabled: (p) => !anonymousEnabled(p), onSet: applyAnonymous
                    },
                    { key: 'username', label: (p) => p.scheme === 'S3' ? 'AWS Access Key ID' : 'Username', type: 'text', width: '220px', disabled: credentialsDisabled },
                    { key: 'password', label: (p) => p.scheme === 'S3' ? 'AWS Secret Access Key' : 'Password', type: 'password', width: '220px', disabled: credentialsDisabled },
                    { key: 'timeout', label: 'Timeout (ms)', type: 'number', width: '120px', disabled: (p) => !timeoutEnabled(p) },
                    { key: 'keepConnectionOpen', label: 'Keep Connection Open', type: 'radio', options: YES_NO, refresh: true },
                    { key: 'maxIdleTime', label: 'Max Idle Time (ms)', type: 'number', width: '120px', disabled: (p) => !asBool(p.keepConnectionOpen) },
                    { key: 'secure', label: 'Secure Mode', type: 'radio', options: YES_NO, disabled: (p) => !secureEnabled(p) },
                    { key: 'passive', label: 'Passive Mode', type: 'radio', options: YES_NO, disabled: (p) => !passiveEnabled(p) },
                    { key: 'validateConnection', label: 'Validate Connection', type: 'radio', options: YES_NO, disabled: (p) => !validateEnabled(p) },
                    ...schemeSettingsFields(),
                    { section: 'File Writer Settings' },
                    fileExistsField(),
                    {
                        // Create Temp File is disabled when File Exists=Append
                        // (fileExistsAppendRadioActionPerformed) or scheme=S3.
                        key: 'temporary', label: 'Create Temp File', type: 'radio', options: YES_NO,
                        disabled: (p) => asBool(p.outputAppend) || p.scheme === 'S3'
                    },
                    {
                        key: 'binary', label: 'File Type', type: 'radio', refresh: true,
                        onSet: onFileTypeSet, options: FILE_TYPE_OPTIONS
                    },
                    { key: 'charsetEncoding', label: 'Encoding', type: 'select', options: CHARSETS, width: '160px', disabled: (p) => asBool(p.binary) },
                    { section: 'Template' },
                    { key: 'template', label: 'Template', type: 'code', minHeight: '140px', placeholder: '${message.encodedData}' }
                ]} />
            </div>
        );
    },
    // FileWriter.checkProperties / setDirHostPath: Directory (FILE) or Host
    // (non-FILE), File Name and Template always required; Username/Password per
    // the shared credential rules; Timeout required for FTP/SFTP/SMB. (Max Idle
    // Time's `NumberUtils.toInt(...) < 0` check is numeric/range, not a blank
    // check, so it is intentionally skipped here.)
    validate(properties) {
        return requireFields(properties, [
            { key: 'host', label: 'Directory', when: (p) => p.scheme === 'FILE' },
            { key: 'host', label: 'Host', when: (p) => p.scheme !== 'FILE' },
            { key: 'outputPattern', label: 'File Name' },
            { key: 'template', label: 'Template' },
            { key: 'username', label: 'Username', when: credentialsRequired },
            { key: 'password', label: 'Password', when: passwordRequired },
            { key: 'timeout', label: 'Timeout', when: (p) => ['FTP', 'SFTP', 'SMB'].includes(p.scheme) }
        ]);
    }
};

export function register(platform) {
    platform.registerConnectorPanel('File Reader', 'SOURCE', fileReader);
    platform.registerConnectorPanel('File Writer', 'DESTINATION', fileWriter);
}
