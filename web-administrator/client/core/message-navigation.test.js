import assert from 'node:assert/strict';
import { resolveMessageUrlCriteria } from './message-navigation.js';

// Single metaDataId selects the toolbar Connector dropdown without activating Advanced.
{
    const c = resolveMessageUrlCriteria('?metaDataId=1');
    assert.equal(c.connectorVal, '1');
    assert.equal(c.advanced.includedMetaDataIds, null);
    assert.equal(c.advanced.excludedMetaDataIds, null);
}

// Source connector (metaDataId=0) also maps to the toolbar Connector dropdown.
{
    const c = resolveMessageUrlCriteria({ metaDataId: '0' });
    assert.equal(c.connectorVal, '0');
    assert.equal(c.advanced.includedMetaDataIds, null);
}

// Multiple metaDataId values (comma-separated or repeated keys) stage Advanced includedMetaDataIds.
{
    const fromComma = resolveMessageUrlCriteria('?metaDataId=1,2,1');
    assert.equal(fromComma.connectorVal, '');
    assert.deepEqual(fromComma.advanced.includedMetaDataIds, [1, 2]);

    const fromRepeated = resolveMessageUrlCriteria('?metaDataId=0&metaDataId=3');
    assert.equal(fromRepeated.connectorVal, '');
    assert.deepEqual(fromRepeated.advanced.includedMetaDataIds, [0, 3]);
}

// Statuses accept comma-separated and repeated keys, normalize case, and ignore unknown values.
{
    const c = resolveMessageUrlCriteria('?status=error,queued&status=SENT&status=unknown');
    assert.deepEqual(c.statuses, ['ERROR', 'QUEUED', 'SENT']);
}

// Main search bar fields (startDate, endDate, textSearch, textSearchRegex).
{
    const c = resolveMessageUrlCriteria(
        '?startDate=2026-11-17T00:00:00&endDate=2026-11-17T23:59:59&textSearch=^MSH&textSearchRegex=true'
    );
    assert.equal(c.startDate, '2026-11-17T00:00');
    assert.equal(c.endDate, '2026-11-17T23:59:59');
    assert.equal(c.textSearch, '^MSH');
    assert.equal(c.textRegex, true);
}

// Scalar and boolean Advanced fields.
{
    const c = resolveMessageUrlCriteria({
        minMessageId: '100',
        maxMessageId: '500',
        minOriginalId: '40',
        maxOriginalId: '42',
        minImportId: '10',
        maxImportId: '20',
        serverId: '  srv-1  ',
        excludedMetaDataId: '0,2',
        minSendAttempts: '1',
        maxSendAttempts: '5',
        attachment: 'true',
        error: '1',
    });
    assert.equal(c.advanced.minMessageId, '100');
    assert.equal(c.advanced.maxMessageId, '500');
    assert.equal(c.advanced.minOriginalId, '40');
    assert.equal(c.advanced.maxOriginalId, '42');
    assert.equal(c.advanced.minImportId, '10');
    assert.equal(c.advanced.maxImportId, '20');
    assert.equal(c.advanced.serverId, 'srv-1');
    assert.deepEqual(c.advanced.excludedMetaDataIds, [0, 2]);
    assert.equal(c.advanced.minSendAttempts, '1');
    assert.equal(c.advanced.maxSendAttempts, '5');
    assert.equal(c.advanced.attachment, true);
    assert.equal(c.advanced.error, true);
}

// Precedence: metaDataId wins over excludedMetaDataId.
{
    const c = resolveMessageUrlCriteria('?metaDataId=1&excludedMetaDataId=0');
    assert.equal(c.connectorVal, '1');
    assert.equal(c.advanced.includedMetaDataIds, null);
    assert.equal(c.advanced.excludedMetaDataIds, null);
}

// Precedence: hasTargetMessageId skips filter criteria so ?messageId= positioning works unchanged.
{
    const c = resolveMessageUrlCriteria('?messageId=42&status=ERROR&metaDataId=1', { hasTargetMessageId: true });
    assert.equal(c.connectorVal, '');
    assert.deepEqual(c.statuses, []);
    assert.equal(c.advanced.includedMetaDataIds, null);
}

// Invalid values are ignored safely.
{
    const c = resolveMessageUrlCriteria(
        '?metaDataId=abc,-1&excludedMetaDataId=nope&startDate=2026-02-30T10:00&endDate=bad&minMessageId=-5&maxSendAttempts=xyz&error=no'
    );
    assert.equal(c.connectorVal, '');
    assert.equal(c.advanced.includedMetaDataIds, null);
    assert.equal(c.advanced.excludedMetaDataIds, null);
    assert.equal(c.startDate, '');
    assert.equal(c.endDate, '');
    assert.equal(c.advanced.minMessageId, '');
    assert.equal(c.advanced.maxSendAttempts, '');
    assert.equal(c.advanced.error, false);
}

console.log('message-navigation: URL query criteria resolution and validation passed');
