import type { CodeTemplateType, Platform } from '../../core/platform.js';
import type { OieObject } from '../../core/wire-types.js';

export const BASIC_PROPERTIES_CLASS = 'com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties';
export const BUILTIN_TEMPLATE_TYPES = [
    { value: 'FUNCTION', label: 'Function' },
    { value: 'DRAG_AND_DROP_CODE', label: 'Drag-and-Drop Code Block' },
    { value: 'COMPILED_CODE', label: 'Compiled Code Block' }
];

type Providers = Map<string, CodeTemplateType>;
interface TemplateTypeDraft {
    properties: OieObject;
    contextSet: OieObject | undefined;
}
const builtin = (id: string) => BUILTIN_TEMPLATE_TYPES.find(type => type.value === id);

/** Resolve by serialized class first: a plugin's FUNCTION is not a JS editor. */
export function codeTemplateType(template: OieObject, providers: Providers) {
    const properties = template.properties;
    const propertiesClass = properties?.['@class'];
    if (properties && (!propertiesClass || propertiesClass === BASIC_PROPERTIES_CLASS)) {
        const type = builtin(properties.type || 'FUNCTION');
        if (type) return { id: type.value, label: type.label, provider: undefined, missing: false };
    }
    for (const [id, provider] of providers) {
        if (propertiesClass === provider.propertiesClass) return { id, label: provider.label, provider, missing: false };
    }
    return { id: `missing:${propertiesClass || properties?.type || 'properties'}`,
        label: 'Unavailable template type', provider: undefined, missing: true };
}

/** Switching classes creates complete properties without translating source.
 * Per-editor drafts make switching back lossless until selection
 * changes. Built-in switches preserve code because they share one model class. */
export function switchCodeTemplateType(template: OieObject, id: string, providers: Providers,
    version: string, drafts: Map<string, TemplateTypeDraft>): boolean {
    const current = codeTemplateType(template, providers);
    if (current.missing || current.id === id) return false;
    const selectedBuiltin = builtin(id);
    const provider = providers.get(id);
    if (!selectedBuiltin && !provider) return false;
    const currentKey = current.provider ? current.id : BASIC_PROPERTIES_CLASS;
    const nextKey = provider ? id : BASIC_PROPERTIES_CLASS;
    if (currentKey === nextKey) {
        template.properties.type = id;
        return true;
    }
    const draft = drafts.get(nextKey);
    let properties = draft?.properties;
    let contextSet = structuredClone(draft ? draft.contextSet : template.contextSet);
    if (!properties) {
        properties = provider ? provider.create({ version, template: structuredClone(template) }) : { code: '', type: id };
        if (!properties || typeof properties !== 'object' || Array.isArray(properties) || !builtin(properties.type)) {
            throw new Error('The template plugin must create properties with a supported engine template type');
        }
        properties = { ...properties, '@class': provider?.propertiesClass || BASIC_PROPERTIES_CLASS,
            '@version': properties['@version'] || version };
    }
    // Filter only a new type's initial contexts. Returning to a type restores
    // its own selections, including edits made before switching away.
    if (!draft && provider?.contexts) {
        const delegate = contextSet?.delegate?.contextType;
        const contexts = (Array.isArray(delegate) ? delegate : delegate ? [delegate] : []).map(String);
        contextSet = { delegate: { contextType: contexts.filter(context => provider.contexts!.includes(context)) } };
    }
    drafts.set(currentKey, { properties: template.properties, contextSet: structuredClone(template.contextSet) });
    if (selectedBuiltin) properties.type = id;
    template.properties = properties;
    template.contextSet = contextSet;
    return true;
}

/** Structural checks precede a provider's optional language validator. */
export function codeTemplateTypeError(template: OieObject, providers: Providers): string | null {
    const type = codeTemplateType(template, providers);
    if (type.missing) return 'The plugin for this template type is unavailable. Enable its web editor to validate this template.';
    if (!type.provider) return null;
    if (!builtin(template.properties?.type)) return 'The plugin properties must use an existing engine template type.';
    if (type.provider.contexts) {
        const raw = template.contextSet?.delegate?.contextType;
        const contexts = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(String);
        const unsupported = contexts.filter(context => !type.provider!.contexts!.includes(context));
        if (unsupported.length) return `This template type does not support these contexts: ${unsupported.join(', ')}. Clear these selections before saving.`;
    }
    return null;
}

/** Plugin schema validation runs before a write, while unavailable editor
 * providers still permit lossless imports handled by their engine plugin. */
export function codeTemplateSaveError(template: OieObject, providers: Providers, platform: Platform): string | null {
    const type = codeTemplateType(template, providers);
    if (!type.provider) return null;
    const structural = codeTemplateTypeError(template, providers);
    if (structural) return structural;
    if (!type.provider.validateSave) return null;
    const snapshot = structuredClone(template);
    const result = type.provider.validateSave({ template: snapshot, properties: snapshot.properties, platform });
    if (result !== null && typeof result !== 'string') return 'Plugin save validation must return an error string or null synchronously.';
    return result;
}
