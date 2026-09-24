import { xstreamObject } from './code-template-bulk.js';

type Model = Record<string, any>;
type ImportKind = 'library' | 'template';

export interface LibraryImportCallbacks {
    resolveConflict(kind: ImportKind, name: string): Promise<'overwrite' | 'copy' | 'skip' | null>;
    rename(kind: ImportKind, name: string): Promise<string | null>;
    /** Cache these keys for retries of the same file after a partial save. */
    newId(key: string): string;
}

function list(value: any, key: string): any[] {
    if (Array.isArray(value)) return value;
    const items = value?.[key];
    return items == null || items === '' ? [] : Array.isArray(items) ? items : [items];
}

function templates(library: Model): Model[] {
    return list(library.codeTemplates, 'codeTemplate');
}

function fullTemplates(library: Model): Model[] {
    // Swing removes skeleton entries when properties are absent. An ID/name/
    // revision alone is still a skeleton, not a template to overwrite.
    return templates(library).filter(template => template?.properties && typeof template.properties === 'object');
}

function idOf(model: Model): string {
    if (model.id == null || model.id === '') return '';
    if (typeof model.id !== 'string' || !model.id.trim()) throw new Error('Invalid code template or library ID');
    return model.id;
}

function validateImported(libraries: Model[]): void {
    const libraryIds = new Set<string>();
    const templateIds = new Set<string>();
    for (const library of libraries) {
        const id = idOf(library);
        if (id && libraryIds.has(id)) throw new Error(`Duplicate library ID in import: ${id}`);
        if (id) libraryIds.add(id);
        for (const template of fullTemplates(library)) {
            const templateId = idOf(template);
            if (templateId && templateIds.has(templateId)) throw new Error(`Duplicate code template ID in import: ${templateId}`);
            if (templateId) templateIds.add(templateId);
        }
    }
}

/** Read Swing single-library and list exports without coercing script/name/ID text. */
export function parseLibraryImport(xml: string, version: string): Model[] {
    const doc = new DOMParser().parseFromString(xml.trim(), 'text/xml');
    if (doc.querySelector('parsererror')) throw new Error('Not a valid XML file');
    const root = doc.documentElement;
    if (root.tagName !== 'codeTemplateLibrary' && root.tagName !== 'list') {
        throw new Error('Expected a <codeTemplateLibrary> or a <list> of libraries');
    }
    const elements = root.tagName === 'codeTemplateLibrary'
        ? [root] : [...root.children].filter(child => child.tagName === 'codeTemplateLibrary');
    if (!elements.length) throw new Error('No code template libraries found');
    const libraries = elements.map(element => {
        const library = xstreamObject(element);
        if (!library || typeof library !== 'object') throw new Error('Invalid code template library');
        library['@version'] ||= version;
        const container = [...element.children].find(child => child.tagName === 'codeTemplates');
        const imported: Model[] = [];
        for (const child of [...(container?.children || [])]) {
            if (child.tagName !== 'codeTemplate') continue;
            const properties = [...child.children].find(field => field.tagName === 'properties');
            if (!properties) continue;
            const template = xstreamObject(child);
            template['@version'] ||= version;
            if (!template.properties || typeof template.properties !== 'object') {
                template.properties = Object.fromEntries([...properties.attributes].map(attr => [`@${attr.name}`, attr.value]));
            }
            template.properties['@version'] ||= version;
            imported.push(template);
        }
        library.codeTemplates = imported.length ? { codeTemplate: imported } : null;
        return library;
    });
    validateImported(libraries);
    return libraries;
}

/** Individual Swing template exports use either one template or a list. */
export function parseTemplateImport(xml: string, version: string): Model[] {
    const doc = new DOMParser().parseFromString(xml.trim(), 'text/xml');
    if (doc.querySelector('parsererror')) throw new Error('Not a valid XML file');
    const root = doc.documentElement;
    if (root.tagName !== 'codeTemplate' && root.tagName !== 'list') {
        throw new Error('Expected a <codeTemplate> or a <list> of code templates');
    }
    const elements = root.tagName === 'codeTemplate' ? [root]
        : [...root.children].filter(child => child.tagName === 'codeTemplate');
    // Reuse the full-template parser, including its skeleton and ID validation.
    const library = doc.createElement('codeTemplateLibrary');
    const container = doc.createElement('codeTemplates');
    for (const element of elements) container.appendChild(element.cloneNode(true));
    library.appendChild(container);
    const imported = fullTemplates(parseLibraryImport(new XMLSerializer().serializeToString(library), version)[0]);
    if (!imported.length) throw new Error('No code templates found in the file');
    return imported;
}

