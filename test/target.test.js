import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_CONFIG } from '../src/config.js';
import { resolveTarget, TargetError } from '../src/target.js';

test('falls back to the configured schema', () => {
  const target = resolveTarget(DEFAULT_CONFIG, {});
  assert.deepEqual(target, { schema: 'dml_utils_data' });
});

test('overrides the schema from the query', () => {
  const target = resolveTarget(DEFAULT_CONFIG, { schema: 'other_data' });
  assert.deepEqual(target, { schema: 'other_data' });
});

test('treats blank and repeated parameters as unset', () => {
  assert.deepEqual(resolveTarget(DEFAULT_CONFIG, { schema: '  ' }), { schema: 'dml_utils_data' });
  assert.deepEqual(resolveTarget(DEFAULT_CONFIG, { schema: ['a', 'b'] }), {
    schema: 'dml_utils_data',
  });
});

test('rejects a schema that is not a valid identifier', () => {
  assert.throws(() => resolveTarget(DEFAULT_CONFIG, { schema: 'bad name' }), TargetError);
  assert.throws(() => resolveTarget(DEFAULT_CONFIG, { schema: 'a.b' }), TargetError);
  assert.throws(() => resolveTarget(DEFAULT_CONFIG, { schema: 'x; drop table y' }), TargetError);
});
