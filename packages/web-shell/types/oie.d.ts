import type { OieObject, WireChannel, WireConnector, XStreamElements } from './wire-types.js';
/** A polymorphic filter rule / transformer step, tagged with its Java `__type`. */
export interface Element {
    __type: string;
    [key: string]: any;
}
export declare function uuid(): string;
/**
 * Flatten a class-keyed element map into an ordered array, tagging each entry
 * with `__type` (its Java class) and sorting by `sequenceNumber`. Accepts `''`
 * because that is what an EMPTY collection looks like on the wire.
 */
export declare function elementsToArray(elements: XStreamElements | OieObject | '' | null | undefined): Element[];
export declare function arrayToElements(items: Element[]): OieObject | null;
export declare const CHANNEL_STATES: string[];
export declare function statePip(state: string): 'ok' | 'warn' | 'err' | 'busy' | '';
export declare function stateLabel(state: string | null | undefined): string;
export declare const MESSAGE_STATUSES: string[];
export declare function messageStatusTag(status: string): 'accent' | 'red' | 'blue' | 'amber' | '';
export declare const STEP_TYPES: Record<string, {
    label: string;
}>;
export declare const RULE_TYPES: Record<string, {
    label: string;
}>;
export declare function elementTypeLabel(type: string): string;
export declare function emptyTransformer(version: string): OieObject;
export declare function emptyFilter(version: string): OieObject;
export declare function defaultSourceConnector(version: string): OieObject;
export declare function defaultDestinationConnector(version: string, metaDataId?: number, name?: string): OieObject;
export declare function newChannel(name: string, version: string): OieObject;
/**
 * The destination connectors of a channel, flattened out of whichever XStream
 * shape the engine produced (`{connector: X}`, `{connector: [X]}`, a bare
 * connector, or absent). Always use this instead of reading the field.
 */
export declare function destinationsOf(channel: WireChannel | OieObject | null | undefined): WireConnector[];
export declare function setDestinations(channel: OieObject, destinations: OieObject[]): void;
/** Decode the base64-wrapped template fields of every transformer to plain text. */
export declare function decodeChannelTemplates<T>(channel: T): T;
/** Re-encode plain-text template fields to the engine's base64 wrapper form. */
export declare function encodeChannelTemplates<T>(channel: T): T;
export declare function validateChannel(channel: OieObject | null | undefined): string[];