/** Add unassigned templates to a chosen existing library without changing its settings. */
export async function prepareTemplateImport(
    currentLibraries: Model[], importedTemplates: Model[], targetId: string, version: string, callbacks: LibraryImportCallbacks
): Promise<{ libraries: Model[]; templates: Model[] } | null> {
    const target = currentLibraries.find(library => library.id === targetId);
    if (!target) throw new Error('The selected library no longer exists. Refresh and select a library before importing.');
    return prepareLibraryImport(currentLibraries, [{ ...target, name: String(target.name ?? ''), codeTemplates: { codeTemplate: importedTemplates } }], version, {
        ...callbacks,
        resolveConflict: (kind, name) => kind === 'library' ? Promise.resolve('overwrite') : callbacks.resolveConflict(kind, name)
    });
}

function setIds(value: any): string[] {
    return list(value, 'string').map(String);
}

function mergeChannelSets(library: Model, previous?: Model): void {
    const enabled = new Set([...setIds(library.enabledChannelIds), ...setIds(previous?.enabledChannelIds)]);
    const disabled = new Set([...setIds(library.disabledChannelIds), ...setIds(previous?.disabledChannelIds)]);
    for (const id of enabled) disabled.delete(id);
    // Emit empty XML sets consistently with the editor's other writes.
    library.enabledChannelIds = enabled.size ? { string: [...enabled] } : '';
    library.disabledChannelIds = disabled.size ? { string: [...disabled] } : '';
}

/**
 * Swing's import operation starts with all current libraries, adds imports and
 * merges explicit overwrites. It never derives removals from the export file.
 * The baseline must include full templates for revision and name checks.
 */
