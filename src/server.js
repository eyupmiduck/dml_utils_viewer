import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';

import { ConfigError, loadConfig, parseArgs } from './config.js';
import { createPool } from './db.js';
import { listRuns, getRun, listBoundaries, listErrors } from './repository.js';
import { resolveTarget, TargetError } from './target.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function printHelp() {
  console.log(`Usage: node src/server.js [--config <file>]

Options:
  --config <file>  YAML configuration file (default: config/default.yaml)
  -h, --help       Show this help

The database password is read from the environment variable named by
database.passwordEnv in the configuration (VIEWER_DB_PASSWORD by default).`);
}

function publicConfig(config) {
  return {
    // The UI only needs a display label, so keep the raw connection
    // coordinates server-side.
    connection: `${config.database.user}@${config.database.host}:${config.database.port}/${config.database.name}`,
    // Default for the editable schema input.
    schema: config.schema,
    server: { pageSize: config.server.pageSize, maxPageSize: config.server.maxPageSize },
  };
}

// Answers 400 for a bad schema and reports whether it handled the error.
function sendTargetError(error, response) {
  if (error instanceof TargetError) {
    response.status(400).json({ error: error.message });
    return true;
  }
  return false;
}

function parseRunsParams(query) {
  return {
    page: query.page,
    pageSize: query.pageSize,
    sort: query.sort,
    dir: query.dir,
    filters: {
      label: query.label,
      chunk_by: query.chunk_by,
      state: query.state,
      from: query.from,
      to: query.to,
    },
  };
}

function parseBoundaryParams(query) {
  return {
    page: query.page,
    pageSize: query.pageSize,
    filters: { state: query.state },
  };
}

function parseErrorParams(query) {
  return {
    page: query.page,
    pageSize: query.pageSize,
    sort: query.sort,
    dir: query.dir,
    filters: {
      run_id: query.run_id,
      sqlstate: query.sqlstate,
      message: query.message,
      from: query.from,
      to: query.to,
    },
  };
}

// A run id from the path: only digits are accepted, so it is a clean bigint
// bind; anything else is a client mistake.
function parseRunId(value, response) {
  if (!/^\d+$/.test(value ?? '')) {
    response.status(400).json({ error: 'run id must be a positive integer' });
    return null;
  }
  return value;
}

function createApp(config, pool) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(projectRoot, 'public')));

  app.get('/api/config', (request, response) => {
    response.json(publicConfig(config));
  });

  app.get('/api/health', async (request, response, next) => {
    try {
      await pool.query('SELECT 1');
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/runs', async (request, response, next) => {
    try {
      const target = resolveTarget(config, request.query);
      response.json(await listRuns(pool, config, target, parseRunsParams(request.query)));
    } catch (error) {
      if (sendTargetError(error, response)) return;
      next(error);
    }
  });

  app.get('/api/runs/:id', async (request, response, next) => {
    const runId = parseRunId(request.params.id, response);
    if (runId === null) return;
    try {
      const target = resolveTarget(config, request.query);
      const result = await getRun(pool, target, runId);
      if (result === null) {
        response.status(404).json({ error: `Run ${runId} not found.` });
        return;
      }
      response.json(result);
    } catch (error) {
      if (sendTargetError(error, response)) return;
      next(error);
    }
  });

  app.get('/api/runs/:id/boundaries', async (request, response, next) => {
    const runId = parseRunId(request.params.id, response);
    if (runId === null) return;
    try {
      const target = resolveTarget(config, request.query);
      response.json(
        await listBoundaries(pool, config, target, runId, parseBoundaryParams(request.query)),
      );
    } catch (error) {
      if (sendTargetError(error, response)) return;
      next(error);
    }
  });

  app.get('/api/runs/:id/errors', async (request, response, next) => {
    const runId = parseRunId(request.params.id, response);
    if (runId === null) return;
    try {
      const target = resolveTarget(config, request.query);
      const params = parseErrorParams(request.query);
      params.filters.run_id = runId;
      response.json(await listErrors(pool, config, target, params));
    } catch (error) {
      if (sendTargetError(error, response)) return;
      next(error);
    }
  });

  app.get('/api/errors', async (request, response, next) => {
    try {
      const target = resolveTarget(config, request.query);
      response.json(await listErrors(pool, config, target, parseErrorParams(request.query)));
    } catch (error) {
      if (sendTargetError(error, response)) return;
      next(error);
    }
  });

  // Express needs four arguments to treat this as error middleware.
  app.use((error, request, response, _next) => {
    // A schema that does not exist is a client mistake, not a server fault:
    // 3F000 = invalid_schema_name, 42P01 = undefined_table.
    if (error?.code === '3F000' || error?.code === '42P01') {
      response.status(404).json({ error: 'Schema not found: check the schema name.' });
      return;
    }
    console.error(error);
    response.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  let config;
  try {
    config = loadConfig({ argv: process.argv.slice(2) });
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`Configuration error: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  const pool = createPool(config);
  const app = createApp(config, pool);

  const server = app.listen(config.server.port, config.server.host, () => {
    console.log(`dml-utils-viewer on http://${config.server.host}:${config.server.port}`);
    console.log(`  config:    ${config.configPath}`);
    console.log(
      `  database:  ${config.database.user}@${config.database.host}:${config.database.port}/${config.database.name}`,
    );
    console.log(`  schema:    ${config.schema}`);
  });

  const shutdown = async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
