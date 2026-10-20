/* Engine extensions the operator disabled (GET /extensions/disabled), read once
   per plugin load like the Swing Administrator reads them at login. Bundled web
   plugins, connector types, and built-in step/rule types for these names stay
   hidden. Engine-served plugin UIs are already filtered by the Web Support
   plugin. */

import * as api from './api.js';

/* Built-in step/rule classes bundled in transformer-steps, by engine extension name. */
const ELEMENT_EXTENSIONS: Record<string, string> = {
    'com.mirth.connect.plugins.javascriptstep.JavaScriptStep': 'JavaScript Transformer Step',
    'com.mirth.connect.plugins.mapper.MapperStep': 'Mapper Transformer Step',
    'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep': 'Message Builder Transformer Step',
    'com.mirth.connect.plugins.xsltstep.XsltStep': 'XSLT Transformer Step',
    'com.mirth.connect.plugins.destinationsetfilter.DestinationSetFilterStep': 'Destination Set Filter Step',
    'com.mirth.connect.plugins.scriptfilestep.ExternalScriptStep': 'External Script Transformer Step',
    'com.mirth.connect.plugins.javascriptrule.JavaScriptRule': 'JavaScript Filter Rule',
    'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule': 'Rule Builder Filter Rule',
    'com.mirth.connect.plugins.scriptfilerule.ExternalScriptRule': 'External Script Filter Step'
};

let disabled = new Set<string>();

export async function loadDisabledExtensions(): Promise<void> {
    try {
        const names = api.asList<string>(await api.get('/extensions/disabled', undefined, { noAuthHandler: true }), 'string');
        disabled = new Set(names.filter(name => typeof name === 'string'));
    } catch (e) {
        console.warn('[plugins] disabled extensions unavailable:', e);
        disabled = new Set();
    }
}

export function isExtensionDisabled(name: string | null | undefined): boolean {
    return !!name && disabled.has(name);
}

/** True when every named extension is disabled (a bundled plugin with no names is never disabled). */
export function allExtensionsDisabled(names: unknown): boolean {
    return Array.isArray(names) && names.length > 0 && names.every(name => isExtensionDisabled(String(name)));
}

export function isElementTypeDisabled(type: string): boolean {
    return isExtensionDisabled(ELEMENT_EXTENSIONS[type]);
}
