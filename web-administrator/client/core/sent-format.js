/*
 * Sent-content formatter for the message browser.
 *
 * On a destination connector, the "Sent" content is a serialized
 * ConnectorProperties object, not raw message data. The Swing MessageBrowser
 * deserializes it and renders ConnectorProperties.toFormattedString(); this is a
 * faithful client-side port of those per-connector toFormattedString() methods
 * (VM/Channel Writer, HTTP, TCP, Database, JavaScript, SMTP) with a readable
 * generic fallback for any other dispatcher type.
 */

const ct = (root, tag) => {
    for (const n of root.childNodes) if (n.nodeType === 1 && n.nodeName === tag) return n.textContent || '';
    return '';
};
const ce = (root, tag) => {
    for (const n of root.childNodes) if (n.nodeType === 1 && n.nodeName === tag) return n;
    return null;
};
const cbool = (root, tag) => String(ct(root, tag)).trim() === 'true';
const elChildren = (el) => (el ? [...el.childNodes].filter(n => n.nodeType === 1) : []);
const strList = (el) => elChildren(el).filter(n => n.nodeName === 'string').map(n => n.textContent || '');

// Map<String, String|List<String>> → [{ key, values: [] }].
function mapEntries(el) {
    const out = [];
    for (const entry of elChildren(el)) {
        if (entry.nodeName !== 'entry') continue;
        const kids = elChildren(entry);
        if (!kids.length) continue;
        const key = kids[0].textContent || '';
        const second = kids[1];
        let values = [];
        if (second) {
            if (second.nodeName === 'string') values = [second.textContent || ''];
            else {
                const inner = elChildren(second).filter(n => n.nodeName === 'string');
                values = inner.length ? inner.map(n => n.textContent || '') : [second.textContent || ''];
            }
        }
        out.push({ key, values });
    }
    return out;
}

function fmtVm(r) {
    const lines = ['CHANNEL ID: ' + ct(r, 'channelId'), '', '[MAP VARIABLES]'];
    for (const v of strList(ce(r, 'mapVariables'))) lines.push(v);
    lines.push('', '[CONTENT]', ct(r, 'channelTemplate'));
    return lines.join('\n');
}

function fmtHttp(r) {
    const lines = ['URL: ' + ct(r, 'host'), 'METHOD: ' + ct(r, 'method').toUpperCase()];
    if (ct(r, 'username').trim()) lines.push('USERNAME: ' + ct(r, 'username'));
    lines.push('', '[HEADERS]');
    if (cbool(r, 'useHeadersVariable')) lines.push(`Using variable '${ct(r, 'headersVariable')}'`);
    else for (const { key, values } of mapEntries(ce(r, 'headers'))) for (const v of values) lines.push(`${key}: ${v}`);
    lines.push('', '[PARAMETERS]');
    if (cbool(r, 'useParametersVariable')) lines.push(`Using variable '${ct(r, 'parametersVariable')}'`);
    else for (const { key, values } of mapEntries(ce(r, 'parameters'))) for (const v of values) lines.push(`${key}: ${v}`);
    lines.push('', '[CONTENT]', ct(r, 'content'));
    return lines.join('\n');
}

function fmtTcp(r) {
    const lines = ['REMOTE ADDRESS: ' + ct(r, 'remoteAddress') + ':' + ct(r, 'remotePort')];
    if (cbool(r, 'overrideLocalBinding')) lines.push('LOCAL ADDRESS: ' + ct(r, 'localAddress') + ':' + ct(r, 'localPort'));
    lines.push('', '[CONTENT]', ct(r, 'template'));
    return lines.join('\n');
}

function fmtDatabase(r) {
    const lines = ['URL: ' + ct(r, 'url'), 'USERNAME: ' + ct(r, 'username'), '',
        cbool(r, 'useScript') ? '[SCRIPT]' : '[QUERY]', (ct(r, 'query') || '').trim()];
    const params = strList(ce(r, 'parameters'));
    params.forEach((p, i) => lines.push('', '', `[PARAMETER ${i + 1}]`, p));
    return lines.join('\n');
}

function fmtSmtp(r) {
    const lines = ['HOST: ' + ct(r, 'smtpHost') + ':' + ct(r, 'smtpPort')];
    if (ct(r, 'username').trim()) lines.push('USERNAME: ' + ct(r, 'username'));
    lines.push('TO: ' + ct(r, 'to'), 'FROM: ' + ct(r, 'from'), 'CC: ' + ct(r, 'cc'), 'SUBJECT: ' + ct(r, 'subject'), '', '[HEADERS]');
    if (cbool(r, 'useHeadersVariable')) lines.push(`Using variable '${ct(r, 'headersVariable')}'`);
    else for (const { key, values } of mapEntries(ce(r, 'headers'))) lines.push(`${key}: ${values[0] ?? ''}`);
    lines.push('', '[ATTACHMENTS]');
    if (cbool(r, 'useAttachmentsVariable')) lines.push(`Using variable '${ct(r, 'attachmentsVariable')}'`);
    else for (const att of elChildren(ce(r, 'attachments'))) lines.push(`${ct(att, 'name')} (${ct(att, 'mimeType')})`);
    lines.push('', '[CONTENT]', ct(r, 'body'));
    return lines.join('\n');
}

