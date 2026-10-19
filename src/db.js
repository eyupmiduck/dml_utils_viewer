import pg from 'pg';

const { Pool } = pg;

/**
 * Creates a PostgreSQL connection pool from the configuration.
 *
 * @param {object} config the application configuration (including password)
 * @returns {pg.Pool} the connection pool
 */
export function createPool(config) {
  const pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.name,
    user: config.database.user,
    password: config.password,
    ssl: config.database.ssl ? true : undefined,
    max: 5,
  });

  // An error on an idle pooled client is emitted as an 'error' event; without a
  // listener Node would treat it as unhandled and crash the process.
  pool.on('error', (error) => {
    console.error('PostgreSQL pool error:', error.message);
  });

  return pool;
}
