// plugins/attachment-textviewer/web/plugin.jsx
import { platform } from "@oie/web-shell";
var React = platform.React;
var TEXT_RE = /^text\/|xml|json|hl7|html|csv|plain|x-www-form/i;
function typeOf(att) {
  const t = att && att.type;
  return String(typeof t === "string" ? t : t && (t._ || t.$) || "").trim();
}
function register(platform2) {
  function TextViewer({ attachment, channelId, messageId, platform: platform3 }) {
    const [state, setState] = React.useState({ status: "loading" });
    React.useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          const full = await platform3.api.messages.attachment(channelId, messageId, attachment.id);
          let content = full?.content ?? full;
          if (typeof content !== "string") content = String(content ?? "");
          let text = content;
          try {
            const bin = atob(content.replace(/\s+/g, ""));
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            text = new TextDecoder().decode(bytes);
          } catch (e) {
          }
          if (cancelled) return;
          setState({ status: "ready", text });
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
      return /* @__PURE__ */ React.createElement("div", { className: "mt" }, /* @__PURE__ */ React.createElement("div", { className: "faint", style: { fontSize: "11px", marginBottom: "4px" } }, "Loading text\u2026"));
    }
    if (state.status === "error") {
      return /* @__PURE__ */ React.createElement("div", { className: "mt" }, /* @__PURE__ */ React.createElement("div", { className: "faint" }, `Could not load text: ${state.message}`));
    }
    return /* @__PURE__ */ React.createElement("div", { className: "mt" }, /* @__PURE__ */ React.createElement(
      "pre",
      {
        style: {
          margin: "0",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: "600px",
          overflowX: "hidden",
          overflowY: "auto",
          fontSize: "12px",
          background: "var(--bg0)",
          color: "var(--text)",
          border: "1px solid var(--bg3)",
          padding: "8px",
          borderRadius: "4px"
        }
      },
      state.text
    ));
  }
  platform2.registerAttachmentViewer({
    id: "textviewer",
    canHandle: (att) => TEXT_RE.test(typeOf(att)),
    component: TextViewer
  });
}
export {
  register
};
