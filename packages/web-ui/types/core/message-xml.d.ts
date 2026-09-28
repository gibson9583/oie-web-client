import type { Message } from './wire-types.js';
/** Shield XStream's XML-forbidden character references for DOMParser. Literal
    marker characters (including numeric references to them) are escaped first,
    and restoration is one pass, so literal entity spellings and payloads that
    resemble our markers cannot be mistaken for encoded control characters. */
export declare function protectMessageXml(text: string): {
    xml: string;
    restore: (value: string) => string;
};
/** Also used for serialized Response and Sent-property envelopes inside a
    content stage. Restore text only after the browser has validated the XML. */
export declare function parseMessageDocument(text: string): XMLDocument;
export declare function parseMessageXml(text: string): Message;
