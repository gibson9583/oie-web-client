/*
 * Document Writer (DocumentDispatcherProperties).
 * Field names and defaults mirror server/src/com/mirth/connect/connectors/doc.
 */

import { h } from '../core/ui.js';
import { buildForm, asBool, YES_NO, defaultDestinationProperties } from './forms.js';

const writesFile = (p) => String(p.output ?? 'FILE').toUpperCase() !== 'ATTACHMENT';
const isPdf = (p) => String(p.documentType ?? 'pdf').toLowerCase() === 'pdf';

const documentWriter = {
    defaults(version) {
        return {
            '@class': 'com.mirth.connect.connectors.doc.DocumentDispatcherProperties',
            '@version': version,
            pluginProperties: null,
            destinationConnectorProperties: defaultDestinationProperties(version),
            host: '',
            outputPattern: '',
            documentType: 'pdf',
            encrypt: false,
            output: 'FILE',
            password: '',
            pageWidth: '8.5',
            pageHeight: '11',
            pageUnit: 'INCHES',
            template: ''
        };
    },
    render(host, { properties, onChange }) {
        const formHost = h('div');
        host.appendChild(formHost);
        buildForm(formHost, properties, [
            { section: 'Output Settings' },
            { key: 'output', label: 'Output', type: 'radio', refresh: true, options: [
                { value: 'FILE', label: 'File' },
                { value: 'ATTACHMENT', label: 'Attachment' },
                { value: 'BOTH', label: 'Both' }
            ] },
            { key: 'host', label: 'Directory', type: 'text', width: '420px', placeholder: '/path/to/directory', visible: writesFile },
            { key: 'outputPattern', label: 'File Name', type: 'text', width: '220px', placeholder: '${message.messageId}.pdf', visible: writesFile },
            { section: 'Document Settings' },
            { key: 'documentType', label: 'Document Type', type: 'radio', refresh: true, options: [
                { value: 'pdf', label: 'PDF' },
                { value: 'rtf', label: 'RTF' }
            ] },
            { key: 'encrypt', label: 'Encrypted', type: 'radio', options: YES_NO, refresh: true, visible: isPdf },
            { key: 'password', label: 'Password', type: 'password', width: '220px', visible: (p) => isPdf(p) && asBool(p.encrypt) },
            { key: 'pageWidth', label: 'Page Width', type: 'text', width: '90px' },
            { key: 'pageHeight', label: 'Page Height', type: 'text', width: '90px' },
            { key: 'pageUnit', label: 'Page Unit', type: 'select', width: '120px', options: [
                { value: 'INCHES', label: 'Inches' },
                { value: 'MM', label: 'mm' },
                { value: 'TWIPS', label: 'Twips' }
            ] },
            { section: 'Template' },
            { key: 'template', label: 'HTML Template', type: 'code', language: 'html', minHeight: '180px' }
        ], onChange);
    }
};

export function register(platform) {
    platform.registerConnectorPanel('Document Writer', 'DESTINATION', documentWriter);
}
