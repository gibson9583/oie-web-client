/*
 * SMTP Sender (SmtpDispatcherProperties).
 *
 * React port: def.render(host, ctx) -> def.component(ctx) => JSX. Field schema +
 * defaults reused VERBATIM; the 'Send Test Email' button is the React
 * <ConnectorTestButton> (calls the same /connectors/smtp/_sendTestEmail servlet).
 *
 * Field order, labels and gating mirror the Swing SmtpSender panel
 * (engine client/.../connectors/smtp/SmtpSender.java initLayout/setProperties):
 *   SMTP Host (+ Send Test Email), SMTP Port, Override Local Binding,
 *   Local Address, Local Port, Send Timeout (ms), Encryption, Use Authentication,
 *   Username, Password, To, From, Subject, Charset Encoding, HTML Body, Body,
 *   Headers (Use Table/Use Map: table-or-map-variable), Attachments
 *   (Use Table/Use List: 3-column Name/Content/MIME-type table or list variable).
 */

import { React } from './react-platform.js';
import { h, clear, textInput, icon } from '@oie/web-ui';
import { ConnectorForm, connectorTestButton, asBool, YES_NO, defaultDestinationProperties, CHARSETS } from './react-forms.js';

const usingAuth = (p) => asBool(p.authentication);
const usingLocalBinding = (p) => asBool(p.overrideLocalBinding);

/* SMTP attachments are a single java.util.ArrayList of
 * com.mirth.connect.connectors.smtp.Attachment objects (name/content/mimeType),
 * serialized by XStream under that FQN key. This mirrors the Swing
 * setAttachments/getAttachments 3-column (Name/Content/MIME type) table editor. */
const ATTACHMENT_CLASS = 'com.mirth.connect.connectors.smtp.Attachment';

function attachmentEntries(list) {
    if (!list || typeof list !== 'object') return [];
    const value = list[ATTACHMENT_CLASS];
    if (value === null || value === undefined || value === '') return [];
    return (Array.isArray(value) ? value : [value]).map((a) => ({
        name: String((a && a.name) ?? ''),
        content: String((a && a.content) ?? ''),
        mimeType: String((a && a.mimeType) ?? '')
    }));
}

function writeAttachments(list, rows) {
    const target = list && typeof list === 'object' ? list : {};
    if (!target['@class']) target['@class'] = 'java.util.ArrayList';
    const clean = rows.filter((r) => r.name !== '' || r.content !== '' || r.mimeType !== '');
    if (clean.length) {
        target[ATTACHMENT_CLASS] = clean.map((r) => ({ name: r.name, content: r.content, mimeType: r.mimeType }));
    } else {
        delete target[ATTACHMENT_CLASS];
    }
    return target;
}

/* Custom 3-column (Name / Content / MIME type) attachments table — the React
 * port of SmtpSender.setAttachments + New/Delete buttons. When `disabled` (the
 * "Use List:" variable mode), the rows and New button are greyed and the whole
 * block is dimmed — matching Swing useAttachmentsVariableFieldsEnabled() which
 * setEnabled(false) on the table + New/Delete but keeps it VISIBLE. */
function attachmentsTable(properties, onChange, disabled) {
    const wrap = h('div', disabled ? { class: 'opacity-60' } : {});
    const rows = attachmentEntries(properties.attachments);
    const commit = () => {
        properties.attachments = writeAttachments(properties.attachments, rows);
        onChange();
    };
    function paint() {
        clear(wrap);
        rows.forEach((row, i) => {
            wrap.appendChild(h('div', { class: 'flex gap-1.5 mb-1.5' },
                textInput(row.name, { placeholder: 'Name', disabled, class: 'flex-1', onInput: (e) => { row.name = e.target.value; commit(); } }),
                textInput(row.content, { placeholder: 'Content', disabled, class: 'flex-[2]', onInput: (e) => { row.content = e.target.value; commit(); } }),
                textInput(row.mimeType, { placeholder: 'MIME type', disabled, class: 'flex-1', onInput: (e) => { row.mimeType = e.target.value; commit(); } }),
                h('button.icon-btn', { type: 'button', title: 'Remove', disabled, onClick: disabled ? null : () => { rows.splice(i, 1); commit(); paint(); } }, icon('x'))));
        });
        wrap.appendChild(h('button.btn', { type: 'button', disabled, onClick: disabled ? null : () => { rows.push({ name: '', content: '', mimeType: '' }); paint(); } }, 'New'));
    }
    paint();
    return wrap;
}

