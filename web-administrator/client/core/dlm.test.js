/* Unit tests for the dashboard filter DLM (Deterministic Language Model). */
import { dlmDecide, dlmMatchesChannel, dlmNormalize, dlmPhraseHit, dlmWordsOrdered } from './dlm.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.error('  FAIL -', label); } };

ok(dlmNormalize('  Show STOPPED!! ') === 'show stopped', 'normalize collapses case/punct/space');
ok(dlmWordsOrdered('show me the stopped channels', 'show stopped channels'), 'ordered words allow fillers');
ok(!dlmWordsOrdered('stopped', 'show stopped'), 'ordered words need every token');

ok(dlmPhraseHit('stopped', ['stopped'], 20) === 60, 'exact phrase hits 3x weight');
ok(dlmPhraseHit('show stopped channels please', ['stopped channels'], 20) === 20, 'substring phrase hit');
ok(dlmPhraseHit('show me the stopped channels please', ['show stopped'], 20) === 20, 'ordered-word phrase hit');

const stopped = dlmDecide('stopped');
ok(stopped.operation === 'FILTER_STATE', 'stopped → FILTER_STATE');
ok(stopped.states.includes('STOPPED'), 'stopped → STOPPED state');
ok(stopped.matchedRoutes.includes('STATE_STOPPED'), 'stopped matches STATE_STOPPED');
ok(stopped.confidence >= 20, 'stopped has confidence');

const running = dlmDecide('show me running channels');
ok(running.operation === 'FILTER_STATE', 'running channels → FILTER_STATE');
ok(running.states.includes('STARTED'), 'running → STARTED');

const errored = dlmDecide('with errors');
ok(errored.operation === 'FILTER_STAT', 'with errors → FILTER_STAT');
ok(errored.stats.some((s) => s.key === 'ERROR'), 'with errors → ERROR stat');

const composite = dlmDecide('stopped with errors');
ok(composite.operation === 'FILTER_COMPOSITE', 'stopped with errors → COMPOSITE');
ok(composite.states.includes('STOPPED') && composite.stats.some((s) => s.key === 'ERROR'),
    'composite keeps state + stat');

const nameOnly = dlmDecide('ADT_Inbound');
ok(nameOnly.operation === 'FILTER_NAME', 'channel-like token stays FILTER_NAME');
ok(nameOnly.nameNeedle === 'adt_inbound', 'name needle preserved');

const empty = dlmDecide('   ');
ok(empty.operation === 'FILTER_NAME' && empty.confidence === 0, 'blank → empty FILTER_NAME');

const ctxStopped = { channelId: '1', name: 'ADT', state: 'STOPPED', stats: { ERROR: 0, QUEUED: 0 } };
const ctxStartedErr = { channelId: '2', name: 'Orders', state: 'STARTED', stats: { ERROR: 3, QUEUED: 0 } };
const ctxNamed = { channelId: '3', name: 'Demo Stopped', state: 'STARTED', stats: { ERROR: 0 } };
const ctxTagged = { channelId: '4', name: 'X', state: 'STARTED', stats: {}, tagNames: ['prod-stopped'] };

ok(dlmMatchesChannel(ctxStopped, stopped), 'state filter keeps STOPPED channel');
ok(!dlmMatchesChannel(ctxStartedErr, stopped), 'state filter drops STARTED channel');
ok(dlmMatchesChannel(ctxNamed, stopped), 'name wildcard still matches "Demo Stopped"');
ok(dlmMatchesChannel(ctxTagged, stopped), 'tag wildcard still matches');
ok(dlmMatchesChannel(ctxStartedErr, errored), 'stat filter keeps errored channel');
ok(!dlmMatchesChannel(ctxStopped, errored), 'stat filter drops zero-error channel');

ok(dlmMatchesChannel(ctxNamed, nameOnly) === false, 'ADT needle does not match Demo Stopped');
ok(dlmMatchesChannel({ ...ctxNamed, name: 'ADT_Inbound_v2' }, nameOnly), 'name needle substring works');

console.log(`dlm: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
