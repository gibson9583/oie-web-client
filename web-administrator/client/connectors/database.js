import { React } from "./react-platform.js";
import { h, modal, textInput, select, icon, toast, clear, confirmDialog } from "@oie/web-ui";
import { ConnectorForm, PollSection, asBool, YES_NO, defaultSourceProperties, defaultDestinationProperties, defaultPollProperties, CHARSETS, requireFields } from "./react-forms.js";
import api from "../core/api.js";
const DRIVER_DEFAULT = "Please Select One";
let driversPromise = null;
function loadDrivers(platform) {
  if (!driversPromise) driversPromise = platform.api.server.databaseDrivers();
  return driversPromise;
}
function generateConnectionString(p) {
  return "var dbConn;\n\ntry {\n	dbConn = DatabaseConnectionFactory.createDatabaseConnection('" + (p.driver || "") + "','" + (p.url || "") + "','" + (p.username || "") + "','" + (p.password || "") + "');\n\n	// You may access this result below with $('column_name')\n	return result;\n} finally {\n	if (dbConn) { \n		dbConn.close();\n	}\n}";
}
function generateUpdateConnectionString(p) {
  let s = "";
  if (Number(p.updateMode) === 3) {
    s += "// This update script will be executed once for every result returned from the above query.\n";
  } else {
    s += "// This update script will be executed once after all results have been processed.\n";
  }
  if (asBool(p.aggregateResults)) {
    s += '// If "Aggregate Results" is enabled, you have access to "results",\n// a List of Map objects representing all rows returned from the above query.\n';
  }
  s += "var dbConn;\n\ntry {\n	dbConn = DatabaseConnectionFactory.createDatabaseConnection('" + (p.driver || "") + "','" + (p.url || "") + "','" + (p.username || "") + "','" + (p.password || "") + "');\n\n} finally {\n	if (dbConn) { \n		dbConn.close();\n	}\n}";
  return s;
}
function generateWriterConnectionString(p) {
  return "var dbConn;\n\ntry {\n	dbConn = DatabaseConnectionFactory.createDatabaseConnection('" + (p.driver || "") + "','" + (p.url || "") + "','" + (p.username || "") + "','" + (p.password || "") + "');\n\n} finally {\n	if (dbConn) { \n		dbConn.close();\n	}\n}";
}
function insertUrlTemplateButton(properties, platform, onChange) {
  return h("button.btn", {
    type: "button",
    class: "ml-1.5",
    onClick: async () => {
      const drivers = await loadDrivers(platform).catch(() => []);
      const d = drivers.find((x) => x && String(x.className) === String(properties.driver));
      const template = d && d.template ? String(d.template) : "";
      if (!template) {
        toast("The selected driver has no URL template.", "warn");
        return;
      }
      if (properties.url && !await confirmDialog(
        "Insert URL Template",
        "Replace your current connection URL with the template URL?",
        { okLabel: "Replace" }
      )) return;
      properties.url = template;
      onChange();
    }
  }, "Insert URL Template");
}
function driverControlNode(properties, platform, onChange) {
  const wrap = h("div", { class: "flex items-center gap-1.5" });
  const wrench = h("button.icon-btn", {
    type: "button",
    title: "View and manage the list of database JDBC drivers",
    class: "ml-1.5",
    onClick: () => openDriversModal(() => {
      driversPromise = null;
      refresh();
    })
  }, icon("settings"));
  function rebuild(control) {
    clear(wrap);
    wrap.appendChild(control);
    wrap.appendChild(wrench);
  }
  function refresh() {
    loadDrivers(platform).then((drivers) => {
      const options = [{ value: DRIVER_DEFAULT, label: DRIVER_DEFAULT }];
      for (const d of drivers) {
        if (d && d.className) options.push({ value: d.className, label: d.name || d.className });
      }
      const current = properties.driver;
      if (current && !options.some((o) => o.value === current)) {
        options.push({ value: current, label: current });
      }
      const sel = select(options, properties.driver ?? DRIVER_DEFAULT, {
        onChange: (e) => {
          properties.driver = e.target.value;
          onChange();
        }
      });
      sel.style.width = "220px";
      rebuild(sel);
    }).catch(() => {
      const input = textInput(properties.driver ?? "", {
        placeholder: "org.postgresql.Driver",
        onChange: (e) => {
          properties.driver = e.target.value;
          onChange();
        }
      });
      input.style.width = "220px";
      rebuild(input);
    });
  }
  const initial = select(
    [{ value: properties.driver ?? DRIVER_DEFAULT, label: properties.driver ?? DRIVER_DEFAULT }],
    properties.driver ?? DRIVER_DEFAULT,
    { onChange: (e) => {
      properties.driver = e.target.value;
      onChange();
    } }
  );
  initial.style.width = "220px";
  rebuild(initial);
  refresh();
  return wrap;
}
async function openDriversModal(onSaved) {
  let model;
  try {
    const drivers = await api.server.databaseDrivers();
    model = drivers.map((d) => ({
      name: d.name || "",
      className: d.className || "",
      template: d.template || "",
      selectLimit: d.selectLimit || "",
      alt: api.asList(d.alternativeClassNames, "string").map(String).filter(Boolean).join(", ")
    }));
  } catch (e) {
    toast(`Could not load drivers: ${e.message}`, "error");
    return;
  }
  const tbody = h("tbody");
  function rowEl(d) {
    const cell = (key, ph, w) => {
      const inp = textInput(d[key], { placeholder: ph, style: { width: w, maxWidth: "100%" } });
      inp.addEventListener("input", () => {
        d[key] = inp.value;
      });
      return h("td", { class: "py-0.5 px-1" }, inp);
    };
    return h(
      "tr",
      cell("name", "Name", "120px"),
      cell("className", "com.example.Driver", "200px"),
      cell("template", "jdbc:db://host:port/name", "220px"),
      cell("selectLimit", "SELECT * FROM ? LIMIT 1", "180px"),
      cell("alt", "legacy.Driver, ...", "160px"),
      h(
        "td",
        { class: "py-0.5 px-1" },
        h("button.icon-btn", { type: "button", title: "Remove", onClick: () => {
          model.splice(model.indexOf(d), 1);
          renderRows();
        } }, icon("x"))
      )
    );
  }
  function renderRows() {
    clear(tbody);
    if (!model.length) tbody.appendChild(h("tr", h("td", { colSpan: 6, class: "text-text-faint p-3" }, "No drivers \u2014 click Add.")));
    else model.forEach((d) => tbody.appendChild(rowEl(d)));
  }
  renderRows();
  const table = h("table.dt", h("thead", h(
    "tr",
    h("th", "Name"),
    h("th", "Driver Class"),
    h("th", "JDBC URL Template"),
    h("th", "Select with Limit Query"),
    h("th", "Legacy Driver Classes"),
    h("th", "")
  )), tbody);
  const addBtn = h("button.btn", { type: "button", onClick: () => {
    model.push({ name: "", className: "", template: "", selectLimit: "", alt: "" });
    renderRows();
  } }, icon("plus"), "Add");
  modal({
    title: "Database Drivers",
    size: "xwide",
    body: h(
      "div",
      { class: "flex flex-col gap-2.5" },
      h("div", addBtn),
      h("div", { class: "max-h-[55vh] overflow-auto" }, table)
    ),
    buttons: [
      { label: "Close" },
      {
        label: "Save",
        primary: true,
        onClick: async () => {
          const payload = model.filter((d) => d.name.trim() || d.className.trim()).map((d) => {
            const alt = d.alt.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
            return {
              name: d.name.trim(),
              className: d.className.trim(),
              template: d.template,
              selectLimit: d.selectLimit,
              // List<String>: { string: [...] } when present, empty element otherwise.
              alternativeClassNames: alt.length ? { string: alt } : ""
            };
          });
          try {
            await api.server.setDatabaseDrivers(payload);
            toast("Database drivers saved");
            onSaved && onSaved();
          } catch (e) {
            toast(`Save failed: ${e.message}`, "error");
            return false;
          }
        }
      }
    ]
  });
}
const databaseReader = {
  defaults(version) {
    return {
      "@class": "com.mirth.connect.connectors.jdbc.DatabaseReceiverProperties",
      "@version": version,
      pluginProperties: null,
      pollConnectorProperties: defaultPollProperties(version),
      sourceConnectorProperties: defaultSourceProperties(version),
      driver: DRIVER_DEFAULT,
      url: "",
      username: "",
      password: "",
      select: "",
      update: "",
      useScript: false,
      aggregateResults: false,
      cacheResults: true,
      keepConnectionOpen: true,
      updateMode: 1,
      retryCount: "3",
      retryInterval: "10000",
      fetchSize: "1000",
      encoding: "DEFAULT_ENCODING"
    };
  },
  component({ properties, platform, onChange }) {
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(PollSection, { properties, onChange }), /* @__PURE__ */ React.createElement(ConnectorForm, { properties, onChange, fields: [
      { section: "Connection Settings" },
      { type: "custom", label: "Driver", render: () => driverControlNode(properties, platform, onChange) },
      { key: "url", label: "URL", type: "text", width: "420px", append: (p, ctx) => insertUrlTemplateButton(p, platform, ctx.onChange) },
      { key: "username", label: "Username", type: "text", width: "220px" },
      { key: "password", label: "Password", type: "password", width: "220px" },
      { section: "Database Reader Settings" },
      {
        // Swing useScriptYes/NoActionPerformed: toggling re-seeds the editors —
        // Yes fills the Select + Post-Process editors with the connection
        // boilerplate (and switches them to JavaScript); No clears them back to SQL.
        key: "useScript",
        label: "Use JavaScript",
        type: "radio",
        options: YES_NO,
        refresh: true,
        onSet: (p, v) => {
          if (asBool(v)) {
            p.select = generateConnectionString(p);
            p.update = generateUpdateConnectionString(p);
          } else {
            p.select = "";
            p.update = "";
          }
        }
      },
      // Swing useScriptYes/No: Keep Connection Open is disabled in JavaScript mode.
      { key: "keepConnectionOpen", label: "Keep Connection Open", type: "radio", options: YES_NO, disabled: (p) => asBool(p.useScript) },
      // Swing aggregateResultsActionPerformed(true): forces Cache Results=Yes and disables it.
      {
        key: "aggregateResults",
        label: "Aggregate Results",
        type: "radio",
        options: YES_NO,
        refresh: true,
        onSet: (p) => {
          if (asBool(p.aggregateResults)) p.cacheResults = true;
        }
      },
      // Swing: Cache Results enabled only when Use JavaScript=No AND Aggregate Results=No.
      { key: "cacheResults", label: "Cache Results", type: "radio", options: YES_NO, refresh: true, disabled: (p) => asBool(p.useScript) || asBool(p.aggregateResults) },
      // Swing: Fetch Size enabled only when Use JavaScript=No AND Cache Results=No (aggregate forces cache=Yes).
      { key: "fetchSize", label: "Fetch Size", type: "number", width: "110px", disabled: (p) => asBool(p.useScript) || asBool(p.cacheResults) || asBool(p.aggregateResults) },
      { key: "retryCount", label: "# of Retries on Error", type: "number", width: "110px" },
      { key: "retryInterval", label: "Retry Interval (ms)", type: "number", width: "120px" },
      { key: "encoding", label: "Encoding", type: "select", options: CHARSETS, width: "160px" },
      { section: "Query" },
      {
        // Swing flips selectSQLLabel 'SQL:'<->'JavaScript:' + the editor syntax on Use JavaScript.
        key: "select",
        label: (p) => asBool(p.useScript) ? "JavaScript" : "SQL",
        type: "code",
        minHeight: "180px",
        language: (p) => asBool(p.useScript) ? "javascript" : "sql",
        tooltip: 'SQL select statement, or a JavaScript script when "Use JavaScript" is Yes'
      },
      {
        // Swing option labels (UPDATE_NEVER=1, UPDATE_EACH=3, UPDATE_ONCE=2);
        // runPostProcessSQLLabel flips 'SQL'<->'Script' on Use JavaScript.
        key: "updateMode",
        label: (p) => asBool(p.useScript) ? "Run Post-Process Script" : "Run Post-Process SQL",
        type: "radio",
        refresh: true,
        // Swing aggregateResultsActionPerformed relabels the per-message
        // options to per-row when Aggregate Results = Yes.
        options: (p) => asBool(p.aggregateResults) ? [{ value: 1, label: "Never" }, { value: 3, label: "For each row" }, { value: 2, label: "Once for all rows" }] : [{ value: 1, label: "Never" }, { value: 3, label: "After each message" }, { value: 2, label: "Once after all messages" }]
      },
      {
        // Swing updateNeverActionPerformed keeps this editor VISIBLE but disabled at Never.
        // The `code` field now honours `disabled`, so match Swing: grey it out (not hide it).
        key: "update",
        label: (p) => asBool(p.useScript) ? "JavaScript" : "SQL",
        type: "code",
        minHeight: "140px",
        language: (p) => asBool(p.useScript) ? "javascript" : "sql",
        disabled: (p) => Number(p.updateMode) === 1
      }
    ] }));
  },
  // Swing DatabaseReader.checkProperties: URL required unless Use JavaScript; the
  // SQL/JavaScript select is always required; the post-process SQL/script is
  // required unless Run Post-Process = Never (UPDATE_NEVER = 1); Driver required.
  validate(properties) {
    return requireFields(properties, [
      { key: "url", label: "URL", when: (p) => !asBool(p.useScript) },
      { key: "select", label: "SQL" },
      { key: "update", label: "Post-Process SQL", when: (p) => Number(p.updateMode) !== 1 },
      { key: "driver", label: "Driver" }
    ]);
  }
};
const databaseWriter = {
  defaults(version) {
    return {
      "@class": "com.mirth.connect.connectors.jdbc.DatabaseDispatcherProperties",
      "@version": version,
      pluginProperties: null,
      destinationConnectorProperties: defaultDestinationProperties(version),
      driver: DRIVER_DEFAULT,
      url: "",
      username: "",
      password: "",
      query: "",
      parameters: null,
      useScript: false
    };
  },
  component({ properties, platform, onChange }) {
    return /* @__PURE__ */ React.createElement(ConnectorForm, { properties, onChange, fields: [
      { section: "Connection Settings" },
      { type: "custom", label: "Driver", render: () => driverControlNode(properties, platform, onChange) },
      { key: "url", label: "URL", type: "text", width: "420px", append: (p, ctx) => insertUrlTemplateButton(p, platform, ctx.onChange) },
      { key: "username", label: "Username", type: "text", width: "220px" },
      { key: "password", label: "Password", type: "password", width: "220px" },
      { section: "Query" },
      {
        // Swing useJavaScriptYes/NoActionPerformed: toggling re-seeds the editor —
        // Yes fills it with the connection boilerplate (and switches to JavaScript);
        // No clears it back to SQL.
        key: "useScript",
        label: "Use JavaScript",
        type: "radio",
        options: YES_NO,
        refresh: true,
        onSet: (p, v) => {
          p.query = asBool(v) ? generateWriterConnectionString(p) : "";
        }
      },
      {
        // Swing flips sqlLabel 'SQL:'<->'JavaScript:' + the editor syntax on Use JavaScript.
        key: "query",
        label: (p) => asBool(p.useScript) ? "JavaScript" : "SQL",
        type: "code",
        minHeight: "200px",
        language: (p) => asBool(p.useScript) ? "javascript" : "sql"
      }
    ] });
  },
  // Swing DatabaseWriter.checkProperties: URL required unless Use JavaScript; the
  // SQL/JavaScript query is always required; Driver required (must not be blank).
  validate(properties) {
    return requireFields(properties, [
      { key: "url", label: "URL", when: (p) => !asBool(p.useScript) },
      { key: "query", label: "SQL" },
      { key: "driver", label: "Driver" }
    ]);
  }
};
function register(platform) {
  platform.registerConnectorPanel("Database Reader", "SOURCE", databaseReader);
  platform.registerConnectorPanel("Database Writer", "DESTINATION", databaseWriter);
}
export {
  register
};
