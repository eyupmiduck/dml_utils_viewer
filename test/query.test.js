import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_CONFIG } from '../src/config.js';
import { buildRunsQuery, RUN_COLUMNS } from '../src/query.js';

const TARGET = { schema: 'dml_utils_data' };

test('builds the default query from the configured schema', () => {
  const query = buildRunsQuery(DEFAULT_CONFIG, TARGET);

  assert.match(query.rowsSql, /FROM "dml_utils_data"\."migration_run"/);
  assert.match(query.rowsSql, /ORDER BY run_id DESC, run_id DESC/);
  assert.match(query.rowsSql, /LIMIT \$1 OFFSET \$2/);
  assert.deepEqual(query.rowsValues, [25, 0]);
  assert.deepEqual(query.countValues, []);
  assert.equal(query.page, 1);
  assert.equal(query.pageSize, 25);
  assert.equal(query.sort, 'run_id');
  assert.equal(query.dir, 'DESC');
  assert.match(query.rowsSql, /AS state/);
  for (const column of RUN_COLUMNS) {
    assert.match(query.rowsSql, new RegExp(`\\b${column}\\b`));
  }
});

test('filters by label as a contains match', () => {
  const query = buildRunsQuery(DEFAULT_CONFIG, TARGET, {
    filters: { label: 'nightly' },
  });

  assert.match(query.rowsSql, /WHERE label ILIKE \$1/);
  assert.deepEqual(query.countValues, ['%nightly%']);
});

test('filters by chunk_by and state', () => {
  const query = buildRunsQuery(DEFAULT_CONFIG, TARGET, {
    filters: { chunk_by: 'blocks', state: 'running' },
  });

  assert.match(query.rowsSql, /chunk_by = \$1::dml_utils_data\.chunking_strategy/);
  assert.match(
    query.rowsSql,
    /archived_at IS NULL AND started_at IS NOT NULL AND completed_at IS NULL/,
  );
  assert.deepEqual(query.countValues, ['blocks']);
});

test('ignores an unknown chunk_by and the all state', () => {
  const query = buildRunsQuery(DEFAULT_CONFIG, TARGET, {
    filters: { chunk_by: 'nonsense', state: 'all' },
  });

  assert.doesNotMatch(query.rowsSql, /chunk_by =/);
  assert.doesNotMatch(query.rowsSql, /WHERE/);
  assert.deepEqual(query.countValues, []);
});

test('filters a created_at range, including the whole end day', () => {
  const query = buildRunsQuery(DEFAULT_CONFIG, TARGET, {
    filters: { from: '2026-01-01', to: '2026-01-31' },
  });

  assert.match(query.rowsSql, /created_at >= \$1::timestamptz/);
  assert.match(query.rowsSql, /created_at < \(\$2::date \+ 1\)/);
  assert.deepEqual(query.countValues, ['2026-01-01', '2026-01-31']);
});

test('paginates with a bounded page size', () => {
  const query = buildRunsQuery(DEFAULT_CONFIG, TARGET, { page: '3', pageSize: '1000' });

  assert.equal(query.page, 3);
  assert.equal(query.pageSize, DEFAULT_CONFIG.server.maxPageSize);
  assert.deepEqual(query.rowsValues, [DEFAULT_CONFIG.server.maxPageSize, 400]);
});

test('only allows a known sort column and direction', () => {
  const query = buildRunsQuery(DEFAULT_CONFIG, TARGET, {
    sort: 'label; drop table x',
    dir: 'sideways',
  });

  assert.equal(query.sort, 'run_id');
  assert.equal(query.dir, 'DESC');
  assert.doesNotMatch(query.rowsSql, /drop table/);
});

test('sorts ascending on request', () => {
  const query = buildRunsQuery(DEFAULT_CONFIG, TARGET, { sort: 'created_at', dir: 'asc' });

  assert.equal(query.sort, 'created_at');
  assert.equal(query.dir, 'ASC');
  assert.match(query.rowsSql, /ORDER BY created_at ASC/);
});
