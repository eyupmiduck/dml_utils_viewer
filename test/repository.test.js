import assert from 'node:assert/strict';
import test from 'node:test';

import { keyValues } from '../src/repository.js';

test('flattens a single bigint key', () => {
  assert.deepEqual(keyValues({ bigint_values: ['1', '2'], text_values: null, uuid_values: null }), [
    '1',
    '2',
  ]);
});

test('flattens a composite key in column order', () => {
  assert.deepEqual(
    keyValues({
      bigint_values: ['1', null],
      text_values: [null, 'alpha'],
      uuid_values: [null, null],
    }),
    ['1', 'alpha'],
  );
});

test('flattens a uuid key', () => {
  const id = '6f9619ff-8b86-d011-b42d-00c04fc964ff';
  assert.deepEqual(keyValues({ bigint_values: null, text_values: null, uuid_values: [id] }), [id]);
});

test('reads the next boundary key with the next_ prefix', () => {
  assert.deepEqual(
    keyValues(
      {
        next_bigint_values: ['10'],
        next_text_values: null,
        next_uuid_values: null,
      },
      'next_',
    ),
    ['10'],
  );
});

test('returns an empty key when no arrays are present', () => {
  assert.deepEqual(keyValues({}), []);
  assert.deepEqual(keyValues({ next_bigint_values: null }, 'next_'), []);
});

test('rejects a non-canonical key with values from multiple kinds', () => {
  assert.throws(
    () => keyValues({ bigint_values: ['1'], text_values: ['x'], uuid_values: null }),
    /multiple values/,
  );
});
