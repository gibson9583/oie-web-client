// plugins/attachment-imageviewer/web/plugin.tsx
import { platform } from "@oie/web-shell";
var React = platform.React;
var IMAGE_RE = /^image\/|(^|[^a-z])(png|jpe?g|gif|bmp|webp|svg|tiff?)([^a-z]|$)/i;
function typeOf(att) {
  const t = att && att.type;
  return String(typeof t === "string" ? t : t && (t._ || t.$) || "").trim();
}
function register(platform2) {
  function ImageViewer({ attachment, channelId, messageId, platform: platform3 }) {
    const key = JSON.stringify([channelId, messageId, attachment.id]);
    const [state, setState] = React.useState({ status: "loading", key });
    const [attempt, retry] = React.useReducer((value) => value + 1, 0);
    const fallbackType = typeOf(attachment);
    React.useEffect(() => {
      let cancelled = false;
      setState({ status: "loading", key });
      (async () => {
        try {
          const full = await platform3.api.messages.attachment(channelId, messageId, attachment.id);
          const b64 = String(full?.content ?? "").replace(/\s+/g, "");
          let mime = typeOf(full) || fallbackType || "image/png";
          if (!mime.includes("/")) mime = "image/" + (mime.toLowerCase() === "jpg" ? "jpeg" : mime.toLowerCase());
          if (cancelled) return;
          setState({ status: "ready", key, src: `data:${mime};base64,${b64}` });
        } catch (e) {
          if (cancelled) return;
          setState({ status: "error", key, message: e.message });
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [channelId, messageId, attachment.id, key, platform3.api.messages, attempt, fallbackType]);
    if (state.key !== key || state.status === "loading") {
      return /* @__PURE__ */ React.createElement("div", { className: "mt-[13px]" }, /* @__PURE__ */ React.createElement("div", { className: "text-text-faint text-[10px] mb-1" }, "Loading image\u2026"));
    }
    if (state.status === "error") {
      return /* @__PURE__ */ React.createElement("div", { className: "mt-[13px]" }, /* @__PURE__ */ React.createElement("div", { className: "text-text-faint" }, `Could not load image: ${state.message}`), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn", onClick: () => retry() }, "Retry"));
    }
    return /* @__PURE__ */ React.createElement("div", { className: "mt-[13px]" }, /* @__PURE__ */ React.createElement(
      "img",
      {
        alt: "Message attachment",
        src: state.src,
        className: "max-w-full max-h-[540px] border border-[var(--bg3)] rounded-[4px]"
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
