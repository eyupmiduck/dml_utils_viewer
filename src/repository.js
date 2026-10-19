import { qualifyName } from './identifiers.js';
import {
  buildBoundariesQuery,
  buildErrorsQuery,
  buildRunsQuery,
  RUN_COLUMNS,
  RUN_STATE_EXPRESSION,
  TABLES,
} from './query.js';

// Runs a page query (rows + count) and assembles the pagination envelope.
async function paginate(pool, query, extra = () => ({})) {
  const { rowsSql, countSql, rowsValues, countValues, page, pageSize } = query;
  const [rowsResult, countResult] = await Promise.all([
    pool.query(rowsSql, rowsValues),
    pool.query(countSql, countValues),
  ]);
  const total = countResult.rows[0].total;
  return {
    rows: rowsResult.rows,
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    ...extra(countResult.rows[0]),
  };
}

/**
 * Reads one page of the migration_run table.
 *
 * @param {import('pg').Pool} pool the connection pool
 * @param {object} config the application configuration
 * @param {object} [params] pagination, sorting and filter values
 * @returns {Promise<object>} the page
 */
export async function listRuns(pool, config, params = {}) {
  return paginate(pool, buildRunsQuery(config, params));
}

/**
 * Reads one run and its counts, or `null` when it does not exist.
 *
 * @param {import('pg').Pool} pool the connection pool
 * @param {object} config the application configuration
 * @param {string} runId the run id
 * @returns {Promise<{run: object, counts: object}|null>} the run and its counts
 */
export async function getRun(pool, config, runId) {
  const runTable = qualifyName(config.schema, TABLES.run);
  const boundaryTable = qualifyName(config.schema, TABLES.boundary);
  const errorTable = qualifyName(config.schema, TABLES.error);

  const runResult = await pool.query(
    `SELECT ${RUN_COLUMNS.join(', ')}, ${RUN_STATE_EXPRESSION} FROM ${runTable} WHERE run_id = $1`,
    [runId],
  );
  if (runResult.rows.length === 0) {
    return null;
  }

  const countsResult = await pool.query(
    `SELECT (SELECT count(*)::int FROM ${boundaryTable} WHERE run_id = $1) AS boundaries,
            (SELECT count(completed_at)::int FROM ${boundaryTable} WHERE run_id = $1) AS boundaries_completed,
            (SELECT count(*)::int FROM ${errorTable} WHERE run_id = $1) AS errors`,
    [runId],
  );

  return { run: runResult.rows[0], counts: countsResult.rows[0] };
}

/**
 * Reads one page of a run's chunk boundaries.
 *
 * @param {import('pg').Pool} pool the connection pool
 * @param {object} config the application configuration
 * @param {string} runId the run id
 * @param {object} [params] pagination and filter values
 * @returns {Promise<object>} the page, including the completed count
 */
export async function listBoundaries(pool, config, runId, params = {}) {
  return paginate(pool, buildBoundariesQuery(config, runId, params), (countRow) => ({
    completed: countRow.completed,
  }));
}

/**
 * Reads one page of recorded chunk errors, for a run or across runs.
 *
 * @param {import('pg').Pool} pool the connection pool
 * @param {object} config the application configuration
 * @param {object} [params] pagination, sorting and filter values
 * @returns {Promise<object>} the page
 */
export async function listErrors(pool, config, params = {}) {
  return paginate(pool, buildErrorsQuery(config, params));
}
