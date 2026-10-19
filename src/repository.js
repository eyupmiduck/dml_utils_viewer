import { buildRunsQuery } from './query.js';

/**
 * Reads one page of the migration_run table.
 *
 * @param {import('pg').Pool} pool the connection pool
 * @param {object} config the application configuration
 * @param {{schema: string}} target the schema holding the tables
 * @param {object} [params] pagination, sorting and filter values
 * @returns {Promise<{rows: object[], total: number, page: number, pageSize: number, pages: number}>} the page
 */
export async function listRuns(pool, config, target, params = {}) {
  const { rowsSql, countSql, rowsValues, countValues, page, pageSize } = buildRunsQuery(
    config,
    target,
    params,
  );

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
  };
}