export async function prepareLibraryImport(
    currentLibraries: Model[], importedLibraries: Model[], version: string, callbacks: LibraryImportCallbacks
): Promise<{ libraries: Model[]; templates: Model[] } | null> {
    validateImported(importedLibraries);
    const current = structuredClone(currentLibraries);
    const imports = structuredClone(importedLibraries);
    const libraries = new Map<string, Model>();
    const owners = new Map<string, string>();
    const knownTemplates = new Map<string, Model>();
    const pendingTemplates = new Map<string, Model>();
    for (const library of current) {
        const id = idOf(library);
        if (!id || libraries.has(id)) throw new Error('Current libraries have missing or duplicate IDs; refresh before importing');
        libraries.set(id, library);
        for (const template of templates(library)) {
            const templateId = idOf(template);
            if (!templateId) throw new Error('A current code template is missing its ID; refresh before importing');
            if (owners.has(templateId) && owners.get(templateId) !== id) {
                throw new Error(`Code template ${templateId} belongs to multiple libraries; resolve this before importing`);
            }
            owners.set(templateId, id);
            knownTemplates.set(templateId, template);
        }
    }

    async function uniqueName(kind: ImportKind, proposed: any, occupied: (name: string) => boolean): Promise<string | null> {
        let name = typeof proposed === 'string' ? proposed : '';
        while (!name.trim() || occupied(name.toLowerCase())) {
            const renamed = await callbacks.rename(kind, name);
            if (renamed === null) return null;
            name = renamed.trim();
        }
        return name;
    }

    function generatedId(key: string): string {
        const id = callbacks.newId(key);
        if (typeof id !== 'string' || !id.trim()) throw new Error('Could not generate an import ID');
        return id;
    }

    async function resolvePersistedCopy(
        kind: ImportKind, initialId: string, key: string, exists: (id: string) => Model | undefined
    ): Promise<string | null | false> {
        let id = initialId;
        let extraCopy = 0;
        let previous: Model | undefined;
        while ((previous = exists(id))) {
            // A previous request may have partially saved this generated ID.
            // Ask again before replacing it: someone may have edited it since.
            const choice = await callbacks.resolveConflict(kind, previous.name || id);
            if (choice === null) return null;
            if (choice === 'skip') return false;
            if (choice === 'overwrite') return id;
            id = generatedId(`${key}:copy:${++extraCopy}`);
        }
        return id;
    }

    let includedLibraries = 0;
    for (const [libraryIndex, importedLibrary] of imports.entries()) {
        const sourceId = idOf(importedLibrary);
        const matchingLibrary = sourceId ? libraries.get(sourceId) : undefined;
        let targetId = sourceId;
        let libraryKey: string | undefined;
        if (matchingLibrary) {
            const choice = await callbacks.resolveConflict('library', importedLibrary.name || matchingLibrary.name || sourceId);
            if (choice === null) return null;
            if (choice === 'skip') continue;
            if (choice === 'copy') libraryKey = `library:${libraryIndex}:${sourceId}`;
        }
        if (!targetId) libraryKey = `library:${libraryIndex}:new`;
        if (libraryKey) {
            const resolved = await resolvePersistedCopy('library', generatedId(libraryKey), libraryKey, id => libraries.get(id));
            if (resolved === null) return null;
            if (resolved === false) continue;
            targetId = resolved;
        }
        const previous = libraries.get(targetId);
        const name = await uniqueName('library', importedLibrary.name, candidate => [...libraries].some(
            ([id, library]) => id !== targetId && String(library.name ?? '').toLowerCase() === candidate
        ));
        if (name === null) return null;
        const library: Model = { ...previous, ...importedLibrary, id: targetId, name,
            revision: previous?.revision ?? 0, '@version': importedLibrary['@version'] || version };
        mergeChannelSets(library, previous);
        const references = new Map<string, Model>(templates(previous || {}).map(template => [idOf(template), template]));

        for (const [templateIndex, importedTemplate] of fullTemplates(importedLibrary).entries()) {
            const originalId = idOf(importedTemplate);
            const matchingTemplate = originalId ? knownTemplates.get(originalId) : undefined;
            let templateId = originalId;
            let templateKey: string | undefined;
            if (matchingTemplate) {
                if (owners.get(originalId) === targetId) {
                    const choice = await callbacks.resolveConflict('template', importedTemplate.name || matchingTemplate.name || originalId);
                    if (choice === null) return null;
                    if (choice === 'skip') continue;
                    if (choice === 'copy') templateKey = `template:${libraryIndex}:${targetId}:${templateIndex}:${originalId}`;
                } else {
                    // Swing only allows overwriting in the original owner. An
                    // imported library cannot steal a template from another.
                    templateKey = `template:${libraryIndex}:${targetId}:${templateIndex}:${originalId}`;
                }
            }
            if (!templateId) templateKey = `template:${libraryIndex}:${targetId}:${templateIndex}:new`;
            if (templateKey) {
                const resolved = await resolvePersistedCopy('template', generatedId(templateKey), templateKey, id => {
                    const previous = knownTemplates.get(id);
                    if (previous && owners.get(id) !== targetId) {
                        throw new Error('Generated code template ID is already in use in another library');
                    }
                    return previous;
                });
                if (resolved === null) return null;
                if (resolved === false) continue;
                templateId = resolved;
            }
            const previousTemplate = knownTemplates.get(templateId);
            if (previousTemplate && owners.get(templateId) !== targetId) {
                throw new Error('Generated code template ID is already in use in another library');
            }
            const templateName = await uniqueName('template', importedTemplate.name, candidate => [...references].some(
                ([id, template]) => id !== templateId && String(template.name ?? '').toLowerCase() === candidate
            ));
            if (templateName === null) return null;
            const template: Model = { ...importedTemplate, id: templateId, name: templateName,
                revision: previousTemplate?.revision ?? 0, '@version': importedTemplate['@version'] || version };
            template.properties['@version'] ||= version;
            references.set(templateId, template);
            knownTemplates.set(templateId, template);
            owners.set(templateId, targetId);
            pendingTemplates.set(templateId, template);
        }
        // Keep full entries internally so subsequent imports still see names.
        library.codeTemplates = references.size ? { codeTemplate: [...references.values()] } : null;
        libraries.set(targetId, library);
        includedLibraries++;
    }

    if (!includedLibraries) return null;
    return {
        libraries: [...libraries.values()].map(library => ({
            ...library,
            '@version': library['@version'] || version,
            codeTemplates: templates(library).length ? { codeTemplate: templates(library).map(template => ({
                '@version': template['@version'] || version, id: idOf(template)
            })) } : null
        })),
        templates: [...pendingTemplates.values()]
    };
}
