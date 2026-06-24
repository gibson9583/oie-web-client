/*
 * PDF attachment viewer — web admin plugin (AttachmentViewer equivalent, React).
 * Renders PDF attachments inline in an iframe from their Base64 content.
 *
 * Authored in JSX against the host's React (platform.React) so the plugin
 * component shares the app's single React instance. The data-fetch logic is the
 * same as the original imperative plugin; only the rendering became React/JSX.
 * The registry now holds a `component` that receives the same ctx the old
 * render(host, ctx) got — { attachment, channelId, messageId, platform } — as
 * props and returns JSX.
 */
import { platform } from '@oie/web-shell';
const React = platform.React;

function typeOf(att) {
    const t = att && att.type;
    return String(typeof t === 'string' ? t : (t && (t._ || t.$)) || '').trim();
}

export function register(platform) {

    // ctx (props): { attachment, channelId, messageId, platform }
    function PdfViewer({ attachment, channelId, messageId, platform }) {
        const [state, setState] = React.useState({ status: 'loading' });

        React.useEffect(() => {
            let cancelled = false;
            (async () => {
                try {
                    const full = await platform.api.messages.attachment(channelId, messageId, attachment.id);
                    const b64 = String(full?.content ?? '').replace(/\s+/g, '');
                    if (cancelled) return;
                    setState({ status: 'ready', src: `data:application/pdf;base64,${b64}` });
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
                    <div className="text-text-faint text-[11px] mb-1">Loading PDF…</div>
                </div>
            );
        }
        if (state.status === 'error') {
            return (
                <div className="mt-[14px]">
                    <div className="text-text-faint">{`Could not load PDF: ${state.message}`}</div>
                </div>
            );
        }
        // Sandbox the attacker-controlled PDF: opaque origin, no scripts, no
        // top-frame navigation (render-only) via an empty sandbox attribute.
        return (
            <div className="mt-[14px]">
                <iframe
                    sandbox=""
                    src={state.src}
                    className="w-full h-[640px] border border-[var(--bg3)] rounded-[4px]"
                />
            </div>
        );
    }

    platform.registerAttachmentViewer({
        id: 'pdfviewer',
        canHandle: (att) => /pdf/i.test(typeOf(att)),
        component: PdfViewer
    });
}
