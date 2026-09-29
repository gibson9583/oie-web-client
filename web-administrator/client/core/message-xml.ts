/* Message bodies cannot use the engine's XML-to-JSON bridge: XStream writes
   NCPDP delimiters as numeric character references that XML 1.0 rejects.
   Parse its XML directly, preserving Java String values rather than guessing
   their type from their contents. Keep the same singleton/repeated-child and
   @attribute/$text shape consumed by the existing message/map viewers. */
import type { Message } from './wire-types.js';
import { t as translate } from './i18n.js';

type Value = string | number | boolean | ObjectValue;
interface ObjectValue { [key: string]: Value | Value[] }

/** Shield XStream's XML-forbidden character references for DOMParser. Literal
    marker characters (including numeric references to them) are escaped first,
    and restoration is one pass, so literal entity spellings and payloads that
    resemble our markers cannot be mistaken for encoded control characters. */
export function protectMessageXml(text: string): { xml: string; restore: (value: string) => string } {
    const marker = '\uE000';
    const values: string[] = [];
    const xml = text.replaceAll(marker, marker + marker).replace(
        /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE\b|&#(?:x[\da-fA-F]+|\d+);/g,
        token => {
            if (token === '<!DOCTYPE') throw new Error(translate('Engine returned invalid message XML'));
            // Entity references are literal text inside CDATA/comments/PIs.
            if (!token.startsWith('&#')) return token;
            const code = token[2] === 'x' ? parseInt(token.slice(3, -1), 16) : Number(token.slice(2, -1));
            if (code === 0xE000) return marker + marker;
            if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 0xFFFE || code === 0xFFFF) {
                values.push(String.fromCodePoint(code));
                return `${marker}${values.length - 1};`;
            }
            return token; // DOMParser still validates ordinary/invalid references.
        }
    );
    return { xml, restore: value => value.replace(/\uE000(?:\uE000|(\d+);)/g,
        (_token, index: string | undefined) => index === undefined ? marker : values[Number(index)]) };
}

const CONTENT_FIELDS = new Set(['raw', 'processedRaw', 'transformed', 'encoded', 'sent', 'response', 'responseTransformed',
    'processedResponse', 'sourceMapContent', 'connectorMapContent', 'channelMapContent', 'responseMapContent',
    'processingErrorContent', 'postProcessorErrorContent', 'responseErrorContent']);
const MESSAGE_NUMBERS = new Set(['messageId', 'originalId', 'importId']);
const CONNECTOR_NUMBERS = new Set(['messageId', 'metaDataId', 'errorCode', 'sendAttempts', 'chainId', 'orderId']);
const NUMBER_TYPES = new Set(['byte', 'short', 'int', 'long', 'float', 'double']);
const COLLECTION_TYPES = new Set(['list', 'array-list', 'linked-list', 'set', 'hash-set', 'linked-hash-set', 'sorted-set']);

function scalar(node: Element, text: string): string | number | boolean {
    const tag = node.tagName;
    const parent = node.parentElement;
    const parentTag = parent?.tagName;
    const modelContent = parentTag && CONTENT_FIELDS.has(parentTag) && parent?.parentElement?.tagName === 'connectorMessage';
    // XStream names map/list items by their Java type. An arbitrary object's
    // field named int/boolean is not enough evidence to reinterpret its text.
    const typedItem = parentTag === 'entry' || !!parentTag && (COLLECTION_TYPES.has(parentTag) || parentTag.endsWith('-array'))
        || COLLECTION_TYPES.has(parent?.getAttribute('class') || '');
    if (((tag === 'boolean' && typedItem) || (tag === 'processed' && parentTag === 'message') || (tag === 'encrypted' && modelContent))
        && (text === 'true' || text === 'false')) return text === 'true';
    const numeric = (NUMBER_TYPES.has(tag) && typedItem)
        || (parentTag === 'message' && MESSAGE_NUMBERS.has(tag))
        || (parentTag === 'connectorMessage' && CONNECTOR_NUMBERS.has(tag))
        || (modelContent && (tag === 'messageId' || tag === 'metaDataId'));
    // Keep large Java long values exact. Java Strings (content, map keys/values,
    // connector names, unknown metadata) are never inferred from their text.
    if (numeric && /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text)) {
        const value = Number(text);
        if (Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return value;
    }
    return text;
}

/** Also used for serialized Response and Sent-property envelopes inside a
    content stage. Restore text only after the browser has validated the XML. */
export function parseMessageDocument(text: string): XMLDocument {
    const { xml, restore } = protectMessageXml(text);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const root = doc.documentElement;
    // Firefox replaces the root; Chromium/WebKit can retain a partial root
    // with an XHTML error child. A plain metadata field named parsererror is data.
    if (doc.doctype || !root || root.tagName === 'parsererror'
        || doc.getElementsByTagNameNS('http://www.mozilla.org/newlayout/xml/parsererror.xml', 'parsererror').length
        || doc.getElementsByTagNameNS('http://www.w3.org/1999/xhtml', 'parsererror').length) {
        throw new Error(translate('Engine returned invalid message XML'));
    }
    const walk = (node: Element) => {
        for (const attribute of node.attributes) attribute.value = restore(attribute.value);
        for (const child of node.childNodes) {
            if (child.nodeType === 1) walk(child as Element);
            else if (child.nodeType === 3 || child.nodeType === 4) child.nodeValue = restore(child.nodeValue || '');
        }
    };
    walk(root);
    return doc;
}

export function parseMessageXml(text: string): Message {
    const root = parseMessageDocument(text).documentElement;
    if (root.tagName !== 'message') throw new Error(translate('Engine returned invalid message XML'));
    const read = (node: Element): Value => {
        // A null prototype keeps arbitrary engine map/metadata names, including
        // __proto__ and constructor, as data without invoking object setters.
        const result: ObjectValue = Object.create(null);
        for (const attribute of node.attributes) result['@' + attribute.name] = attribute.value;
        for (const child of node.children) {
            const key = child.tagName;
            const value = read(child);
            if (!Object.hasOwn(result, key)) result[key] = value;
            else if (Array.isArray(result[key])) (result[key] as Value[]).push(value);
            else result[key] = [result[key] as Value, value];
        }
        const text = Array.from(node.childNodes)
            .filter(child => child.nodeType === 3 || child.nodeType === 4)
            .map(child => child.textContent || '').join('');
        if (!node.children.length && !node.attributes.length) return scalar(node, text);
        if (text && (!node.children.length || text.trim())) result.$ = text;
        return result;
    };
    const result = read(root);
    if (!result || typeof result !== 'object') throw new Error(translate('Engine returned invalid message XML'));
    return result as Message;
}
