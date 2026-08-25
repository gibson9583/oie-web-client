import { confirmDialog } from '@oie/web-ui';
import api, { uuid } from '@oie/web-api';

export function xstreamObject(el: Element): any {
    const out: any = {};
    for (const attr of [...el.attributes]) out[`@${attr.name}`] = attr.value;
    if (!el.children.length) {
        const text = el.textContent || '';
        // XStream leaves script/name/id values as strings even when their text
        // resembles a primitive. These are the only primitive leaves in the
        // code-template and code-template-library models.
        if (el.tagName === 'includeNewChannels' && text === 'true') return true;
        if (el.tagName === 'includeNewChannels' && text === 'false') return false;
        if (el.tagName === 'revision' && /^-?\d+$/.test(text)) return Number(text);
        return text;
    }
    for (const child of [...el.children]) {
        const value = xstreamObject(child);
        if (out[child.tagName] === undefined) out[child.tagName] = value;
        else if (Array.isArray(out[child.tagName])) out[child.tagName].push(value);
        else out[child.tagName] = [out[child.tagName], value];
    }
    return out;
}

export function codeTemplateFromXml(el: Element, version: string): any {
    const template = xstreamObject(el);
    if (!template.id) template.id = uuid();
    if (!template['@version']) template['@version'] = version;
    if (template.properties && !template.properties['@version']) template.properties['@version'] = version;
    return template;
}

function saveError(result: any): string {
    if (String(result?.librariesSuccess) !== 'true') {
        return result?.librariesCause?.detailMessage || 'The library set could not be saved';
    }
    let failure = '';
    const scan = (value: any) => {
        if (!value || failure) return;
        if (Array.isArray(value)) return value.forEach(scan);
        if (typeof value !== 'object') return;
        if (String(value.success) === 'false') failure = value.cause?.detailMessage || 'A code template could not be saved';
        else Object.values(value).forEach(scan);
    };
    scan(result.codeTemplateResults);
    return failure;
}

export async function bulkUpdateWithConflict(
    libraries: any[], templates: any[], removedLibraryIds: string[] = [], removedTemplateIds: string[] = []
): Promise<boolean> {
    let result = await api.codeTemplates.bulkUpdate(libraries, templates, removedLibraryIds, removedTemplateIds, false);
    if (String(result?.overrideNeeded) === 'true') {
        const overwrite = await confirmDialog('Code Templates Modified',
            'Code templates or libraries changed while the import was being prepared. Overwrite those changes?',
            { danger: true, okLabel: 'Overwrite' });
        if (!overwrite) return false;
        result = await api.codeTemplates.bulkUpdate(libraries, templates, removedLibraryIds, removedTemplateIds, true);
    }
    const failure = saveError(result);
    if (failure) throw new Error(failure);
    return true;
}
