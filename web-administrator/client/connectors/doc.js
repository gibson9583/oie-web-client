import { React } from "./react-platform.js";
import { h, select, taskButton, toast } from "@oie/web-ui";
import { ConnectorForm, asBool, YES_NO, defaultDestinationProperties, successToast, apiErrorMessage, requireFields } from "./react-forms.js";
import { post } from "../core/api.js";
const writesFile = (p) => String(p.output ?? "FILE").toUpperCase() !== "ATTACHMENT";
const isRtf = (p) => String(p.documentType ?? "pdf").toLowerCase() === "rtf";
function docTestWriteButton(properties, channel) {
  const btn = taskButton("Test Write", "folder", async () => {
    btn.disabled = true;
    try {
      const result = await post("/connectors/doc/_testWrite", properties.host ?? "", {
        params: { channelId: channel ? channel.id : "", channelName: channel ? channel.name : "" },
        contentType: "text/plain"
      });
      const type = result && typeof result === "object" ? String(result.type ?? "") : "";
      const message = result && typeof result === "object" && result.message || type || "No response received";
      if (type === "SUCCESS") successToast(message);
      else toast(message, "error");
    } catch (e) {
      toast(apiErrorMessage(e), "error");
    } finally {
      btn.disabled = false;
    }
  });
  btn.disabled = !writesFile(properties);
  return btn;
}
const PAGE_UNITS = [
  { value: "INCHES", label: "in" },
  { value: "MM", label: "mm" },
  { value: "TWIPS", label: "twips" }
];
const PAGE_SIZES = [
  { name: "Letter", width: 8.5, height: 11, unit: "INCHES" },
  { name: "Legal", width: 8.5, height: 14, unit: "INCHES" },
  { name: "Ledger", width: 11, height: 17, unit: "INCHES" },
  { name: "Tabloid", width: 17, height: 11, unit: "INCHES" },
  { name: "Executive", width: 7.25, height: 10.55, unit: "INCHES" },
  { name: "ANSI C", width: 22, height: 17, unit: "INCHES" },
  { name: "ANSI D", width: 34, height: 22, unit: "INCHES" },
  { name: "ANSI E", width: 44, height: 34, unit: "INCHES" },
  { name: "A0", width: 841, height: 1189, unit: "MM" },
  { name: "A1", width: 594, height: 841, unit: "MM" },
  { name: "A2", width: 420, height: 594, unit: "MM" },
  { name: "A3", width: 297, height: 420, unit: "MM" },
  { name: "A4", width: 210, height: 297, unit: "MM" },
  { name: "A5", width: 148, height: 210, unit: "MM" },
  { name: "A6", width: 105, height: 148, unit: "MM" },
  { name: "A7", width: 74, height: 105, unit: "MM" },
  { name: "A8", width: 52, height: 74, unit: "MM" },
  { name: "A9", width: 37, height: 52, unit: "MM" },
  { name: "A10", width: 26, height: 37, unit: "MM" },
  { name: "B0", width: 1e3, height: 1414, unit: "MM" },
  { name: "B1", width: 707, height: 1e3, unit: "MM" },
  { name: "B2", width: 500, height: 707, unit: "MM" },
  { name: "B3", width: 353, height: 500, unit: "MM" },
  { name: "B4", width: 250, height: 343, unit: "MM" },
  { name: "B5", width: 176, height: 250, unit: "MM" },
  { name: "B6", width: 125, height: 176, unit: "MM" },
  { name: "B7", width: 88, height: 125, unit: "MM" },
  { name: "B8", width: 62, height: 88, unit: "MM" },
  { name: "B9", width: 44, height: 62, unit: "MM" },
  { name: "B10", width: 31, height: 44, unit: "MM" }
];
const CONVERSION = {
  INCHES: { INCHES: 1, MM: 25.4, TWIPS: 1440 },
  MM: { INCHES: 1 / 25.4, MM: 1, TWIPS: 1440 / 25.4 },
  TWIPS: { INCHES: 1 / 1440, MM: 25.4 / 1440, TWIPS: 1 }
};
const convertTo = (value, from, to) => (CONVERSION[from]?.[to] ?? 1) * value;
const matchingPreset = (p) => {
  const width = Number.parseFloat(p.pageWidth);
  const height = Number.parseFloat(p.pageHeight);
  const unit = String(p.pageUnit ?? "INCHES");
  if (!Number.isFinite(width) || !Number.isFinite(height)) return "CUSTOM";
  for (const ps of PAGE_SIZES) {
    if (convertTo(ps.width, ps.unit, unit) === width && convertTo(ps.height, ps.unit, unit) === height) {
      return ps.name;
    }
  }
  return "CUSTOM";
};
const scale2Down = (value) => (Math.trunc(value * 100) / 100).toFixed(2);
function pageSizeRow(p, { onChange }) {
  const widthField = h("input", {
    type: "text",
    value: p.pageWidth ?? "",
    class: "w-[54px]",
    onInput: (e) => {
      p.pageWidth = e.target.value;
      onChange();
    }
  });
  const heightField = h("input", {
    type: "text",
    value: p.pageHeight ?? "",
    class: "w-[54px]",
    onInput: (e) => {
      p.pageHeight = e.target.value;
      onChange();
    }
  });
  const unitField = select(PAGE_UNITS, p.pageUnit ?? "INCHES", {
    class: "w-[90px]",
    onChange: (e) => {
      p.pageUnit = e.target.value;
      onChange();
    }
  });
  const current = matchingPreset(p);
  const presetOptions = PAGE_SIZES.map((ps) => ({ value: ps.name, label: ps.name }));
  if (current === "CUSTOM") presetOptions.push({ value: "CUSTOM", label: "Custom" });
  const presetField = select(presetOptions, current, {
    onChange: (e) => {
      const ps = PAGE_SIZES.find((x) => x.name === e.target.value);
      if (ps) {
        p.pageWidth = scale2Down(ps.width);
        p.pageHeight = scale2Down(ps.height);
        p.pageUnit = ps.unit;
        onChange();
      }
    }
  });
  return h(
    "div",
    { class: "flex items-center gap-1.5" },
    widthField,
    h("span", "\xD7"),
    heightField,
    unitField,
    presetField
  );
}
const documentWriter = {
  defaults(version) {
    return {
      "@class": "com.mirth.connect.connectors.doc.DocumentDispatcherProperties",
      "@version": version,
      pluginProperties: null,
      destinationConnectorProperties: defaultDestinationProperties(version),
      host: "",
      outputPattern: "",
      documentType: "pdf",
      encrypt: false,
      output: "FILE",
      password: "",
      pageWidth: "8.5",
      pageHeight: "11",
      pageUnit: "INCHES",
      template: ""
    };
  },
  component({ properties, channel, onChange }) {
    return /* @__PURE__ */ React.createElement(ConnectorForm, { properties, onChange, fields: [
      { key: "output", label: "Output", type: "radio", refresh: true, options: [
        { value: "FILE", label: "File" },
        { value: "ATTACHMENT", label: "Attachment" },
        { value: "BOTH", label: "Both" }
      ] },
      {
        key: "host",
        label: "Directory",
        type: "text",
        width: "200px",
        disabled: (p) => !writesFile(p),
        append: () => docTestWriteButton(properties, channel)
      },
      { key: "outputPattern", label: "File Name", type: "text", width: "200px", disabled: (p) => !writesFile(p) },
      {
        // Switching to RTF disables the Encrypted radio and forces Encrypted=No
        // (documentTypeRTFRadioActionPerformed -> encryptedNoActionPerformed).
        key: "documentType",
        label: "Document Type",
        type: "radio",
        refresh: true,
        onSet: (p) => {
          if (isRtf(p)) p.encrypt = false;
        },
        options: [
          { value: "pdf", label: "PDF" },
          { value: "rtf", label: "RTF" }
        ]
      },
      { key: "encrypt", label: "Encrypted", type: "radio", options: YES_NO, refresh: true, disabled: isRtf },
      // Password is greyed when Encrypted=No, including under RTF (which calls
      // encryptedNoActionPerformed and disables the Encrypted radio).
      { key: "password", label: "Password", type: "password", width: "124px", disabled: (p) => isRtf(p) || !asBool(p.encrypt) },
      { label: "Page Size", type: "custom", render: pageSizeRow },
      { key: "template", label: "HTML Template", type: "code", language: "html", minHeight: "260px" }
    ] });
  },
  // Swing DocumentWriter.checkProperties: Directory/File Name required unless Output =
  // Attachment (writesFile); HTML Template always required; Password required when
  // Encrypted = Yes; Page Width/Height must not be blank (numeric/range check skipped).
  validate(properties) {
    return requireFields(properties, [
      { key: "host", label: "Directory", when: writesFile },
      { key: "outputPattern", label: "File Name", when: writesFile },
      { key: "template", label: "HTML Template" },
      { key: "password", label: "Password", when: (p) => asBool(p.encrypt) },
      { key: "pageWidth", label: "Page Width" },
      { key: "pageHeight", label: "Page Height" }
    ]);
  }
};
function register(platform) {
  platform.registerConnectorPanel("Document Writer", "DESTINATION", documentWriter);
}
export {
  register
};
