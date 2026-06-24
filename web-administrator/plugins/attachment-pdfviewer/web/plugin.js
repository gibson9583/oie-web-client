// plugins/attachment-pdfviewer/web/plugin.jsx
import { platform } from "@oie/web-shell";
var React = platform.React;
function typeOf(att) {
  const t = att && att.type;
  return String(typeof t === "string" ? t : t && (t._ || t.$) || "").trim();
}
function register(platform2) {
  function PdfViewer({ attachment, channelId, messageId, platform: platform3 }) {
    const [state, setState] = React.useState({ status: "loading" });
    React.useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          const full = await platform3.api.messages.attachment(channelId, messageId, attachment.id);
          const b64 = String(full?.content ?? "").replace(/\s+/g, "");
          if (cancelled) return;
          setState({ status: "ready", src: `data:application/pdf;base64,${b64}` });
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
      return /* @__PURE__ */ React.createElement("div", { className: "mt-[14px]" }, /* @__PURE__ */ React.createElement("div", { className: "text-text-faint text-[11px] mb-1" }, "Loading PDF\u2026"));
    }
    if (state.status === "error") {
      return /* @__PURE__ */ React.createElement("div", { className: "mt-[14px]" }, /* @__PURE__ */ React.createElement("div", { className: "text-text-faint" }, `Could not load PDF: ${state.message}`));
    }
    return /* @__PURE__ */ React.createElement("div", { className: "mt-[14px]" }, /* @__PURE__ */ React.createElement(
      "iframe",
      {
        sandbox: "",
        src: state.src,
        className: "w-full h-[640px] border border-[var(--bg3)] rounded-[4px]"
      }
    ));
  }
  platform2.registerAttachmentViewer({
    id: "pdfviewer",
    canHandle: (att) => /pdf/i.test(typeOf(att)),
    component: PdfViewer
  });
}
export {
  register
};
