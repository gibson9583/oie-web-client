/*
 * Type regression guard for @oie/web-shell — the plugin extension surface.
 */
import { platform } from '@oie/web-shell';
import type { Platform, PluginContext, EditorLanguageProvider, EditorLanguageDefinition } from '@oie/web-shell';
import { h } from '@oie/web-ui';

// A plugin's register(platform) entry point typed against the public contract.
export function register(p: Platform, context: PluginContext) {
    const definition: EditorLanguageDefinition = {
        configuration: { comments: { lineComment: '#' } },
        tokensProvider: { tokenizer: { root: [[/[a-z]+/, 'identifier']] } }
    };
    const provider: EditorLanguageProvider = {
        aliases: ['Example'], extensions: ['.example'],
        load: async () => {
            const text: string = await context.getAssetText('web/language.json');
            void text;
            return definition;
        }
    };
    p.registerEditorLanguage('example', provider);
    // Plugin glyph registration — the name is then valid anywhere an `icon` is accepted.
    p.registerIcon('demo-glyph', 'M5 20v-7a7 7 0 0 1 14 0v7');
    p.registerNavItem({ id: 'demo', label: 'Demo', icon: 'demo-glyph', path: '/demo', section: 'Engine', order: 9 });
    p.registerView('/demo', () => ({ el: h('div', 'hi') }), { title: 'Demo' });
    // API 4.9 availability predicates are synchronous and return a boolean.
    p.registerCommand({ id: 'demo-command', label: 'Demo', path: '/demo', visible: () => true });
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
    // API 4.10 template properties keep their custom serialized class while
    // using an existing engine execution behavior.
    p.registerCodeTemplateType('demo-function', {
        label: 'Demo Function', propertiesClass: 'com.example.DemoTemplateProperties',
        contexts: ['SOURCE_FILTER_TRANSFORMER'],
        create: ({ version, template }) => ({ '@version': version, type: 'FUNCTION', source: '', templateId: template.id }),
        component: ({ template, properties, readOnly, onChange, platform: host }) => {
            const locked: boolean = readOnly;
            void template; void properties; void locked; void onChange; void host;
            return null;
        },
        validate: async ({ properties, template, platform: host }) => {
            void template; void host;
            return properties.source ? null : 'Enter source';
        },
        validateSave: ({ properties }) => properties.type === 'FUNCTION' ? null : 'Function type required',
        getCompletionCode: ({ properties }) => properties.type === 'FUNCTION' ? 'function demo(value) {}' : null
    });
    p.codeTemplateTypes().get('demo-function')?.create({ version: '4.6.0', template: {} });
    // Per-message action: onInvoke gets the engine Message; ctx names the connector row.
    p.registerMessageAction({
        id: 'demo-msg', label: 'Demo Message Action', icon: 'demo-glyph', task: 'doDemoMessageAction',
        isEnabled: ({ metaDataId }) => metaDataId === 0,
        onInvoke: (message, { channelId, connectorMessage }) => { void message; void channelId; void connectorMessage; },
    });
    // Reference list entries: a new category or an existing one; type and contexts are optional.
    p.registerReferences('Demo Functions', [
        { name: 'Demo Call', description: 'Calls demo.', code: 'demo()', contexts: ['SOURCE_FILTER_TRANSFORMER'] },
        { name: 'Demo Fn', code: 'function demo(a) {}', type: 'FUNCTION' },
    ]);
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
    // Additional route prerequisites combine with the existing command task.
    const prerequisites = [['view', 'doShowChannel'], ['channel', 'doNewChannel']] as const;
    platform.registerCommand({ id: 'new-channel', label: 'New Channel', task: 'doNewChannel', rbac: 'channel',
        permissions: prerequisites, visible: () => true, path: '/channels/new/guided' });
}

function badUsage() {
    // @ts-expect-error language loaders must return a Monarch token definition
    platform.registerEditorLanguage('bad-language', { load: () => ({}) });
    // @ts-expect-error registration requires a lazy loader
    platform.registerEditorLanguage('bad-language', { tokensProvider: { tokenizer: {} } });
    // @ts-expect-error completion declarations must be available synchronously
    platform.registerCodeTemplateType('bad-completion', { label: 'Bad', propertiesClass: 'com.example.Bad', create: () => ({}), component: () => null, getCompletionCode: async () => 'function bad() {}' });
    // @ts-expect-error schema validation must be synchronous; use validate for async language checks
    platform.registerCodeTemplateType('bad-save', { label: 'Bad', propertiesClass: 'com.example.Bad', create: () => ({}), component: () => null, validateSave: async () => null });
    // @ts-expect-error custom types require an engine properties class
    platform.registerCodeTemplateType('bad', { label: 'Bad', create: () => ({}), component: () => null });
    // @ts-expect-error connector mode must be 'SOURCE' | 'DESTINATION'
    platform.registerConnectorPanel('X', 'BOTH', { defaults: () => ({}), component: () => null });
    // @ts-expect-error buildForm is not on platform.ui (the DOM-toolkit subset)
    platform.ui.buildForm;
    // @ts-expect-error renamed away from platform.mirth to platform.oie
    platform.mirth;
    // @ts-expect-error a channel tab requires `component` (the legacy imperative render path was removed)
    platform.registerChannelTab({ id: 'x', label: 'X' });
    // @ts-expect-error a reference type must be a CodeTemplateType name
    platform.registerReferences('X', [{ name: 'x', code: 'x', type: 'CODE' }]);
    // @ts-expect-error command visibility cannot be an async predicate
    platform.registerCommand({ id: 'bad-command', label: 'Bad', visible: async () => true });
    // @ts-expect-error a command prerequisite needs both group and task
    platform.registerCommand({ id: 'bad-task', label: 'Bad Task', permissions: [['view']] });
    // @ts-expect-error command prerequisite names are strings
    platform.registerCommand({ id: 'bad-task-type', label: 'Bad Task', permissions: [['view', 1]] });
}

void libraries;
void badUsage;
void taskGating;

// Settings saves may await an engine receipt; false keeps the editor open.
platform.registerSettingsPanel({
    id: 'async-save-contract', label: 'Async save',
    component: ({ setSave }) => {
        setSave(async () => true);
        setSave(() => false);
        setSave(null);
        return null;
    },
});