// FileDispatcherProperties.appendURIString: scheme prefix + host + outputPattern.
function appendUri(r) {
    const scheme = ct(r, 'scheme');
    const prefix = scheme === 'FTP' ? 'ftp://' : scheme === 'SFTP' ? 'sftp://'
        : scheme === 'S3' ? 's3://' : scheme === 'SMB' ? 'smb://'
            : scheme === 'WEBDAV' ? (cbool(r, 'secure') ? 'https://' : 'http://') : '';
    const host = ct(r, 'host');
    let s = prefix + host;
    if (host && host[host.length - 1] !== '/') s += '/';
    return s + ct(r, 'outputPattern');
}

// SchemeProperties.toFormattedString for the FTP/SFTP/S3/SMB sub-objects.
function fmtScheme(el) {
    if (!el) return '';
    const cls = el.nodeName === 'schemeProperties' ? (el.getAttribute && el.getAttribute('class')) : el.nodeName;
    const lines = [];
    if (/FTP/i.test(cls || '') && !/SFTP/i.test(cls || '')) {
        const cmds = strList(ce(el, 'initialCommands'));
        if (cmds.length) { lines.push('[INITIAL COMMANDS]'); cmds.forEach(c => lines.push(c)); }
    } else if (/Sftp/i.test(cls || '')) {
        lines.push('HOST CHECKING: ' + ct(el, 'hostKeyChecking'));
        const cfg = mapEntries(ce(el, 'configurationSettings'));
        if (cfg.length) { lines.push('[CONFIGURATION OPTIONS]'); for (const { key, values } of cfg) lines.push(`${key}: ${values[0] ?? ''}`); }
    } else if (/S3/i.test(cls || '')) {
        lines.push('REGION: ' + ct(el, 'region'));
        const hdrs = mapEntries(ce(el, 'customHeaders'));
        if (hdrs.length) { lines.push('', '[CUSTOM HEADERS]'); for (const { key, values } of hdrs) for (const v of values) lines.push(`${key}: ${v}`); }
    } else if (/Smb/i.test(cls || '')) {
        lines.push('SMB: ' + ct(el, 'smbMinVersion') + '-' + ct(el, 'smbMaxVersion'));
    }
    return lines.length ? lines.join('\n') : '';
}

function fmtFile(r) {
    const lines = ['URI: ' + appendUri(r)];
    if (!cbool(r, 'anonymous')) lines.push('USERNAME: ' + ct(r, 'username'));
    const scheme = fmtScheme(ce(r, 'schemeProperties'));
    if (scheme) lines.push(scheme);
    lines.push('', '[CONTENT]', ct(r, 'template'));
    return lines.join('\n');
}

function fmtDocument(r) {
    const lines = [];
    const output = ct(r, 'output');
    if (output.trim()) {
        const label = /^file$/i.test(output) ? 'File' : /^attachment$/i.test(output) ? 'Attachment'
            : /^both$/i.test(output) ? 'File and Attachment' : output;
        lines.push('OUTPUT: ' + label);
    }
    if (!output.trim() || !/^attachment$/i.test(output)) lines.push('URI: ' + appendUri(r));
    lines.push('DOCUMENT TYPE: ' + ct(r, 'documentType'), '', '[CONTENT]', ct(r, 'template'));
    return lines.join('\n');
}

function fmtJms(r) {
    const lines = [];
    if (cbool(r, 'useJndi')) {
        lines.push('PROVIDER URL: ' + ct(r, 'jndiProviderUrl'),
            'INITIAL CONTEXT FACTORY: ' + ct(r, 'jndiInitialContextFactory'),
            'CONNECTION FACTORY NAME: ' + ct(r, 'jndiConnectionFactoryName'),
            'DESTINATION: ' + ct(r, 'destinationName'));
    } else {
        lines.push('CONNECTION FACTORY CLASS: ' + ct(r, 'connectionFactoryClass'));
        lines.push((cbool(r, 'topic') ? 'TOPIC: ' : 'QUEUE: ') + ct(r, 'destinationName'));
    }
    if (ct(r, 'clientId').trim()) lines.push('CLIENT ID: ' + ct(r, 'clientId'));
    if (ct(r, 'username').trim()) lines.push('USERNAME: ' + ct(r, 'username'));
    const conn = mapEntries(ce(r, 'connectionProperties'));
    if (conn.length) { lines.push('', '[CONNECTION PROPERTIES]'); for (const { key, values } of conn) lines.push(`${key}: ${values[0] ?? ''}`); }
    lines.push('[CONTENT]', ct(r, 'template'));
    return lines.join('\n');
}

