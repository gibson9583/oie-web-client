/*
 * Type regression guard for @oie/web-api. Compiled (not run) by `npm run typecheck`.
 * Asserts the generated model types resolve and that wrong usage is rejected.
 * If a future `gen:schema` against the engine drops/renames a model, this fails.
 */
import api, { asList, ApiError } from '@oie/web-api';
import type { Channel, Connector, DashboardStatus, User, Message } from '@oie/web-api';

async function goodUsage() {
    // Generated model fields resolve. The engine's OpenAPI marks most fields
    // optional, so these are `T | undefined` — we assert the field exists and
    // carries the right element/base type, not that it's required.
    const ch: Channel = await api.channels.get('cid');
    const name: string | undefined = ch.name;
    const revision: number | undefined = ch.revision;
    const dests: Connector[] | undefined = ch.destinationConnectors;

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
}

void goodUsage;
void badUsage;
