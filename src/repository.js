import { qualifyName } from './identifiers.js';
import {
  buildBoundariesQuery,
  buildChunkQuery,
  buildErrorsQuery,
  buildRunsQuery,
  RUN_DETAIL_COLUMNS,
  RUN_STATE_EXPRESSION,
  TABLES,
} from './query.js';

// One chunk's plan is one row; the blocks-strategy representative call returns
// three (boundary population, non-final chunk and final chunk).
const EXPLAIN_CHUNK_SQL = `
  SELECT o_plan_kind, o_sql_text, o_plan
  FROM dml_utils.explain_migration_chunk($1, $2, $3, $4::text[], $5::text[], $6, $7)`;

const EXPLAIN_CHUNKS_SQL = `
  SELECT o_plan_kind, o_sql_text, o_plan
  FROM dml_utils.explain_migration_chunks(
    $1,
    $2,
    $3,
    $4::dml_utils_data.positive_integer,
    $5,
    $6::dml_utils_data.chunking_strategy)`;

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
    `SELECT ${RUN_DETAIL_COLUMNS.join(', ')}, ${RUN_STATE_EXPRESSION} FROM ${runTable} WHERE run_id = $1`,
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

/**
 * Flattens a boundary's position-aligned migration_key arrays into one text
 * value per primary-key column, in key order. `prefix` selects the next
 * boundary's aliases (`next_`) for a chunk's end key.
 *
 * @param {object} row the boundary row
 * @param {string} [prefix] array-column prefix
 * @returns {string[]} the key values, or an empty array when none are present
 */
export function keyValues(row, prefix = '') {
  const arrays = [
    row[`${prefix}bigint_values`],
    row[`${prefix}text_values`],
    row[`${prefix}uuid_values`],
  ];
  const length = arrays.reduce(
    (max, values) => Math.max(max, Array.isArray(values) ? values.length : 0),
    0,
  );
  const result = [];
  for (let index = 0; index < length; index += 1) {
    const value = arrays
      .map((values) => (Array.isArray(values) ? values[index] : undefined))
      .find((candidate) => candidate !== undefined && candidate !== null);
    result.push(value === undefined ? null : String(value));
  }
  return result;
}

/**
 * Reads one chunk boundary, its following boundary and the EXPLAIN plan for the
 * chunk. Explain failures (for example the driving table was dropped, the
 * dml_utils function is absent, or the boundary is terminal) are reported in
 * `planError`; the run and boundary details are still returned.
 *
 * @param {import('pg').Pool} pool the connection pool
 * @param {object} config the application configuration
 * @param {string} runId the run id
 * @param {string} boundaryNo the boundary number
 * @returns {Promise<object|null>} the chunk details, or `null` when missing
 */
export async function getChunk(pool, config, runId, boundaryNo) {
  const detail = await getRun(pool, config, runId);
  if (detail === null) return null;

  const { run } = detail;
  const query = buildChunkQuery(config, runId, boundaryNo);
  const boundaryResult = await pool.query(query.rowsSql, query.rowsValues);
  if (boundaryResult.rows.length === 0) return null;

  const boundary = boundaryResult.rows[0];
  const boundaryNumber = Number(boundary.boundary_no);
  const totalChunks = Number(run.total_chunks);
  const isBlocks = run.chunk_by === 'blocks';
  const base = {
    run,
    boundary,
    plan: [],
    planError: null,
    planErrorCode: null,
    planScope: isBlocks ? 'representative' : 'chunk',
  };

  if (boundaryNumber >= totalChunks) {
    return {
      ...base,
      planError: 'This boundary is the terminal high-water mark for the run, not a chunk.',
    };
  }

  const startValues = keyValues(boundary);
  const endValues = keyValues(boundary, 'next_');
  if (!isBlocks && (startValues.length === 0 || endValues.length !== startValues.length)) {
    return {
      ...base,
      planError:
        'The next boundary is missing or has a different key width; cannot explain this chunk.',
    };
  }

  try {
    if (isBlocks) {
      const result = await pool.query(EXPLAIN_CHUNKS_SQL, [
        run.sql_text,
        run.driving_table_schema_name,
        run.driving_table_name,
        run.chunk_size,
        run.driving_table_alias,
        run.chunk_by,
      ]);
      return { ...base, plan: result.rows };
    }

    const isFinal = boundaryNumber + 1 === totalChunks;
    const result = await pool.query(EXPLAIN_CHUNK_SQL, [
      run.sql_text,
      run.driving_table_schema_name,
      run.driving_table_name,
      startValues,
      endValues,
      isFinal,
      run.driving_table_alias,
    ]);
    return { ...base, plan: result.rows };
  } catch (error) {
    // The page is still useful without a plan: the run and boundary details are
    // already-read immutable metadata. Surface the database message instead of
    // failing the whole request (a dropped driving table is a common case).
    return { ...base, planError: error.message, planErrorCode: error.code ?? null };
  }
}
