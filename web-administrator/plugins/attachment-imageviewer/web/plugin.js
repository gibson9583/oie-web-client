/*
 * Image attachment viewer — web admin plugin (AttachmentViewer equivalent).
 * Renders image attachments inline from their Base64 content.
 */

const IMAGE_RE = /^image\/|(^|[^a-z])(png|jpe?g|gif|bmp|webp|svg|tiff?)([^a-z]|$)/i;

function typeOf(att) {
    const t = att && att.type;
    return String(typeof t === 'string' ? t : (t && (t._ || t.$)) || '').trim();
}

export function register(platform) {
    const { h } = platform.ui;

    platform.registerAttachmentViewer({
        id: 'imageviewer',
        canHandle: (att) => IMAGE_RE.test(typeOf(att)),
        render(_body, { attachment, channelId, messageId, platform }) {
            const host = h('div.mt');
            host.appendChild(h('div.faint', { style: { fontSize: '11px', marginBottom: '4px' } }, 'Loading image…'));
            (async () => {
                try {
                    const full = await platform.api.messages.attachment(channelId, messageId, attachment.id);
                    const b64 = String(full?.content ?? '').replace(/\s+/g, '');
                    let mime = typeOf(full) || typeOf(attachment) || 'image/png';
                    if (!mime.includes('/')) mime = 'image/' + (mime.toLowerCase() === 'jpg' ? 'jpeg' : mime.toLowerCase());
                    platform.ui.clear(host);
                    host.appendChild(h('img', {
                        src: `data:${mime};base64,${b64}`,
                        style: { maxWidth: '100%', maxHeight: '600px', border: '1px solid var(--bg3)', borderRadius: '4px' }
                    }));
                } catch (e) {
                    platform.ui.clear(host);
                    host.appendChild(h('div.faint', `Could not load image: ${e.message}`));
                }
            })();
            return host;
        }
    });
}