function fmtWebService(r) {
    const lines = ['WSDL URL: ' + ct(r, 'wsdlUrl')];
    if (ct(r, 'username').trim()) lines.push('USERNAME: ' + ct(r, 'username'));
    if (ct(r, 'service').trim()) lines.push('SERVICE: ' + ct(r, 'service'));
    if (ct(r, 'port').trim()) lines.push('PORT / ENDPOINT: ' + ct(r, 'port'));
    if (ct(r, 'locationURI').trim()) lines.push('LOCATION URI: ' + ct(r, 'locationURI'));
    if (ct(r, 'soapAction').trim()) lines.push('SOAP ACTION: ' + ct(r, 'soapAction'));
    if (cbool(r, 'useHeadersVariable')) lines.push('', '[HEADERS]', `Using variable '${ct(r, 'headersVariable')}'`);
    else {
        const hdrs = mapEntries(ce(r, 'headers'));
        if (hdrs.length) { lines.push('', '[HEADERS]'); for (const { key, values } of hdrs) for (const v of values) lines.push(`${key}: ${v}`); }
    }
    lines.push('', '[ATTACHMENTS]');
    if (cbool(r, 'useAttachmentsVariable')) lines.push(`Using variable '${ct(r, 'attachmentsVariable')}'`);
    else {
        const names = strList(ce(r, 'attachmentNames'));
        const types = strList(ce(r, 'attachmentTypes'));
        names.forEach((n, i) => lines.push(`${n} (${types[i] ?? ''})`));
    }
    lines.push('', '[CONTENT]', ct(r, 'envelope'));
    return lines.join('\n');
}

function fmtDicom(r) {
    const lines = ['REMOTE ADDRESS: ' + ct(r, 'host') + ':' + ct(r, 'port')];
    if (ct(r, 'localHost').trim()) lines.push('LOCAL ADDRESS: ' + ct(r, 'localHost') + ':' + ct(r, 'localPort'));
    if (ct(r, 'applicationEntity').trim()) lines.push('REMOTE APPLICATION ENTITY: ' + ct(r, 'applicationEntity'));
    if (ct(r, 'localApplicationEntity').trim()) lines.push('LOCAL APPLICATION ENTITY: ' + ct(r, 'localApplicationEntity'));
    if (ct(r, 'username').trim()) lines.push('USERNAME: ' + ct(r, 'username'));
    lines.push('', '[CONTENT]', ct(r, 'template'));
    return lines.join('\n');
}

const FORMATTERS = {
    'com.mirth.connect.connectors.vm.VmDispatcherProperties': fmtVm,
    'com.mirth.connect.connectors.http.HttpDispatcherProperties': fmtHttp,
    'com.mirth.connect.connectors.tcp.TcpDispatcherProperties': fmtTcp,
    'com.mirth.connect.connectors.jdbc.DatabaseDispatcherProperties': fmtDatabase,
    'com.mirth.connect.connectors.smtp.SmtpDispatcherProperties': fmtSmtp,
    'com.mirth.connect.connectors.file.FileDispatcherProperties': fmtFile,
    'com.mirth.connect.connectors.doc.DocumentDispatcherProperties': fmtDocument,
    'com.mirth.connect.connectors.jms.JmsDispatcherProperties': fmtJms,
    'com.mirth.connect.connectors.ws.WebServiceDispatcherProperties': fmtWebService,
    'com.mirth.connect.connectors.dimse.DICOMDispatcherProperties': fmtDicom,
    'com.mirth.connect.connectors.js.JavaScriptDispatcherProperties': () => 'Script Executed'
};

// Generic fallback: scalar fields as "FIELD: value", then a [CONTENT] block for
// the connector's template/content field. Skips XStream/boilerplate internals.
const SKIP = new Set(['pluginProperties', 'destinationConnectorProperties', 'metaDataId', 'name']);
const CONTENT_FIELDS = ['template', 'content', 'channelTemplate', 'body', 'query', 'script'];
function fmtGeneric(r) {
    const lines = [];
    let contentField = null;
    for (const n of elChildren(r)) {
        const tag = n.nodeName;
        if (tag.startsWith('@') || SKIP.has(tag)) continue;
        if (CONTENT_FIELDS.includes(tag) && !contentField) { contentField = n; continue; }
        if (elChildren(n).length) continue;       // skip nested structures in the summary
        const val = (n.textContent || '').trim();
        if (val) lines.push(`${tag.replace(/([A-Z])/g, ' $1').toUpperCase().trim()}: ${val}`);
    }
    if (contentField) lines.push('', '[CONTENT]', contentField.textContent || '');
    return lines.join('\n');
}

/**
 * Format a serialized ConnectorProperties "Sent" payload like the Swing browser.
 * Returns the formatted text, or null if `content` isn't a ConnectorProperties
 * document (so callers can fall back to showing the raw content).
 */
export function formatSentProperties(content) {
    if (typeof content !== 'string' || !/^\s*</.test(content)) return null;
    let root;
    try {
        const doc = new DOMParser().parseFromString(content, 'text/xml');
        root = doc.documentElement;
        if (!root || doc.querySelector('parsererror')) return null;
    } catch (e) { return null; }
    // ConnectorProperties classes live under com.mirth.connect.connectors.*
    if (!/^com\.mirth\.connect\.connectors\..*Properties$/.test(root.nodeName)) return null;
    const fmt = FORMATTERS[root.nodeName];
    try { return fmt ? fmt(root) : fmtGeneric(root); } catch (e) { return null; }
}
