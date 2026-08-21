/* Swing code-template XML exports must be converted to the JSON shape consumed
   by the engine's multipart _bulkUpdate endpoint. Keep this conversion shared:
   direct code-template imports and libraries bundled with channels must use the
   same version stamping and attribute ordering. */

import { uuid } from '@oie/web-api';

export function xmlToJson(el: any): any {
    const obj: any = {};
    for (const attr of el.attributes) obj['@' + attr.name] = attr.value;
    if (!el.children.length) {
        const text = el.textContent || '';
        if (!Object.keys(obj).length) return text;
        if (text) obj.$ = text;
        return obj;
    }
    for (const child of el.children) {
        const value = xmlToJson(child);
        if (Object.prototype.hasOwnProperty.call(obj, child.tagName)) {
            if (!Array.isArray(obj[child.tagName])) obj[child.tagName] = [obj[child.tagName]];
            obj[child.tagName].push(value);
        } else {
            obj[child.tagName] = value;
        }
    }
    return obj;
}

export function templateFromXml(el: any, version: any) {
    const template: any = xmlToJson(el);
    if (!template.id) template.id = uuid();
    if (template.properties && typeof template.properties === 'object' && !template.properties['@version']) {
        template.properties = { '@version': version, ...template.properties };
    }
    return { '@version': template['@version'] || version, ...template };
}
