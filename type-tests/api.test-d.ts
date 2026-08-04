/*
 * Type regression guard for @oie/web-api. Compiled (not run) by `npm run typecheck`.
 * Asserts the generated model types resolve and that wrong usage is rejected.
 * If a future `gen:schema` against the engine drops/renames a model, this fails.
 */
import api, { asList, destinationsOf, elementsToArray, ApiError } from '@oie/web-api';
import type { Channel, Connector, WireChannel, WireConnector, DashboardStatus, User, Message } from '@oie/web-api';

async function goodUsage() {
    // Generated model fields resolve. The engine's OpenAPI marks most fields
    // optional, so these are `T | undefined` — we assert the field exists and
    // carries the right element/base type, not that it's required.
    // channels.get returns the RAW wire shape, not the clean generated model —
    // see WireChannel. Scalars are unaffected and still resolve off the schema.
    const ch: WireChannel = await api.channels.get('cid');
    const name: string | undefined = ch.name;
    const revision: number | undefined = ch.revision;

    // Destinations come out of the model helper, which flattens whichever XStream
    // shape the engine produced. THIS is the supported way to read them.
    const dests: WireConnector[] = destinationsOf(ch);

    // Nested override: a destination's transformer carries a class-keyed element
    // map, so it flows through elementsToArray too — not through .map().
    const nested = elementsToArray(dests[0]?.transformer?.elements);
    void nested;

    // Filter/transformer elements are a class-name-keyed map on the wire, so they
    // go through the helper too; each result carries the synthesized __type.
    const steps = elementsToArray({ 'com.mirth.connect.plugins.mapper.MapperStep': { sequenceNumber: '0' } });
    const stepType: string = steps[0]!.__type;
    void stepType;

    // A clean Channel is still what you build for a write; both are accepted.
    const clean: Channel = { name: 'x' };
    await api.channels.create(clean);

    const statuses: DashboardStatus[] = await api.status.list();
    const channelId: string | undefined = statuses[0]?.channelId;

    const users: User[] = await api.users.list();
    const username: string | undefined = users[0]?.username;

    const msgs: Message[] = await api.messages.search('cid', { limit: 10 });

    // Helpers + error class.
    const list: string[] = asList<string>(ch, 'string');
    const err = new ApiError(500, 'boom');
    const status: number = err.status;

    return [name, revision, dests, channelId, username, msgs, list, status];
}

async function badUsage() {
    const ch = await api.channels.get('cid');
    // @ts-expect-error not a field on the generated Channel schema
    ch.totallyNotAField;
    // @ts-expect-error channelId must be a string, not a number
    await api.channels.get(123);
    // @ts-expect-error no such method on the channels API
    await api.channels.nope();

    // The whole point of WireChannel: a one-destination channel arrives as a bare
    // object, so treating the field as an array is a latent crash. Reading it as
    // Connector[] must not compile — go through destinationsOf() instead.
    // @ts-expect-error destinationConnectors is the raw XStream shape, not Connector[]
    const wrong: Connector[] | undefined = ch.destinationConnectors;
    void wrong;

    // Nor may you iterate it directly.
    // @ts-expect-error .map() is not available on a single-or-list XStream field
    ch.destinationConnectors?.map((c) => c);
}

void goodUsage;
void badUsage;
