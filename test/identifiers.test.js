import assert from 'node:assert/strict';
import test from 'node:test';

import { isValidIdentifier, qualifyName, quoteIdentifier } from '../src/identifiers.js';

test('accepts simple unquoted identifiers', () => {
  assert.equal(isValidIdentifier('databasechangelog'), true);
  assert.equal(isValidIdentifier('ddl_utils'), true);
  assert.equal(isValidIdentifier('_x1'), true);
});

test('rejects names that could inject SQL', () => {
  assert.equal(isValidIdentifier(''), false);
  assert.equal(isValidIdentifier('1table'), false);
  assert.equal(isValidIdentifier('a.b'), false);
  assert.equal(isValidIdentifier('a"b'), false);
  assert.equal(isValidIdentifier('a b'), false);
  assert.equal(isValidIdentifier('a;drop table x'), false);
  assert.equal(isValidIdentifier(null), false);
});

test('quotes a valid identifier', () => {
  assert.equal(quoteIdentifier('orders'), '"orders"');
});

test('throws when quoting an invalid identifier', () => {
  assert.throws(() => quoteIdentifier('bad name'), /Invalid SQL identifier/);
});

test('qualifies a schema and table', () => {
  assert.equal(qualifyName('public', 'databasechangelog'), '"public"."databasechangelog"');
});
