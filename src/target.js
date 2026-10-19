import { isValidIdentifier } from './identifiers.js';

/**
 * Raised when the requested schema is not a usable identifier, so the server
 * can answer with 400 rather than a generic 500.
 */
export class TargetError extends Error {}

// The migration tables live together in one schema; the names are fixed by the
// dml_utils_data schema, so only the schema is selectable.
export const TABLES = Object.freeze({
  run: 'migration_run',
  boundary: 'migration_boundary',
  error: 'migration_error',
});

// Express may hand a repeated query parameter through as an array; only a
// single non-blank string is accepted.
function queryString(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function requireIdentifier(value, field) {
  if (!isValidIdentifier(value)) {
    throw new TargetError(`${field} must be a valid SQL identifier, was ${JSON.stringify(value)}`);
  }
}

/**
 * Resolves the schema holding the migration tables from the request query,
 * falling back to the configured default. The schema name is validated as an
 * identifier; it cannot be bound as a parameter.
 *
 * @param {object} config the application configuration
 * @param {object} [query] the request query string
 * @returns {{schema: string}} the resolved schema
 * @throws {TargetError} when the name is not a valid identifier
 */
export function resolveTarget(config, query = {}) {
  const schema = queryString(query.schema) ?? config.schema;
  requireIdentifier(schema, 'schema');
  return { schema };
}
