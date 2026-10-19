import { qualifyName } from './identifiers.js';

// The migration tables live together in one schema and their names are fixed by
// the dml_utils_data schema, so only the schema name is configurable, and only
// through the configuration file.
export const TABLES = Object.freeze({
  run: 'migration_run',
  boundary: 'migration_boundary',
  error: 'migration_error',
});

/** migration_run columns returned to the UI, in display order. */
export const RUN_COLUMNS = [
  'run_id',
  'label',
  'chunk_by',
  'chunk_size',
  'threads',
  'driving_table_schema_name',
  'driving_table_name',
  'driving_table_alias',
  'total_chunks',
  'total_chunks_completed',
  'created_at',
  'started_at',
  'boundaries_calculated_at',
  'completed_at',
  'archived_at',
];

// The run detail additionally returns the (potentially large) SQL text and the
// block-chunking filepath, which the list does not need.
export const RUN_DETAIL_COLUMNS = [...RUN_COLUMNS, 'sql_text', 'driving_table_relation_filepath'];

// The run's derived state, from its timestamps. Archived wins, then completed,
// then a run that has started, otherwise it is still pending.
export const RUN_STATE_EXPRESSION = `CASE
      WHEN archived_at IS NOT NULL THEN 'archived'
      WHEN completed_at IS NOT NULL THEN 'completed'
      WHEN started_at IS NOT NULL THEN 'running'
      ELSE 'pending'
    END AS state`;

// The WHERE fragment for each selectable state.
const STATE_FILTERS = {
  pending: 'archived_at IS NULL AND started_at IS NULL',
  running: 'archived_at IS NULL AND started_at IS NOT NULL AND completed_at IS NULL',
  completed: 'archived_at IS NULL AND completed_at IS NOT NULL',
  archived: 'archived_at IS NOT NULL',
};

// The chunking strategies the chunk_by domain allows.
const CHUNK_BY = new Set(['primary_key', 'blocks']);

/** Columns a caller may sort by. */
const SORTABLE_COLUMNS = new Set([
  'run_id',
  'label',
  'chunk_by',
  'created_at',
  'started_at',
  'completed_at',
  'total_chunks',
  'total_chunks_completed',
]);

const DEFAULT_SORT = 'run_id';

function clampPageSize(config, requested) {
  const max = config.server.maxPageSize;
  const parsed = Number.parseInt(requested, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return config.server.pageSize;
  }
  return Math.min(parsed, max);
}

