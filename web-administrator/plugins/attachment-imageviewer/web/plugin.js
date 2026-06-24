// plugins/attachment-imageviewer/web/plugin.jsx
import { platform } from "@oie/web-shell";
var React = platform.React;
var IMAGE_RE = /^image\/|(^|[^a-z])(png|jpe?g|gif|bmp|webp|svg|tiff?)([^a-z]|$)/i;
function typeOf(att) {
  const t = att && att.type;
  return String(typeof t === "string" ? t : t && (t._ || t.$) || "").trim();
}
function register(platform2) {
  function ImageViewer({ attachment, channelId, messageId, platform: platform3 }) {
    const [state, setState] = React.useState({ status: "loading" });
    React.useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          const full = await platform3.api.messages.attachment(channelId, messageId, attachment.id);
          const b64 = String(full?.content ?? "").replace(/\s+/g, "");
          let mime = typeOf(full) || typeOf(attachment) || "image/png";
          if (!mime.includes("/")) mime = "image/" + (mime.toLowerCase() === "jpg" ? "jpeg" : mime.toLowerCase());
          if (cancelled) return;
          setState({ status: "ready", src: `data:${mime};base64,${b64}` });
        } catch (e) {
          if (cancelled) return;
          setState({ status: "error", message: e.message });
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [channelId, messageId, attachment.id]);
    if (state.status === "loading") {
      return /* @__PURE__ */ React.createElement("div", { className: "mt-[14px]" }, /* @__PURE__ */ React.createElement("div", { className: "text-text-faint text-[11px] mb-1" }, "Loading image\u2026"));
    }
    if (state.status === "error") {
      return /* @__PURE__ */ React.createElement("div", { className: "mt-[14px]" }, /* @__PURE__ */ React.createElement("div", { className: "text-text-faint" }, `Could not load image: ${state.message}`));
    }
    return /* @__PURE__ */ React.createElement("div", { className: "mt-[14px]" }, /* @__PURE__ */ React.createElement(
      "img",
      {
        src: state.src,
        className: "max-w-full max-h-[600px] border border-[var(--bg3)] rounded-[4px]"
      }
    ));
  }
  platform2.registerAttachmentViewer({
    id: "imageviewer",
    canHandle: (att) => IMAGE_RE.test(typeOf(att)),
    component: ImageViewer
  });
}
export {
  register
};
