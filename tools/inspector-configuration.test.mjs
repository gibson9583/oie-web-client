import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configurationFacts, configurationText } from '../web-administrator/client/core/inspector-configuration.js';

test('SQS properties retain operational configuration and redact shipped credential fields', () => {
    const props = { '@class': 'com.mirth.connect.connectors.sqs.SqsReceiverProperties', '@version': '1.0.2',
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/123/incoming', region: 'us-east-1', authType: 'STATIC',
        accessKeyId: 'sensitive-id', secretAccessKey: 'sensitive-secret', roleArn: 'arn:aws:iam::123:role/poll',
        waitTimeSeconds: '20', maxMessages: '10', includeAttributes: true, s3EventMode: 'DISABLED' };
    const text = configurationText(props);
    for (const expected of [props.queueUrl, props.region, props.roleArn, 'Wait Time Seconds: 20', 'Include Attributes: true', 'Version: 1.0.2']) assert.ok(text.includes(expected));
    for (const forbidden of ['sensitive-id', 'sensitive-secret']) assert.equal(text.includes(forbidden), false);
});

test('Kiteworks and Query configuration stays useful without exposing credentials', () => {
    const text = configurationText({ baseUrl: 'https://files.example/api', folderId: 'folder-7', clientId: 'public-client',
        clientSecret: 'secret-client', keyPassword: 'secret-key', proxyPassword: 'secret-proxy', keyAlias: 'signing-cert',
        keyPath: '/keys/service.pem', serverName: 'Clinical FHIR', queryName: 'Recent patients', checkpointKey: 'patient-import',
        queryParameters: '{"_count":25}', inputTemplate: 'return\nmessage;' });
    for (const expected of ['folder-7', 'Clinical FHIR', 'Recent patients', 'patient-import', '/keys/service.pem', 'signing-cert', 'return\nmessage;', '{"_count":25}']) assert.ok(text.includes(expected));
    for (const forbidden of ['secret-client', 'secret-key', 'secret-proxy']) assert.equal(text.includes(forbidden), false);
});

test('native XStream maps redact by semantic key, including nested typed values and duplicates', () => {
    const text = configurationText({ headers: { entry: [
        { string: ['Authorization', 'Bearer hidden'] },
        { string: ['Content-Type', 'application/json'] },
        { string: 'password', 'com.example.Secret': { value: 'hidden-object' } },
        { string: 'ordinary', 'com.example.Settings': { retries: 3, accessToken: 'hidden-nested' } },
        { string: ['X-Mode', 'first'] }, { string: ['X-Mode', 'second'] }
    ] }, settings: { entry: { string: ['api_key', { '@class': 'string', $: 'hidden-typed' }] } } });
    assert.ok(text.includes('Headers › Content-Type: application/json'));
    assert.ok(text.includes('Headers › ordinary › Retries: 3'));
    assert.ok(text.includes('X-Mode [5]: first'));assert.ok(text.includes('X-Mode [6]: second'));
    for (const forbidden of ['hidden', 'Bearer']) assert.equal(text.includes(forbidden), false);
});

test('unknown step keeps code, explicit null and empty values, lists, and metadata', () => {
    const source = 'return/*\n*/message;';
    const input = { __type: 'com.example.Step', enabled: true, name: 'Plugin', scriptBody: source,
        properties: { actions: [{ expression: '$c("left")' }, { expression: '$c("right")' }], mapping: { '@class': 'string', $: '' }, absent: null } };
    const before = structuredClone(input);
    const facts = configurationFacts(input, { omit: ['__type', 'enabled', 'name'] });
    assert.ok(facts.some(([key,value]) => key === 'Script Body' && value === source));
    assert.ok(facts.some(([key,value]) => key === 'Properties › Mapping' && value === ''));
    assert.ok(facts.some(([key,value]) => key === 'Properties › Absent' && value === '(null)'));
    assert.ok(facts.findIndex(([,v]) => v.includes('left')) < facts.findIndex(([,v]) => v.includes('right')));
    assert.deepEqual(input,before); assert.deepEqual(facts,configurationFacts(input,{omit:['__type','enabled','name']}));
});

test('credential-bearing URLs are scrubbed while code and safe endpoint parameters stay exact', () => {
    const facts = Object.fromEntries(configurationFacts({ url: 'https://user:pass@example.test/query?x=1&api%5Fkey=hidden&token=hidden2',
        template: 'https://example.test/?token=${token}', endpoint: 'jdbc:postgresql://db/test;password=hidden-db', keyAlias:'visible' }));
    assert.equal(facts.Url,'https://[redacted]@example.test/query?x=1&api%5Fkey=[redacted]&token=[redacted]');
    assert.equal(facts.Endpoint,'jdbc:postgresql://db/test;password=[redacted]');
    assert.equal(facts.Template,'https://example.test/?token=${token}');
});

test('object order is deterministic and cyclic imported objects do not hang inspection', () => {
    assert.deepEqual(configurationFacts({ z: 0, a: false }),configurationFacts({ a: false, z: 0 }));
    const input={};input.loop=input;assert.deepEqual(configurationFacts(input),[['Loop','(circular reference)']]);
    assert.deepEqual(configurationFacts({ empty: [], nil: null }),[['Empty','[]'],['Nil','(null)']]);
});

test('actual plugin model serialization stays inspectable without credential leakage', async () => {
    const { readFile } = await import('node:fs/promises');
    // ObjectJSONSerializer captures from SQS 1.0.2, Kiteworks 0.1.3 and Query 1.0.0.
    // Credential values are synthetic markers set by the capture probe.
    const captures = JSON.parse(await readFile(new URL('./fixtures/inspector-configuration.json', import.meta.url), 'utf8'));
    const output = Object.fromEntries(Object.entries(captures).map(([name, wrapped]) => [name, configurationText(Object.values(wrapped)[0])]));
    assert.ok(output.sqs.includes('https://sqs.us-east-1.amazonaws.com/123/incoming'));
    assert.ok(output.kiteworks.includes('https://files.example'));assert.ok(output.kiteworks.includes('folder-7'));
    assert.ok(output.query.includes('Clinical FHIR'));assert.ok(output.query.includes('Recent patients'));
    assert.ok(output.query.includes('return\nmessage;'));
    assert.equal(JSON.stringify(output).includes('SECRET_'), false);
});
