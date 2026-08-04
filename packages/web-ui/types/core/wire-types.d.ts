import type { components } from './oie-schema';
/** Engine model schemas, generated from the OpenAPI spec. */
type Schemas = components['schemas'];
export type Channel = Schemas['Channel'];
export type Connector = Schemas['Connector'];
export type ChannelGroup = Schemas['ChannelGroup'];
export type ChannelStatistics = Schemas['ChannelStatistics'];
export type ChannelDependency = Schemas['ChannelDependency'];
export type ChannelTag = Schemas['ChannelTag'];
export type MetaDataColumn = Schemas['MetaDataColumn'];
export type DashboardStatus = Schemas['DashboardStatus'];
export type Message = Schemas['Message'];
export type Attachment = Schemas['Attachment'];
export type User = Schemas['User'];
export type AlertModel = Schemas['AlertModel'];
export type AlertStatus = Schemas['AlertStatus'];
export type CodeTemplate = Schemas['CodeTemplate'];
export type CodeTemplateLibrary = Schemas['CodeTemplateLibrary'];
export type ServerSettings = Schemas['ServerSettings'];
export type ServerConfiguration = Schemas['ServerConfiguration'];
export type ServerEvent = Schemas['ServerEvent'];
export type DriverInfo = Schemas['DriverInfo'];
export type Transformer = Schemas['Transformer'];
export type Filter = Schemas['Filter'];
export type Step = Schemas['Step'];
export type Rule = Schemas['Rule'];
/** The full generated schema set, for any model not aliased above. */
export type { components, paths, operations } from './oie-schema';
/** A loose engine object — fallback for dynamic/map payloads and XStream-quirk fields. */
export type OieObject = Record<string, any>;
/**
 * A field XStream produced from a Java collection, exactly as it reaches the
 * browser. ONE element arrives as a bare object, several as an array, none as
 * `''`, `null` or absent — so the JSON shape of the same field changes with how
 * many things are in it, and `.map()`/`[0]` on one is a latent crash that only
 * reproduces on single-element data.
 *
 * Deliberately NOT assignable to `T[]`: the compiler should send you through
 * `asList()`, or better the model helper for that field (`destinationsOf`,
 * `elementsToArray`, ...), rather than let you trust a shape that only holds
 * when the engine happened to return two or more.
 */
export type XStreamList<T> = T | T[] | '' | null | undefined;
/**
 * Filter rules and transformer steps as they arrive: NOT a list, but a map keyed
 * by the element's Java class name (`'com.mirth.connect.plugins.mapper.MapperStep'`),
 * whose value is a single element or an array of them, plus `@`-prefixed XStream
 * attributes to skip. Ordering lives in each element's `sequenceNumber`, not in
 * the object.
 *
 * The generated `Transformer.elements` says `Step[]`, which is the engine's clean
 * logical model and not what the browser receives. Read these with
 * `elementsToArray()` (which flattens, tags each with `__type`, and sorts by
 * sequenceNumber) and write them back with `arrayToElements()`.
 */
export type XStreamElements<T = OieObject> = {
    [javaClassName: string]: T | T[] | undefined;
};
/**
 * A Channel as it ACTUALLY arrives from the engine.
 *
 * The generated `Channel` describes the engine's clean logical model — what its
 * OpenAPI spec declares — but the wire is XStream's structural encoding of Java
 * objects, and the two differ at every collection. `Channel` says
 * `destinationConnectors: Connector[]`; the wire gives
 * `{ connector: Connector }` for a one-destination channel. `api.channels.get`
 * decodes base64 templates but does NOT reshape this, so the raw form is what
 * callers hold.
 *
 * Use `destinationsOf()` to read destinations and `elementsToArray()` for
 * filter/transformer elements (which are keyed by Java class name, not listed).
 */
export type WireChannel = Omit<Channel, 'sourceConnector' | 'destinationConnectors'> & {
    sourceConnector?: WireConnector;
    destinationConnectors?: {
        connector?: XStreamList<WireConnector>;
    } | XStreamList<WireConnector>;
};
/** A Transformer as it arrives: `elements` is a class-keyed map, not a `Step[]`. */
export type WireTransformer = Omit<Transformer, 'elements' | 'enabledElements'> & {
    elements?: XStreamElements<Step> | '' | null;
    enabledElements?: XStreamElements<Step> | '' | null;
};
/** A Filter as it arrives: `elements` is a class-keyed map, not a `Rule[]`. */
export type WireFilter = Omit<Filter, 'elements' | 'enabledElements'> & {
    elements?: XStreamElements<Rule> | '' | null;
    enabledElements?: XStreamElements<Rule> | '' | null;
};
/**
 * A Connector as it arrives. Its filter/transformer/responseTransformer carry
 * class-keyed element maps rather than the arrays the generated schema declares.
 */
export type WireConnector = Omit<Connector, 'transformer' | 'responseTransformer' | 'filter'> & {
    transformer?: WireTransformer;
    responseTransformer?: WireTransformer;
    filter?: WireFilter;
};
