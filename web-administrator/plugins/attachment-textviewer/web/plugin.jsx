/*
 * Text attachment viewer — web admin plugin (AttachmentViewer equivalent, React).
 * Decodes the Base64 content and shows it as text.
 *
 * Authored in JSX against the host's React (platform.React) so the plugin
 * component shares the app's single React instance. The decode logic is the same
 * as the original imperative plugin; only the rendering became React/JSX. The
 * registry now holds a `component` that receives the same ctx the old
 * render(host, ctx) got — { attachment, channelId, messageId, platform } — as
 * props and returns JSX.
 */
import { platform } from '@oie/web-shell';
const React = platform.React;

const TEXT_RE = /^text\/|xml|json|hl7|html|csv|plain|x-www-form/i;

function typeOf(att) {
    const t = att && att.type;
    return String(typeof t === 'string' ? t : (t && (t._ || t.$)) || '').trim();
}

export function register(platform) {

    // ctx (props): { attachment, channelId, messageId, platform }
    function TextViewer({ attachment, channelId, messageId, platform }) {
        const [state, setState] = React.useState({ status: 'loading' });

        React.useEffect(() => {
            let cancelled = false;
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
                    if (cancelled) return;
                    setState({ status: 'ready', text });
                } catch (e) {
                    if (cancelled) return;
                    setState({ status: 'error', message: e.message });
                }
            })();
            return () => { cancelled = true; };
        }, [channelId, messageId, attachment.id]);

        if (state.status === 'loading') {
            return (
                <div className="mt">
                    <div className="faint text-[11px] mb-1">Loading text…</div>
                </div>
            );
        }
        if (state.status === 'error') {
            return (
                <div className="mt">
                    <div className="faint">{`Could not load text: ${state.message}`}</div>
                </div>
            );
        }
        return (
            <div className="mt">
                <pre
                    className="m-0 whitespace-pre-wrap [word-break:break-word] max-h-[600px] overflow-x-hidden overflow-y-auto text-[12px] bg-bg0 text-text border border-[var(--bg3)] p-2 rounded-[4px]"
                >{state.text}</pre>
            </div>
        );
    }

    platform.registerAttachmentViewer({
        id: 'textviewer',
        canHandle: (att) => TEXT_RE.test(typeOf(att)),
        component: TextViewer
    });
}
