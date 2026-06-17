/*
 * PDF attachment viewer — web admin plugin (AttachmentViewer equivalent).
 * Renders PDF attachments inline in an iframe from their Base64 content.
 */

function typeOf(att) {
    const t = att && att.type;
    return String(typeof t === 'string' ? t : (t && (t._ || t.$)) || '').trim();
}

export function register(platform) {
    const { h } = platform.ui;

    platform.registerAttachmentViewer({
        id: 'pdfviewer',
        canHandle: (att) => /pdf/i.test(typeOf(att)),
        render(_body, { attachment, channelId, messageId, platform }) {
            const host = h('div.mt');
            host.appendChild(h('div.faint', { style: { fontSize: '11px', marginBottom: '4px' } }, 'Loading PDF…'));
            (async () => {
                try {
                    const full = await platform.api.messages.attachment(channelId, messageId, attachment.id);
                    const b64 = String(full?.content ?? '').replace(/\s+/g, '');
                    platform.ui.clear(host);
                    // Sandbox the attacker-controlled PDF: opaque origin, no
                    // scripts, no top-frame navigation (render-only). Set before
                    // src so it applies to the loaded document.
                    const frame = h('iframe', {
                        style: { width: '100%', height: '640px', border: '1px solid var(--bg3)', borderRadius: '4px' }
                    });
                    frame.setAttribute('sandbox', '');
                    frame.src = `data:application/pdf;base64,${b64}`;
                    host.appendChild(frame);
                } catch (e) {
                    platform.ui.clear(host);
                    host.appendChild(h('div.faint', `Could not load PDF: ${e.message}`));
                }
            })();
            return host;
        }
    });
}