const smtpSender = {
    defaults(version) {
        return {
            '@class': 'com.mirth.connect.connectors.smtp.SmtpDispatcherProperties',
            '@version': version,
            pluginProperties: null,
            destinationConnectorProperties: defaultDestinationProperties(version),
            smtpHost: '',
            smtpPort: '25',
            overrideLocalBinding: false,
            localAddress: '0.0.0.0',
            localPort: '0',
            timeout: '5000',
            encryption: 'none',
            authentication: false,
            username: '',
            password: '',
            to: '',
            from: '',
            cc: '',
            bcc: '',
            replyTo: '',
            headers: { '@class': 'linked-hash-map' },
            headersVariable: '',
            isUseHeadersVariable: false,
            subject: '',
            charsetEncoding: 'DEFAULT_ENCODING',
            html: false,
            body: '',
            attachments: { '@class': 'java.util.ArrayList' },
            attachmentsVariable: '',
            isUseAttachmentsVariable: false
        };
    },
    component({ properties, channel, onChange }) {
        return (
            <div>
                <ConnectorForm properties={properties} onChange={onChange} fields={[
                    { section: 'Connection Settings' },
                    { key: 'smtpHost', label: 'SMTP Host', type: 'text', width: '200px', append: () => connectorTestButton({ label: 'Send Test Email', icon: 'mail', path: '/connectors/smtp/_sendTestEmail', channel, properties }) },
                    { key: 'smtpPort', label: 'SMTP Port', type: 'number', width: '90px' },
                    { key: 'overrideLocalBinding', label: 'Override Local Binding', type: 'radio', options: YES_NO, refresh: true },
                    { key: 'localAddress', label: 'Local Address', type: 'text', width: '200px', disabled: (p) => !usingLocalBinding(p) },
                    { key: 'localPort', label: 'Local Port', type: 'number', width: '90px', disabled: (p) => !usingLocalBinding(p) },
                    { key: 'timeout', label: 'Send Timeout (ms)', type: 'number', width: '120px' },
                    { key: 'encryption', label: 'Encryption', type: 'radio', options: [
                        { value: 'none', label: 'None' },
                        { value: 'TLS', label: 'STARTTLS' },
                        { value: 'SSL', label: 'SSL' }
                    ] },
                    { key: 'authentication', label: 'Use Authentication', type: 'radio', options: YES_NO, refresh: true },
                    { key: 'username', label: 'Username', type: 'text', width: '220px', disabled: (p) => !usingAuth(p) },
                    { key: 'password', label: 'Password', type: 'password', width: '220px', disabled: (p) => !usingAuth(p) },
                    { section: 'Email Settings' },
                    { key: 'to', label: 'To', type: 'text', tooltip: 'The name of the mailbox (person, usually) to which the email should be sent.' },
                    { key: 'from', label: 'From', type: 'text', width: '220px' },
                    { key: 'subject', label: 'Subject', type: 'text' },
                    { key: 'charsetEncoding', label: 'Charset Encoding', type: 'select', options: CHARSETS, width: '160px' },
                    { key: 'html', label: 'HTML Body', type: 'radio', options: YES_NO },
                    { key: 'body', label: 'Body', type: 'code', minHeight: '180px' },
                    { key: 'isUseHeadersVariable', label: 'Headers', type: 'radio', refresh: true, options: [
                        { value: false, label: 'Use Table' },
                        { value: true, label: 'Use Map:' }
                    ] },
                    // Swing useHeadersVariableFieldsEnabled() greys BOTH the table and the
                    // variable field (setEnabled) — both stay VISIBLE. Grey-both, not swap.
                    { key: 'headers', type: 'keyvalue', mapShape: 'string', disabled: (p) => asBool(p.isUseHeadersVariable) },
                    { key: 'headersVariable', label: 'Map Variable', type: 'text', width: '320px', disabled: (p) => !asBool(p.isUseHeadersVariable) },
                    { key: 'isUseAttachmentsVariable', label: 'Attachments', type: 'radio', refresh: true, options: [
                        { value: false, label: 'Use Table' },
                        { value: true, label: 'Use List:' }
                    ] },
                    // Swing useAttachmentsVariableFieldsEnabled() greys BOTH the table and the
                    // variable field (setEnabled) — both stay VISIBLE. Grey-both, not swap. The
                    // 'custom' branch doesn't propagate disabled, so derive it inside render().
                    { type: 'custom', label: '', span: true,
                        render: (p) => attachmentsTable(p, onChange, asBool(p.isUseAttachmentsVariable)) },
                    { key: 'attachmentsVariable', label: 'List Variable', type: 'text', width: '320px', disabled: (p) => !asBool(p.isUseAttachmentsVariable) }
                ]} />
            </div>
        );
    }
};

export function register(platform) {
    platform.registerConnectorPanel('SMTP Sender', 'DESTINATION', smtpSender);
}
