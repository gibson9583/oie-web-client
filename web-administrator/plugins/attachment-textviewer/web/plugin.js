/*
 * Text attachment viewer — web admin plugin (AttachmentViewer equivalent).
 * Decodes the Base64 content and shows it as text.
 */

const TEXT_RE = /^text\/|xml|json|hl7|html|csv|plain|x-www-form/i;

function typeOf(att) {
    const t = att && att.type;
    return String(typeof t === 'string' ? t : (t && (t._ || t.$)) || '').trim();
}

export function register(platform) {
    const { h } = platform.ui;

    platform.registerAttachmentViewer({
        id: 'textviewer',
        canHandle: (att) => TEXT_RE.test(typeOf(att)),
        render(_body, { attachment, channelId, messageId, platform }) {
            const host = h('div.mt');
            host.appendChild(h('div.faint', { style: { fontSize: '11px', marginBottom: '4px' } }, 'Loading text…'));
            (async () => {
                try {
                    const full = await platform.api.messages.attachment(channelId, messageId, attachment.id);
                    let content = full?.content ?? full;
                    if (typeof content !== 'string') content = String(content ?? '');
                    let text = content;
                    try {
                        // Attachment content is Base64-encoded; decode to UTF-8 text.
                        const bin = atob(content.replace(/\s+/g, ''));
                        const bytes = new Uint8Array(bin.length);
                        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                        text = new TextDecoder().decode(bytes);
                    } catch (e) { /* not Base64 — show as-is */ }
                    platform.ui.clear(host);
                    host.appendChild(h('pre', {
                        style: {
                            margin: '0', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                            maxHeight: '600px', overflowX: 'hidden', overflowY: 'auto', fontSize: '12px',
                            background: 'var(--bg0)', color: 'var(--text)', border: '1px solid var(--bg3)',
                            padding: '8px', borderRadius: '4px'
                        }
                    }, text));
                } catch (e) {
                    platform.ui.clear(host);
                    host.appendChild(h('div.faint', `Could not load text: ${e.message}`));
                }
            })();
            return host;
        }
    });
}
