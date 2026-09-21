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
import type { Platform } from '@oie/web-shell';
const React = platform.React;

const IMAGE_RE = /^image\/|(^|[^a-z])(png|jpe?g|gif|bmp|webp|svg|tiff?)([^a-z]|$)/i;

function typeOf(att: any) {
    const t = att && att.type;
    return String(typeof t === 'string' ? t : (t && (t._ || t.$)) || '').trim();
}

export function register(platform: Platform) {

    // ctx (props): { attachment, channelId, messageId, platform }
    function ImageViewer({ attachment, channelId, messageId, platform }: any) {
        const key = JSON.stringify([channelId, messageId, attachment.id]);
        const [state, setState] = React.useState({ status: 'loading', key });
        const [attempt, retry] = React.useReducer((value: number) => value + 1, 0);
        const fallbackType = typeOf(attachment);

        React.useEffect(() => {
            let cancelled = false;
            setState({ status: 'loading', key });
            (async () => {
                try {
                    const full = await platform.api.messages.attachment(channelId, messageId, attachment.id);
                    const b64 = String(full?.content ?? '').replace(/\s+/g, '');
                    let mime = typeOf(full) || fallbackType || 'image/png';
                    if (!mime.includes('/')) mime = 'image/' + (mime.toLowerCase() === 'jpg' ? 'jpeg' : mime.toLowerCase());
                    if (cancelled) return;
                    setState({ status: 'ready', key, src: `data:${mime};base64,${b64}` });
                } catch (e: any) {
                    if (cancelled) return;
                    setState({ status: 'error', key, message: e.message });
                }
            })();
            return () => { cancelled = true; };
        }, [channelId, messageId, attachment.id, key, platform.api.messages, attempt, fallbackType]);

        if (state.key !== key || state.status === 'loading') {
            return (
                <div className="mt-[13px]">
                    <div className="text-text-faint text-[10px] mb-1">Loading image…</div>
                </div>
            );
        }
        if (state.status === 'error') {
            return (
                <div className="mt-[13px]">
                    <div className="text-text-faint">{`Could not load image: ${state.message}`}</div>
                    <button type="button" className="btn" onClick={() => retry()}>Retry</button>
                </div>
            );
        }
        return (
            <div className="mt-[13px]">
                <img
                    alt="Message attachment"
                    src={state.src}
                    className="max-w-full max-h-[540px] border border-[var(--bg3)] rounded-[4px]"
                />
            </div>
        );
    }

    platform.registerAttachmentViewer({
        id: 'imageviewer',
        canHandle: (att: any) => IMAGE_RE.test(typeOf(att)),
        component: ImageViewer
    });
}
