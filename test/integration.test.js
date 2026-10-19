import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { getRun, listBoundaries, listErrors, listRuns } from '../src/repository.js';
import { resolveTarget } from '../src/target.js';

// These tests need a real database (the local dml_utils one by default). They
// are skipped unless the password environment variable is set.
const skip = process.env.VIEWER_DB_PASSWORD ? false : 'VIEWER_DB_PASSWORD is not set';

const STATES = ['pending', 'running', 'completed', 'archived'];

async function withPool(run) {
  const config = loadConfig();
  const pool = createPool(config);
  try {
    await run(config, pool, resolveTarget(config, {}));
  } finally {
    await pool.end();
  }
}

async function firstRunId(config, pool, target) {
  const page = await listRuns(pool, config, target, { page: 1, pageSize: 1 });
  return page.rows.length > 0 ? page.rows[0].run_id : null;
}

test('lists a page of runs with a derived state', { skip }, async () => {
  await withPool(async (config, pool, target) => {
    const page = await listRuns(pool, config, target, { page: 1, pageSize: 5 });

    assert.equal(page.page, 1);
    assert.equal(page.pageSize, 5);
    assert.ok(page.pages >= 1);
    assert.ok(page.total >= page.rows.length);
    for (const row of page.rows) {
      assert.ok(row.run_id);
      assert.ok(STATES.includes(row.state), `unexpected state ${row.state}`);
    }
  });
});

test('filters runs by state', { skip }, async () => {
  await withPool(async (config, pool, target) => {
    const page = await listRuns(pool, config, target, {
      pageSize: 100,
      filters: { state: 'completed' },
    });

    assert.ok(page.rows.every((row) => row.state === 'completed'));
  });
});

test('reads a run with its counts, and null for a missing run', { skip }, async () => {
  await withPool(async (config, pool, target) => {
    const runId = await firstRunId(config, pool, target);
    if (runId === null) return; // empty database

    const detail = await getRun(pool, target, runId);
    assert.equal(detail.run.run_id, runId);
    assert.ok(STATES.includes(detail.run.state));
    assert.ok(detail.counts.boundaries >= 0);
    assert.ok(detail.counts.boundaries_completed >= 0);
    assert.ok(detail.counts.errors >= 0);

    assert.equal(await getRun(pool, target, '999999999999'), null);
  });
});

test("lists a page of a run's boundaries", { skip }, async () => {
  await withPool(async (config, pool, target) => {
    const runId = await firstRunId(config, pool, target);
    if (runId === null) return;

    const page = await listBoundaries(pool, config, target, runId, { page: 1, pageSize: 5 });

    assert.ok(page.total >= page.rows.length);
    assert.ok(page.completed >= 0);
    for (const row of page.rows) {
      assert.ok(row.boundary_no !== undefined && row.boundary_no !== null);
      assert.ok(['pending', 'running', 'completed'].includes(row.state));
      // The migration_key value arrays are selected for rendering.
      assert.ok('bigint_values' in row && 'text_values' in row && 'uuid_values' in row);
    }
  });
});

test('lists errors across runs', { skip }, async () => {
  await withPool(async (config, pool, target) => {
    const page = await listErrors(pool, config, target, { page: 1, pageSize: 5 });

    assert.ok(page.total >= page.rows.length);
    for (const row of page.rows) {
      assert.ok(row.error_id);
      assert.ok(row.run_id);
      assert.ok(row.sqlstate);
    }
  });
});
