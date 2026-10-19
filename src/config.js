import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

import { isValidIdentifier } from './identifiers.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Where the default configuration file lives. */
export const DEFAULT_CONFIG_PATH = path.join(projectRoot, 'config', 'default.yaml');

/** Built-in defaults, used as the base for any loaded configuration file. */
export const DEFAULT_CONFIG = Object.freeze({
  database: {
    host: '127.0.0.1',
    port: 5432,
    name: 'dml_utils',
    user: 'postgres',
    passwordEnv: 'VIEWER_DB_PASSWORD',
    ssl: false,
  },
  schema: 'dml_utils_data',
  server: { host: '127.0.0.1', port: 3220, pageSize: 25, maxPageSize: 200 },
});

/** Raised for any configuration problem, so the server can report it cleanly. */
export class ConfigError extends Error {}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override ?? {})) {
    result[key] =
      isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return result;
}

/**
 * Parses the supported command-line arguments.
 *
 * @param {string[]} argv arguments after the script name
 * @returns {{configPath: (string|undefined), help: boolean}} the parsed arguments
 * @throws {ConfigError} when an unknown argument or a missing value is seen
 */
export function parseArgs(argv) {
  const args = { configPath: undefined, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--config') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new ConfigError('--config requires a file path');
      }
      args.configPath = value;
      index += 1;
    } else if (arg.startsWith('--config=')) {
      const value = arg.slice('--config='.length);
      if (value === '') {
        throw new ConfigError('--config requires a file path');
      }
      args.configPath = value;
    } else if (arg === '-h' || arg === '--help') {
      args.help = true;
    } else {
      throw new ConfigError(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function requireInteger(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${field} must be an integer between ${min} and ${max}`);
  }
}

function requireIdentifier(value, field) {
  if (!isValidIdentifier(value)) {
    throw new ConfigError(`${field} must be a valid SQL identifier, was ${JSON.stringify(value)}`);
  }
}

function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigError(`${field} must be a non-empty string`);
  }
}

function validateConfig(config) {
  requireNonEmptyString(config.database?.host, 'database.host');
  requireInteger(config.database?.port, 'database.port', { min: 1, max: 65535 });
  requireNonEmptyString(config.database?.name, 'database.name');
  requireNonEmptyString(config.database?.user, 'database.user');
  requireNonEmptyString(config.database?.passwordEnv, 'database.passwordEnv');
  if (typeof config.database?.ssl !== 'boolean') {
    throw new ConfigError('database.ssl must be true or false');
  }

  requireIdentifier(config.schema, 'schema');

  requireNonEmptyString(config.server?.host, 'server.host');
  requireInteger(config.server?.port, 'server.port', { min: 1, max: 65535 });
  requireInteger(config.server?.pageSize, 'server.pageSize', { min: 1 });
  requireInteger(config.server?.maxPageSize, 'server.maxPageSize', { min: 1 });
  if (config.server.pageSize > config.server.maxPageSize) {
    throw new ConfigError('server.pageSize must not exceed server.maxPageSize');
  }
}

/**
 * Loads and validates the configuration.
 *
 * The file is chosen from `--config <path>`, then the `CONFIG` environment
 * variable, then `config/default.yaml`. A missing explicitly-requested file is
 * an error; a missing default file falls back to the built-in defaults. The
 * database password is read only from the environment variable named by
 * `database.passwordEnv`.
 *
 * @param {object} [options] overrides for testing
 * @param {string[]} [options.argv] command-line arguments
 * @param {NodeJS.ProcessEnv} [options.env] environment variables
 * @param {string} [options.cwd] base directory for relative config paths
 * @returns {object} the validated configuration, including `password` and `configPath`
 * @throws {ConfigError} when the configuration is missing or invalid
 */
export function loadConfig({
  argv = process.argv.slice(2),
  env = process.env,
  cwd = process.cwd(),
} = {}) {
  const args = parseArgs(argv);
  const requestedPath = args.configPath ?? (env.CONFIG || undefined);
  const explicit = requestedPath !== undefined;
  const configPath = path.resolve(cwd, requestedPath ?? DEFAULT_CONFIG_PATH);

  let fileConfig = {};
  if (fs.existsSync(configPath)) {
    let parsed;
    try {
      parsed = YAML.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
      throw new ConfigError(`Failed to parse configuration file ${configPath}: ${error.message}`);
    }
    if (parsed !== null && !isPlainObject(parsed)) {
      throw new ConfigError(`Configuration file ${configPath} must contain a YAML mapping`);
    }
    fileConfig = parsed ?? {};
  } else if (explicit) {
    throw new ConfigError(`Configuration file not found: ${configPath}`);
  }

  const config = deepMerge(DEFAULT_CONFIG, fileConfig);
  validateConfig(config);

  const password = env[config.database.passwordEnv];
  if (typeof password !== 'string' || password === '') {
    throw new ConfigError(
      `Database password environment variable ${config.database.passwordEnv} is not set`,
    );
  }

  return { ...config, password, configPath };
}
