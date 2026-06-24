// plugins/attachment-dicomviewer/web/plugin.jsx
import { platform } from "@oie/web-shell";
var React = platform.React;
function typeOf(att) {
  const t = att && att.type;
  return String(typeof t === "string" ? t : t && (t._ || t.$) || "").trim();
}
var WANTED = {
  "0008,0020": "Study Date",
  "0008,0060": "Modality",
  "0008,1030": "Study Description",
  "0010,0010": "Patient Name",
  "0010,0020": "Patient ID",
  "0028,0010": "Rows",
  "0028,0011": "Columns"
};
function parseDicomTags(bytes) {
  const out = {};
  if (bytes.length < 132) return out;
  if (String.fromCharCode(bytes[128], bytes[129], bytes[130], bytes[131]) !== "DICM") return out;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder("latin1");
  const longVR = /* @__PURE__ */ new Set(["OB", "OW", "OF", "SQ", "UT", "UN"]);
  let off = 132;
  let guard = 0;
  while (off + 8 <= bytes.length && guard++ < 2e3) {
    const group = dv.getUint16(off, true);
    const elem = dv.getUint16(off + 2, true);
    const vr = String.fromCharCode(bytes[off + 4], bytes[off + 5]);
    if (!/^[A-Z]{2}$/.test(vr)) break;
    let len, valOff;
    if (longVR.has(vr)) {
      len = dv.getUint32(off + 8, true);
      valOff = off + 12;
    } else {
      len = dv.getUint16(off + 6, true);
      valOff = off + 8;
    }
    if (len === 4294967295 || valOff + len > bytes.length) break;
    const tag = group.toString(16).padStart(4, "0") + "," + elem.toString(16).padStart(4, "0");
    if (WANTED[tag]) {
      out[tag] = vr === "US" ? String(dv.getUint16(valOff, true)) : dec.decode(bytes.subarray(valOff, valOff + len)).replace(/\0+$/, "").trim();
    }
    if (group > 40) break;
    off = valOff + len;
  }
  return out;
}
function register(platform2) {
  function DicomViewer({ attachment, channelId, messageId, platform: platform3 }) {
    const [state, setState] = React.useState({ status: "loading" });
    React.useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          const full = await platform3.api.messages.attachment(channelId, messageId, attachment.id);
          const b64 = String(full?.content ?? "").replace(/\s+/g, "");
          const bin = atob(b64);
          const bytes2 = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes2[i] = bin.charCodeAt(i);
          let tags2 = {};
          try {
            tags2 = parseDicomTags(bytes2);
          } catch (e) {
          }
          if (cancelled) return;
          setState({ status: "ready", bytes: bytes2, tags: tags2 });
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
      return /* @__PURE__ */ React.createElement("div", { className: "mt" }, /* @__PURE__ */ React.createElement("div", { className: "faint text-[11px] mb-1" }, "Loading DICOM\u2026"));
    }
    if (state.status === "error") {
      return /* @__PURE__ */ React.createElement("div", { className: "mt" }, /* @__PURE__ */ React.createElement("div", { className: "faint" }, `Could not load DICOM: ${state.message}`));
    }
    const { bytes, tags } = state;
    const rows = Object.entries(WANTED).filter(([tag]) => tags[tag] != null && tags[tag] !== "").map(([tag, label]) => /* @__PURE__ */ React.createElement("tr", { key: tag }, /* @__PURE__ */ React.createElement("td", { className: "font-semibold pr-4" }, label), /* @__PURE__ */ React.createElement("td", { className: "mono" }, tags[tag])));
    const saveDicom = () => platform3.ui.saveFile(
      `attachment-${attachment.id}.dcm`,
      "application/dicom",
      () => new Blob([bytes], { type: "application/dicom" })
    );
    return /* @__PURE__ */ React.createElement("div", { className: "mt" }, /* @__PURE__ */ React.createElement("div", { className: "font-semibold mb-1" }, `DICOM object \u2014 ${bytes.length.toLocaleString()} bytes`), rows.length ? /* @__PURE__ */ React.createElement("table", { className: "dt" }, /* @__PURE__ */ React.createElement("tbody", null, rows)) : /* @__PURE__ */ React.createElement("div", { className: "faint" }, "No readable header tags (non explicit-VR transfer syntax)."), /* @__PURE__ */ React.createElement("div", { className: "mt" }, /* @__PURE__ */ React.createElement("button", { className: "btn", onClick: saveDicom }, "Save DICOM")), /* @__PURE__ */ React.createElement("div", { className: "faint text-[11px] mt-1.5" }, "Inline image rendering requires a DICOM toolkit; save the object to view it in a DICOM viewer."));
  }
  platform2.registerAttachmentViewer({
    id: "dicomviewer",
    canHandle: (att) => /dicom|dcm/i.test(typeOf(att)),
    component: DicomViewer
  });
}
export {
  register
};
