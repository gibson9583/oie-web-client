/* Unit tests for the Compare Messages selection state machine (core/compare.js):
   every transition in the spec, the identical-tuple guard, the stored-stage
   helper, and the session-end resets that keep PHI off an unattended screen. */
import api, { resetSessionExpired } from './api.js';
import { emit, on } from './store.js';
import {
    selectForCompare, proposeCompare, confirmCompare, cancelPending, clearCompare,
    getAnchor, getPending, samePair, sameMessage, describeRef, storedContentTypes, stageLabel, stageKey,
    refFromConnectorMessage
} from './compare.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.error('  FAIL -', label); } };

const ref = (over = {}) => ({
    channelId: 'c1', channelName: 'Orders In', messageId: 41207, metaDataId: 0, connectorName: 'Source',
    contentType: 'RAW', storedTypes: ['RAW', 'TRANSFORMED', 'ENCODED'], ...over
});

/* ---- stage tables ---- */

ok(stageLabel('PROCESSED_RAW') === 'Processed Raw', 'stageLabel maps to the Swing tab label');
ok(stageKey('PROCESSED_RAW') === 'processedRaw', 'stageKey maps to the ConnectorMessage field');

/* ---- stored stages come from the message, not the channel config ---- */

const sourceCm = {
    metaDataId: 0,
    raw: { content: 'MSH|^~\\&|' },
    processedRaw: { content: '' },        // present but empty = not stored
    transformed: { content: '<x/>' },
    encoded: { content: '<x/>' },
    sent: { content: 'should be ignored on a source' }
};
ok(String(storedContentTypes(sourceCm)) === 'RAW,TRANSFORMED,ENCODED', 'only stages with content, and never SENT on the source');

const destCm = { metaDataId: 1, encoded: { content: '<x/>' }, sent: { content: 'props' }, response: { content: 'r' } };
ok(String(storedContentTypes(destCm)) === 'ENCODED,SENT,RESPONSE', 'a destination offers Sent and Response');
ok(storedContentTypes(null).length === 0, 'no connector message → no stages');
ok(storedContentTypes({ metaDataId: 1 }).length === 0, 'a connector message with no content → no stages');

/* ---- building a reference from a loaded connector message ---- */

const built = refFromConnectorMessage({ id: 'c1', name: 'Orders In' }, '41207', {
    metaDataId: 0, connectorName: 'Source',
    raw: { content: 'MSH|', dataType: 'HL7V2' },
    encoded: { content: '<x/>', dataType: 'XML' }
}, 'RAW');
ok(built.messageId === 41207 && typeof built.messageId === 'number', 'the message id is numeric');
ok(built.channelId === 'c1' && built.metaDataId === 0, 'the coordinates carry over');
ok(built.channelName === 'Orders In', 'the channel name is captured for display');
ok(String(built.storedTypes) === 'RAW,ENCODED', 'stored stages come from the connector message');
ok(built.dataTypes.RAW === 'HL7V2' && built.dataTypes.ENCODED === 'XML', 'per-stage data types are captured as a language hint');
ok(!JSON.stringify(built).includes('MSH|'), 'a reference carries no content');

const unnamed = refFromConnectorMessage({ id: 'c1' }, 1, { metaDataId: 2, encoded: { content: 'x' } }, 'ENCODED');
ok(unnamed.connectorName === 'Connector 2', 'an unnamed destination falls back to its id');
ok(unnamed.channelName === undefined, 'no channel name is captured when none was given');

/* ---- identical-tuple comparison ---- */

ok(samePair(ref(), ref()) === true, 'same channel/message/connector/stage is the same content');
ok(samePair(ref(), ref({ contentType: 'ENCODED' })) === false, 'a different stage is different content');
ok(samePair(ref(), ref({ metaDataId: 1 })) === false, 'a different connector is different content');
ok(samePair(ref(), ref({ messageId: 41208 })) === false, 'a different message is different content');
ok(samePair(ref(), null) === false, 'nothing compares equal to no ref');
// Message ids are a PER-CHANNEL sequence, so the channel is part of identity.
ok(samePair(ref(), ref({ channelId: 'c2', channelName: 'Orders Out' })) === false, 'the same id in another channel is different content');

