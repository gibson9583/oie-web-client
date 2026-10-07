/** What the highlighter can render (auto-detected when not told). */
export type ContentKind = 'xml' | 'json' | 'hl7v2' | 'text';
/** HL7 nodeName → field-name map from the engine's serializer sidecar. */
export type Hl7Descriptions = Record<string, string>;
export declare function normalizeLineEndings(s: unknown): string;
export declare function detectType(text: unknown, dataType?: string | null): ContentKind;
export declare function prettyPrintXml(xml: string): string;
export declare function prettyPrintJson(json: string): string;
/** Delimiters in wire order; headers can change them within a batch. */
export declare function hl7Encoding(line: string, previous?: string): string;
export interface Hl7Token {
    startIndex: number;
    scopes: string;
    field?: string;
}
/** Shared, lossless line tokenizer for the message browser and Monaco. */
export declare function tokenizeHl7Line(line: string, encoding?: string): Hl7Token[];
export declare function hl7FieldName(field: string, descriptions?: Hl7Descriptions | null): string | undefined;
export declare function hl7Tooltip(field: string, descriptions?: Hl7Descriptions | null): string;
/**
 * Highlight `text` into the given <pre> element (cleared first).
 *   type        'xml' | 'json' | 'hl7v2' | 'text' (default: auto-detect)
 *   format      pretty-print XML/JSON before highlighting
 *   descriptions HL7 nodeName → field-name map from the sidecar (optional)
 */
export declare function renderHighlighted(preEl: HTMLElement, text: unknown, { type, dataType, format, descriptions }?: {
    type?: ContentKind;
    dataType?: string | null;
    format?: boolean;
    descriptions?: Hl7Descriptions | null;
}): ContentKind;
