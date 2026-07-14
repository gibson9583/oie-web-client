/*
 * Type regression guard for @oie/web-shell — the plugin extension surface.
 */
import { platform } from '@oie/web-shell';
import type { Platform } from '@oie/web-shell';
import { h } from '@oie/web-ui';

// A plugin's register(platform) entry point typed against the public contract.
export function register(p: Platform) {
    p.registerNavItem({ id: 'demo', label: 'Demo', path: '/demo', section: 'Engine', order: 9 });
    p.registerView('/demo', () => ({ el: h('div', 'hi') }), { title: 'Demo' });
    // Plugin UI is a React `component` (rendered as <Component {...ctx}/>), not an
    // imperative render(host, ctx). Authored against platform.React.
    p.registerConnectorPanel('My Reader', 'SOURCE', {
        defaults: (v) => ({ '@version': v }),
        component: ({ properties, onChange }) => { void properties; void onChange; return null; },
    });
    p.registerSettingsPanel({
        label: 'Demo Settings',
        component: ({ platform: plat, setSave, markDirty }) => { void plat; void setSave; void markDirty; return null; },
    });
    // Channel tabs are a React component, rendered as <Component {...ctx}/>.
    p.registerChannelTab({
        id: 'demo-tab', label: 'Demo Tab',
        component: ({ channel, onChange }) => { void channel; void onChange; return null; },
    });
}

async function libraries() {
    const v: string = await platform.api.server.version();
    platform.ui.toast('hello');
    const id: string = platform.oie.uuid();
    return [v, id];
}

function taskGating() {
    // Nav items and dashboard tabs carry the RBAC task tag (view/dashboard groups).
    platform.registerNavItem({ id: 'x', label: 'X', path: '/x', task: 'doShowChannel' });
    platform.registerDashboardTab({ id: 'y', label: 'Y', task: 'doShowThreadViewer', component: () => null });
}

function badUsage() {
    // @ts-expect-error connector mode must be 'SOURCE' | 'DESTINATION'
    platform.registerConnectorPanel('X', 'BOTH', { defaults: () => ({}), component: () => null });
    // @ts-expect-error buildForm is not on platform.ui (the DOM-toolkit subset)
    platform.ui.buildForm;
    // @ts-expect-error renamed away from platform.mirth to platform.oie
    platform.mirth;
    // @ts-expect-error a channel tab requires `component` (the legacy imperative render path was removed)
    platform.registerChannelTab({ id: 'x', label: 'X' });
}

void libraries;
void badUsage;
void taskGating;
