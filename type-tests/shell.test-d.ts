/*
 * Type regression guard for @oie/web-shell — the plugin extension surface.
 */
import { platform } from '@oie/web-shell';
import type { Platform } from '@oie/web-shell';
import { h, buildForm } from '@oie/web-ui';

// A plugin's register(platform) entry point typed against the public contract.
export function register(p: Platform) {
    p.registerNavItem({ id: 'demo', label: 'Demo', path: '/demo', section: 'Engine', order: 9 });
    p.registerView('/demo', () => ({ el: h('div', 'hi') }), { title: 'Demo' });
    p.registerConnectorPanel('My Reader', 'SOURCE', {
        defaults: (v) => ({ '@version': v }),
        render: (host, { properties, onChange }) => buildForm(host, properties, [{ key: 'x', label: 'X' }], onChange),
    });
}

async function libraries() {
    const v: string = await platform.api.server.version();
    platform.ui.toast('hello');
    const id: string = platform.oie.uuid();
    return [v, id];
}

function badUsage() {
    // @ts-expect-error connector mode must be 'SOURCE' | 'DESTINATION'
    platform.registerConnectorPanel('X', 'BOTH', { defaults: () => ({}), render: () => {} });
    // @ts-expect-error buildForm is not on platform.ui (the DOM-toolkit subset)
    platform.ui.buildForm;
    // @ts-expect-error renamed away from platform.mirth to platform.oie
    platform.mirth;
}

void libraries;
void badUsage;