ok(sameMessage(ref(), ref({ contentType: 'ENCODED' })) === true, 'two stages of one message are the same message');
ok(sameMessage(ref(), ref({ metaDataId: 1 })) === true, 'two connectors of one message are the same message');
ok(sameMessage(ref(), ref({ messageId: 41208 })) === false, 'a different message is not');
ok(sameMessage(ref(), ref({ channelId: 'c2' })) === false, 'message 41207 of another channel is NOT the same message');
ok(sameMessage(ref(), null) === false, 'nothing is the same message as no ref');

ok(describeRef(ref()) === 'Orders In · Msg 41207 · Source · Raw', 'describeRef leads with the channel, and renders the reference only');
ok(describeRef(ref({ channelName: undefined })) === 'c1 · Msg 41207 · Source · Raw', 'describeRef falls back to the channel id');
ok(describeRef(null) === '', 'describeRef of nothing is empty');

/* ---- the state machine ---- */

let events = 0;
const offChanged = on('compare:changed', () => { events++; });

clearCompare();
events = 0;
ok(getAnchor() === null && getPending() === null, 'IDLE: no anchor, no pending');
ok(proposeCompare(ref()) === 'none', 'proposing with no anchor is rejected');

selectForCompare(ref());
ok(getAnchor().messageId === 41207 && getPending() === null, 'ANCHORED: anchor set, pending clear');
ok(events === 1, 'selecting emits compare:changed');

// Identical tuple: rejected outright, and it must not stage a pending candidate.
ok(proposeCompare(ref()) === 'same', 'the identical tuple is refused');
ok(getPending() === null, 'a refused candidate is not staged');

const second = ref({ metaDataId: 1, connectorName: 'HTTP Sender', contentType: 'ENCODED' });
ok(proposeCompare(second) === 'ok', 'a different candidate is accepted');
ok(getPending().metaDataId === 1, 'CONFIRMING: pending staged');

// Cancel discards ONLY the second selection.
cancelPending();
ok(getPending() === null, 'cancel discards the pending candidate');
ok(getAnchor().messageId === 41207, 'cancel keeps the anchor');
cancelPending();
ok(getAnchor().messageId === 41207, 'cancelling with nothing pending is harmless');

// Confirm consumes the pending candidate and hands back the ordered pair.
proposeCompare(second);
const pair = confirmCompare();
ok(pair.left.contentType === 'RAW' && pair.right.contentType === 'ENCODED', 'confirm returns left=anchor, right=candidate');
ok(getPending() === null, 'COMPARING: pending consumed');
ok(getAnchor().messageId === 41207, 'COMPARING: anchor kept for the next comparison');
ok(confirmCompare() === null, 'confirming with nothing pending returns nothing');

// Re-selecting replaces the anchor and drops any staged candidate.
proposeCompare(second);
selectForCompare(ref({ messageId: 999 }));
ok(getAnchor().messageId === 999 && getPending() === null, 're-selecting replaces the anchor and clears pending');

// The chip's ✕.
clearCompare();
ok(getAnchor() === null && getPending() === null, 'clear returns to IDLE');
events = 0;
clearCompare();
ok(events === 0, 'clearing an already-idle selection emits nothing');

/* ---- session end resets from every state ---- */

let ended = 0;
const offEnd = on('compare:end', () => { ended++; });

// Explicit logout / idle logout: the shell's session:logout event.
selectForCompare(ref());
proposeCompare(second);
emit('session:logout');
ok(ended === 1, 'logout fires compare:end so an open overlay tears down');
ok(getAnchor() === null && getPending() === null, 'logout resets from CONFIRMING');

selectForCompare(ref());
emit('session:logout');
ok(getAnchor() === null, 'logout resets from ANCHORED');

// Background 401: core/api.js's session-expired path.
globalThis.fetch = async () => new Response('', { status: 401 });
selectForCompare(ref());
resetSessionExpired();
try { await api.get('/anything'); } catch { /* the ApiError is expected */ }
ok(ended === 3, 'an expired session fires compare:end');
ok(getAnchor() === null && getPending() === null, 'an expired session resets the selection');

offChanged();
offEnd();

console.log(`compare.test: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
