/*
 * Image attachment viewer — web admin plugin (AttachmentViewer equivalent, React).
 * Renders image attachments inline from their Base64 content.
 *
 * Authored in JSX against the host's React (platform.React) so the plugin
 * component shares the app's single React instance. The data-fetch /
 * normalization logic is the same as the original imperative plugin; only the
 * rendering became React/JSX. The registry now holds a `component` that receives
 * the same ctx the old render(host, ctx) got — { attachment, channelId,
 * messageId, platform } — as props and returns JSX.
 */
import { platform } from '@oie/web-shell';
const React = platform.React;

const IMAGE_RE = /^image\/|(^|[^a-z])(png|jpe?g|gif|bmp|webp|svg|tiff?)([^a-z]|$)/i;

function typeOf(att) {
    const t = att && att.type;
    return String(typeof t === 'string' ? t : (t && (t._ || t.$)) || '').trim();
}

export function register(platform) {

    // ctx (props): { attachment, channelId, messageId, platform }
    function ImageViewer({ attachment, channelId, messageId, platform }) {
        const [state, setState] = React.useState({ status: 'loading' });

        React.useEffect(() => {
            let cancelled = false;
            (async () => {
                try {
                    const full = await platform.api.messages.attachment(channelId, messageId, attachment.id);
                    const b64 = String(full?.content ?? '').replace(/\s+/g, '');
                    let mime = typeOf(full) || typeOf(attachment) || 'image/png';
                    if (!mime.includes('/')) mime = 'image/' + (mime.toLowerCase() === 'jpg' ? 'jpeg' : mime.toLowerCase());
                    if (cancelled) return;
                    setState({ status: 'ready', src: `data:${mime};base64,${b64}` });
                } catch (e) {
                    if (cancelled) return;
                    setState({ status: 'error', message: e.message });
                }
            })();
            return () => { cancelled = true; };
        }, [channelId, messageId, attachment.id]);

        if (state.status === 'loading') {
            return (
                <div className="mt-[14px]">
                    <div className="text-text-faint text-[11px] mb-1">Loading image…</div>
                </div>
            );
        }
        if (state.status === 'error') {
            return (
                <div className="mt-[14px]">
                    <div className="text-text-faint">{`Could not load image: ${state.message}`}</div>
                </div>
            );
        }
        return (
            <div className="mt-[14px]">
                <img
                    src={state.src}
                    className="max-w-full max-h-[600px] border border-[var(--bg3)] rounded-[4px]"
                />
            </div>
        );
    }

    platform.registerAttachmentViewer({
        id: 'imageviewer',
        canHandle: (att) => IMAGE_RE.test(typeOf(att)),
        component: ImageViewer
    });
}
