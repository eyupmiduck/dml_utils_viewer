import { qualifyName } from './identifiers.js';
import { TABLES } from './target.js';

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

// The run's derived state, from its timestamps. Archived wins, then completed,
// then a run that has started, otherwise it is still pending.
const STATE_EXPRESSION = `CASE
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
 * @param {{schema: string}} target the schema holding the tables
 * @param {object} [params] pagination, sorting and filter values
 * @returns {{rowsSql: string, countSql: string, rowsValues: unknown[], countValues: unknown[], page: number, pageSize: number, sort: string, dir: string}} the queries and resolved parameters
 */
export function buildRunsQuery(config, target, params = {}) {
  const table = qualifyName(target.schema, TABLES.run);
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
    `SELECT ${RUN_COLUMNS.join(', ')}, ${STATE_EXPRESSION} FROM ${table}${whereSql}` +
    ` ORDER BY ${sort} ${dir}, run_id DESC LIMIT $${countValues.length + 1} OFFSET $${countValues.length + 2}`;
  const rowsValues = [...countValues, pageSize, offset];
  const countSql = `SELECT count(*)::int AS total FROM ${table}${whereSql}`;

  return { rowsSql, countSql, rowsValues, countValues, page, pageSize, sort, dir };
}