// Express may hand a repeated query parameter through as an array; only a
// single non-blank string is accepted, so a bind parameter cannot fail a cast.
function asFilterString(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Builds the paginated, filtered migration_run query. Values are always passed
 * as bind parameters; only the allow-listed sort column and the validated
 * schema/table names are interpolated.
 *
 * @param {object} config the application configuration
 * @param {object} [params] pagination, sorting and filter values
 * @returns {{rowsSql: string, countSql: string, rowsValues: unknown[], countValues: unknown[], page: number, pageSize: number, sort: string, dir: string}} the queries and resolved parameters
 */
export function buildRunsQuery(config, params = {}) {
  const table = qualifyName(config.schema, TABLES.run);
  const filters = params.filters ?? {};

  const where = [];
  const countValues = [];
  const placeholder = (value) => {
    countValues.push(value);
    return `$${countValues.length}`;
  };

  const label = asFilterString(filters.label);
  if (label !== undefined) {
    where.push(`label ILIKE ${placeholder(`%${label}%`)}`);
  }

  const chunkBy = asFilterString(filters.chunk_by);
  if (chunkBy !== undefined && CHUNK_BY.has(chunkBy)) {
    where.push(`chunk_by = ${placeholder(chunkBy)}::dml_utils_data.chunking_strategy`);
  }

  const state = asFilterString(filters.state);
  if (state !== undefined && state !== 'all' && STATE_FILTERS[state] !== undefined) {
    where.push(STATE_FILTERS[state]);
  }

  const from = asFilterString(filters.from);
  if (from !== undefined) {
    where.push(`created_at >= ${placeholder(from)}::timestamptz`);
  }
  const to = asFilterString(filters.to);
  if (to !== undefined) {
    // The UI sends a date; include the whole day by using an exclusive upper
    // bound at midnight of the following day.
    where.push(`created_at < (${placeholder(to)}::date + 1)`);
  }
  const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';

  const page = Math.max(1, Number.parseInt(params.page, 10) || 1);
  const pageSize = clampPageSize(config, params.pageSize);
  const offset = (page - 1) * pageSize;
  const sort = SORTABLE_COLUMNS.has(params.sort) ? params.sort : DEFAULT_SORT;
  const dir = String(params.dir ?? '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const rowsSql =
    `SELECT ${RUN_COLUMNS.join(', ')}, ${RUN_STATE_EXPRESSION} FROM ${table}${whereSql}` +
    ` ORDER BY ${sort} ${dir}, run_id DESC LIMIT $${countValues.length + 1} OFFSET $${countValues.length + 2}`;
  const rowsValues = [...countValues, pageSize, offset];
  const countSql = `SELECT count(*)::int AS total FROM ${table}${whereSql}`;

  return { rowsSql, countSql, rowsValues, countValues, page, pageSize, sort, dir };
}

/** migration_boundary columns returned to the UI, in display order. */
export const BOUNDARY_COLUMNS = [
  'boundary_no',
  '(boundary_id).bigint_values AS bigint_values',
  '(boundary_id).text_values AS text_values',
  '(boundary_id).uuid_values AS uuid_values',
  'created_at',
  'started_at',
  'completed_at',
];

// The boundary's derived state: a chunk that has completed, one in progress,
// otherwise it has not been claimed yet.
const BOUNDARY_STATE_EXPRESSION = `CASE
      WHEN completed_at IS NOT NULL THEN 'completed'
      WHEN started_at IS NOT NULL THEN 'running'
      ELSE 'pending'
    END AS state`;

const BOUNDARY_STATE_FILTERS = {
  pending: 'completed_at IS NULL AND started_at IS NULL',
  running: 'started_at IS NOT NULL AND completed_at IS NULL',
  completed: 'completed_at IS NOT NULL',
};

/** migration_error columns returned to the UI, in display order. */
export const ERROR_COLUMNS = [
  'e.error_id',
  'e.run_id',
  'r.label AS run_label',
  'e.boundary_no',
  'e.sqlstate',
  'e.message',
  'e.created_at',
];

/** Columns a caller may sort errors by. */
const ERROR_SORT_COLUMNS = new Set(['error_id', 'run_id', 'boundary_no', 'created_at']);

/**
 * Builds the paginated boundaries query for one run.
 *
 * @param {object} config the application configuration
 * @param {string} runId the run id (a digit string, bound as a bigint)
 * @param {object} [params] pagination and filter values
 * @returns {{rowsSql: string, countSql: string, rowsValues: unknown[], countValues: unknown[], page: number, pageSize: number}} the queries and resolved parameters
 */
export function buildBoundariesQuery(config, runId, params = {}) {
  const table = qualifyName(config.schema, TABLES.boundary);
  const where = ['run_id = $1'];
  const countValues = [runId];

  const state = asFilterString(params.filters?.state);
  if (state !== undefined && state !== 'all' && BOUNDARY_STATE_FILTERS[state] !== undefined) {
    where.push(BOUNDARY_STATE_FILTERS[state]);
  }
  const whereSql = ` WHERE ${where.join(' AND ')}`;

  const page = Math.max(1, Number.parseInt(params.page, 10) || 1);
  const pageSize = clampPageSize(config, params.pageSize);
  const offset = (page - 1) * pageSize;

  const rowsSql =
    `SELECT ${BOUNDARY_COLUMNS.join(', ')}, ${BOUNDARY_STATE_EXPRESSION} FROM ${table}${whereSql}` +
    ` ORDER BY boundary_no ASC LIMIT $${countValues.length + 1} OFFSET $${countValues.length + 2}`;
  const rowsValues = [...countValues, pageSize, offset];
  const countSql = `SELECT count(*)::int AS total, count(completed_at)::int AS completed FROM ${table}${whereSql}`;

  return { rowsSql, countSql, rowsValues, countValues, page, pageSize };
}

/**
 * Builds the paginated errors query. With `filters.run_id` it is a run's
 * errors; without, it is every recorded error.
 *
 * @param {object} config the application configuration
 * @param {object} [params] pagination, sorting and filter values
 * @returns {{rowsSql: string, countSql: string, rowsValues: unknown[], countValues: unknown[], page: number, pageSize: number, sort: string, dir: string}} the queries and resolved parameters
 */
export function buildErrorsQuery(config, params = {}) {
  const errorTable = qualifyName(config.schema, TABLES.error);
  const runTable = qualifyName(config.schema, TABLES.run);
  const filters = params.filters ?? {};

  const where = [];
  const countValues = [];
  const placeholder = (value) => {
    countValues.push(value);
    return `$${countValues.length}`;
  };

  const runId = asFilterString(filters.run_id);
  if (runId !== undefined && /^\d+$/.test(runId)) {
    where.push(`e.run_id = ${placeholder(runId)}`);
  }
  const sqlstate = asFilterString(filters.sqlstate);
  if (sqlstate !== undefined) {
    where.push(`e.sqlstate ILIKE ${placeholder(`%${sqlstate}%`)}`);
  }
  const message = asFilterString(filters.message);
  if (message !== undefined) {
    where.push(`e.message ILIKE ${placeholder(`%${message}%`)}`);
  }
  const from = asFilterString(filters.from);
  if (from !== undefined) {
    where.push(`e.created_at >= ${placeholder(from)}::timestamptz`);
  }
  const to = asFilterString(filters.to);
  if (to !== undefined) {
    where.push(`e.created_at < (${placeholder(to)}::date + 1)`);
  }
  const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';

  const page = Math.max(1, Number.parseInt(params.page, 10) || 1);
  const pageSize = clampPageSize(config, params.pageSize);
  const offset = (page - 1) * pageSize;
  const sort = ERROR_SORT_COLUMNS.has(params.sort) ? params.sort : 'error_id';
  const dir = String(params.dir ?? '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const rowsSql =
    `SELECT ${ERROR_COLUMNS.join(', ')} FROM ${errorTable} e` +
    ` LEFT JOIN ${runTable} r ON r.run_id = e.run_id${whereSql}` +
    ` ORDER BY ${sort} ${dir} LIMIT $${countValues.length + 1} OFFSET $${countValues.length + 2}`;
  const rowsValues = [...countValues, pageSize, offset];
  const countSql = `SELECT count(*)::int AS total FROM ${errorTable} e LEFT JOIN ${runTable} r ON r.run_id = e.run_id${whereSql}`;

  return { rowsSql, countSql, rowsValues, countValues, page, pageSize, sort, dir };
}
