# dml_utils_viewer

A small web application to browse the `dml_utils_data` migration tables in a
PostgreSQL database:

- **Runs** — one row per migration run (`migration_run`), with its progress and
  state, filterable and sortable. Click a run to see its detail.
- **Run detail** — the run's configuration, the migration SQL, its chunk
  boundaries (`migration_boundary`) and the failures its chunks recorded
  (`migration_error`).
- **Errors** — every recorded chunk failure (`migration_error`), across runs.

It is **read-only**. The UI is plain HTML/CSS/ES modules — there is no build
step. The schema it reads is set in the configuration (below); it is not
changed at runtime.

## Requirements

- Node.js 24 (see `.nvmrc`)
- A PostgreSQL database holding the `dml_utils_data` tables

## Configuration

Configuration is YAML. The default file is `config/default.yaml`; select another
with `--config <path>` or the `CONFIG` environment variable. If no file is
present, the built-in defaults are used.

```yaml
database:
  host: 127.0.0.1
  port: 5432
  name: dml_utils
  user: postgres
  passwordEnv: VIEWER_DB_PASSWORD # password is read from this env var, never the file
  ssl: false

schema: dml_utils_data # holds migration_run, migration_boundary and migration_error

server:
  host: 127.0.0.1
  port: 3220
  pageSize: 25
  maxPageSize: 200
```

## Running

```sh
npm install
VIEWER_DB_PASSWORD=postgres npm start
```

Then open <http://127.0.0.1:3220>.

To start it against the local `dml_utils` development database, use the helper
script (it supplies that database's password for you) and stop it again with the
matching script:

```sh
scripts/run-local.sh    # records its PID for stop-local.sh
scripts/stop-local.sh
```

A different configuration file can be selected either way:

```sh
VIEWER_DB_PASSWORD=secret npm start -- --config config/prod.yaml
scripts/run-local.sh --config config/prod.yaml
```

## Development

```sh
npm run dev          # node --watch
npm run lint
npm run format
npm test             # unit tests; integration tests run when VIEWER_DB_PASSWORD is set
```

Integration tests point at the configured database. To run them against the
local `dml_utils` development database:

```sh
VIEWER_DB_PASSWORD=postgres npm test
```

## HTTP API

| Method | Path                       | Description                                             |
| ------ | -------------------------- | ------------------------------------------------------- |
| GET    | `/api/config`              | Display target and page-size settings (no credentials). |
| GET    | `/api/runs`                | Paginated migration runs.                               |
| GET    | `/api/runs/:id`            | One run and its counts.                                 |
| GET    | `/api/runs/:id/boundaries` | Paginated boundaries of a run.                          |
| GET    | `/api/runs/:id/errors`     | Errors recorded for a run.                              |
| GET    | `/api/errors`              | Paginated errors across runs.                           |

## Security notes

- The database password is read only from the environment variable named by
  `database.passwordEnv`; it is never written to disk.
- Schema names from the config or the query are validated and quoted; filter
  values are bound parameters.
- The server binds to `127.0.0.1` by default. Exposing it beyond localhost is at
  your own risk — there is no authentication.
