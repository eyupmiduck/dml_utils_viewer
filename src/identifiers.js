/**
 * Validates and quotes PostgreSQL identifiers.
 *
 * Configuration supplies schema and table names, which cannot be passed as
 * bind parameters. Only simple, unquoted identifiers are accepted, then quoted
 * with double quotes so a name that is a reserved word (or mixed case) is used
 * exactly as written.
 */

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Returns whether the value is a valid unquoted SQL identifier.
 *
 * @param {string} name the candidate identifier
 * @returns {boolean} true when the name can be used as a SQL identifier
 */
export function isValidIdentifier(name) {
  return typeof name === 'string' && IDENTIFIER.test(name);
}

/**
 * Quotes a SQL identifier, rejecting anything that is not a simple identifier
 * so a config value cannot inject SQL.
 *
 * @param {string} name the identifier to quote
 * @returns {string} the double-quoted identifier
 * @throws {Error} when the name is not a valid identifier
 */
export function quoteIdentifier(name) {
  if (!isValidIdentifier(name)) {
    throw new Error(`Invalid SQL identifier: ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}

/**
 * Builds a qualified, quoted `schema.table` name.
 *
 * @param {string} schema the schema name
 * @param {string} table the table name
 * @returns {string} the qualified, quoted name
 */
export function qualifyName(schema, table) {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}
