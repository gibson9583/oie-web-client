/*
 * Channel Reader/Writer connector — web admin plugin (ConnectorSettingsPanel
 * equivalent). The panel implementation lives in the shared client connector
 * library (/connectors/vm.js, built on the shared /connectors/forms.js
 * framework); this manifest loads it through the plugin system like any
 * connector plugin, so bundled and third-party connectors register the same way.
 */
export { register } from '/connectors/vm.js';
