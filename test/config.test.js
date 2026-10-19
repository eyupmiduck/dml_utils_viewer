import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ConfigError, loadConfig, parseArgs } from '../src/config.js';

function writeConfig(contents) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-config-'));
  const file = path.join(directory, 'config.yaml');
  fs.writeFileSync(file, contents);
  return file;
}

test('parses --config and --config= forms', () => {
  assert.deepEqual(parseArgs(['--config', 'a.yaml']).configPath, 'a.yaml');
  assert.deepEqual(parseArgs(['--config=b.yaml']).configPath, 'b.yaml');
  assert.equal(parseArgs(['--help']).help, true);
  assert.throws(() => parseArgs(['--nope']), ConfigError);
  assert.throws(() => parseArgs(['--config']), ConfigError);
  assert.throws(() => parseArgs(['--config=']), ConfigError);
});

test('falls back to the default config and reads the password from the environment', () => {
  const config = loadConfig({ argv: [], env: { VIEWER_DB_PASSWORD: 'secret' } });

  assert.equal(config.database.host, '127.0.0.1');
  assert.equal(config.database.name, 'dml_utils');
  assert.equal(config.schema, 'dml_utils_data');
  assert.equal(config.server.port, 3220);
  assert.equal(config.password, 'secret');
});

test('treats an empty CONFIG variable as unset', () => {
  const config = loadConfig({ argv: [], env: { CONFIG: '', VIEWER_DB_PASSWORD: 'secret' } });
  assert.equal(config.database.name, 'dml_utils');
});

test('wraps a malformed YAML file in a ConfigError', () => {
  const file = writeConfig('database:\n  host: [unterminated\n');
  assert.throws(
    () => loadConfig({ argv: ['--config', file], env: { VIEWER_DB_PASSWORD: 'x' } }),
    ConfigError,
  );
});

test('loads an explicit config file and merges it over the defaults', () => {
  const file = writeConfig(`
database:
  host: db.example.com
  port: 6543
  name: app
  user: app_user
  passwordEnv: APP_DB_PASSWORD
schema: app_data
server:
  port: 8080
`);

  const config = loadConfig({
    argv: ['--config', file],
    env: { APP_DB_PASSWORD: 'pw' },
  });

  assert.equal(config.database.host, 'db.example.com');
  assert.equal(config.database.port, 6543);
  assert.equal(config.schema, 'app_data');
  assert.equal(config.server.port, 8080);
  assert.equal(config.password, 'pw');
  // An unset value still comes from the defaults.
  assert.equal(config.server.pageSize, 25);
});

test('honours the CONFIG environment variable', () => {
  const file = writeConfig('database:\n  name: from_env\n');
  const config = loadConfig({
    argv: [],
    env: { CONFIG: file, VIEWER_DB_PASSWORD: 'pw' },
  });
  assert.equal(config.database.name, 'from_env');
});

test('rejects a missing explicit config file', () => {
  assert.throws(
    () =>
      loadConfig({ argv: ['--config', '/nope/missing.yaml'], env: { VIEWER_DB_PASSWORD: 'x' } }),
    ConfigError,
  );
});

test('rejects a missing password environment variable', () => {
  assert.throws(() => loadConfig({ argv: [], env: {} }), /password environment variable/);
});

test('rejects an invalid schema identifier', () => {
  const file = writeConfig('schema: "bad name"\n');
  assert.throws(
    () => loadConfig({ argv: ['--config', file], env: { VIEWER_DB_PASSWORD: 'x' } }),
    /schema/,
  );
});

test('rejects an out-of-range port', () => {
  const file = writeConfig('database:\n  port: 70000\n');
  assert.throws(
    () => loadConfig({ argv: ['--config', file], env: { VIEWER_DB_PASSWORD: 'x' } }),
    /database.port/,
  );
});
