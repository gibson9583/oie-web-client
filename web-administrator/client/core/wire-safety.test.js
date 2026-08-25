import assert from 'node:assert/strict';
import { strictWireList } from './wire-safety.js';

assert.deepEqual(strictWireList('', 'thing', 'thing list'), []);
assert.deepEqual(strictWireList({ thing: { id: 'one' } }, 'thing', 'thing list'), [{ id: 'one' }]);
assert.deepEqual(strictWireList({ thing: [{ id: 'one' }, { id: 'two' }] }, 'thing', 'thing list'), [
    { id: 'one' }, { id: 'two' }
]);

for (const malformed of [null, undefined, [], {}, { thing: [] }, { thing: '' }]) {
    assert.throws(
        () => strictWireList(malformed, 'thing', 'thing list'),
        /engine returned an unusable thing list/
    );
}

console.log('wire-safety tests passed');
