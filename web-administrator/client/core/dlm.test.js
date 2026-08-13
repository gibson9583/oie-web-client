/* Unit tests for the message-search DLM (Deterministic Language Model). */
import {
    dlmBuildDecision, dlmLooksLikeMessageId, dlmNormalize, dlmSuggestScopeIds
} from './dlm.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.error('  FAIL -', label); } };

ok(dlmNormalize('  123456  ') === '123456', 'normalize trims');
ok(dlmLooksLikeMessageId('123456'), 'digits look like message id');
ok(!dlmLooksLikeMessageId('MRN-123456'), 'MRN token is not a bare message id');

ok(dlmSuggestScopeIds('123456').join() === 'message_id', 'numeric phrase suggests message id');
ok(dlmSuggestScopeIds('abc').includes('raw') && dlmSuggestScopeIds('abc').includes('source_map'),
    'text phrase suggests raw + source map');
ok(dlmSuggestScopeIds('abc', [{ name: 'SOURCE' }]).includes('metadata'),
    'metadata suggested when columns exist');

const idHit = dlmBuildDecision('42', { scopes: ['message_id'] });
ok(idHit.operation === 'MESSAGE_ID', 'message id → MESSAGE_ID');
ok(idHit.params.minMessageId === '42' && idHit.params.maxMessageId === '42', 'exact id bounds');
ok(!('textSearch' in idHit.params), 'message id path never emits textSearch');

const scoped = dlmBuildDecision('123456', { scopes: ['raw', 'source_map'] });
ok(scoped.operation === 'SCOPED_SEARCH', 'content scopes → SCOPED_SEARCH');
ok(JSON.stringify(scoped.params.rawContentSearch) === '["123456"]', 'rawContentSearch set');
ok(JSON.stringify(scoped.params.sourceMapContentSearch) === '["123456"]', 'sourceMapContentSearch set');
ok(!('textSearch' in scoped.params), 'scoped path never emits textSearch');

const meta = dlmBuildDecision('NPI123', {
    scopes: ['metadata'],
    metaColumns: ['SOURCE', 'TYPE'],
    metaIgnoreCase: true
});
ok(meta.params.metaDataCaseInsensitiveSearch?.length === 2, 'metadata emits one clause per column');
ok(String(meta.params.metaDataCaseInsensitiveSearch[0]).includes('SOURCE CONTAINS NPI123'),
    'metadata clause format');

const legacy = dlmBuildDecision('123456', { scopes: ['legacy_text'], textSearchRegex: true });
ok(legacy.operation === 'LEGACY_TEXT' && legacy.params.textSearch === '123456', 'legacy emits textSearch');
ok(legacy.params.textSearchRegex === true, 'legacy preserves regex flag');

const mixedLegacy = dlmBuildDecision('x', { scopes: ['legacy_text', 'raw'] });
ok(mixedLegacy.operation === 'SCOPED_SEARCH' && !('textSearch' in mixedLegacy.params),
    'legacy + scoped drops legacy in favour of scoped');
ok(JSON.stringify(mixedLegacy.params.rawContentSearch) === '["x"]', 'scoped wins over legacy');

const badId = dlmBuildDecision('abc', { scopes: ['message_id'] });
ok(badId.operation === 'UNSUPPORTED', 'non-numeric message_id alone is unsupported');

const empty = dlmBuildDecision('abc', { scopes: [] });
ok(empty.operation === 'UNSUPPORTED', 'no scopes → unsupported');

console.log(`dlm: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
