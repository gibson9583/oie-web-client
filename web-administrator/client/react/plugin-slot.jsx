/*
 * Renders a plugin-contributed React extension. Every plugin (first-party and
 * third-party) authors its UI in React against platform.React, so it shares the
 * host's single React instance — registries hold a `component` (a React
 * component) and the app renders it in-tree as <Component {...ctx}/>.
 *
 * Used wherever the app surfaces plugin UI: dashboard tabs/columns, settings
 * panels, channel tabs, connector panels, transformer step/rule editors, etc.
 */

export function PluginSlot({ def, ctx }) {
    const Component = def && def.component;
    if (typeof Component !== 'function') return null;
    return <Component {...(ctx || {})} />;
}
