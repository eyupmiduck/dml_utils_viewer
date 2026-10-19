// The front end is plain ES modules driven by a tiny hash router, so there is
// no build step. Each screen is a function under `views`; `render()` dispatches
// on the current route (#/runs, #/runs/:id, #/errors).

const API = {
  config: '/api/config',
  runs: '/api/runs',
};

const state = {
  connection: '',
  schema: '',
  defaults: { schema: '' },
  maxPageSize: 200,
  runs: { page: 1, pageSize: 25, sort: 'run_id', dir: 'desc', pages: 1, total: 0, filters: {} },
};

const elements = {
  target: document.getElementById('target'),
  nav: document.getElementById('nav'),
  targetForm: document.getElementById('target-form'),
  targetReset: document.getElementById('target-reset'),
  schemaInput: document.querySelector('#target-form input[name="schema"]'),
  view: document.getElementById('view'),
  error: document.getElementById('error'),
  errorText: document.getElementById('error-text'),
  errorClose: document.getElementById('error-close'),
};

/** Creates an element: `class`/`text` become properties, `on*` become listeners. */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child !== null && child !== undefined && child !== false) node.append(child);
  }
  return node;
}

async function api(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body.error) message = body.error;
    } catch {
      // keep the status text
    }
    throw new Error(message);
  }
  return response.json();
}

function showError(error) {
  elements.errorText.textContent = error.message;
  elements.error.hidden = false;
}

function clearError() {
  elements.errorText.textContent = '';
  elements.error.hidden = true;
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function formatNumber(value) {
  return value === null || value === undefined ? '' : String(value);
}

function cell(text, className) {
  return el('td', { class: className, text: text ?? '' });
}

function badge(value) {
  return value ? el('span', { class: `badge ${value}`, text: value }) : '';
}

function progressBar(completed, total) {
  const done = Number(completed) || 0;
  const all = Number(total) || 0;
  const pct = all > 0 ? Math.round((done / all) * 100) : 0;
  const fill = el('span');
  fill.style.width = `${pct}%`;
  return el('div', { class: 'progress' }, [
    el('div', { class: 'bar' }, [fill]),
    el('span', { class: 'pct', text: `${done}/${all}` }),
  ]);
}

// The current route, for example ['runs'] or ['runs', '42'].
function currentRoute() {
  const hash = window.location.hash.replace(/^#\/?/, '');
  return hash.split('/').filter(Boolean);
}

function setActiveNav(name) {
  for (const link of elements.nav.querySelectorAll('a[data-view]')) {
    link.classList.toggle('active', link.dataset.view === name);
  }
}

/** A labelled form field for the filter bars. */
function field(labelText, control) {
  return el('label', {}, [el('span', { text: labelText }), control]);
}

function select(name, options, value) {
  const node = el(
    'select',
    { name },
    options.map(([optionValue, optionLabel]) =>
      el('option', { value: optionValue, text: optionLabel }),
    ),
  );
  node.value = value ?? '';
  return node;
}

/** Renders the pager and wires it to `onChange(page, pageSize)`. */
function pager(result, onChange) {
  const firstRow = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const lastRow = Math.min(result.page * result.pageSize, result.total);
  const summary = el('span', {
    class: 'summary',
    text: `${firstRow}–${lastRow} of ${result.total}`,
  });

  const size = select(
    'pageSize',
    [
      ['10', '10'],
      ['25', '25'],
      ['50', '50'],
      ['100', '100'],
    ],
    String(result.pageSize),
  );
  size.addEventListener('change', () => onChange(1, Number(size.value)));

  const first = el('button', {
    type: 'button',
    text: '« First',
    onclick: () => onChange(1, result.pageSize),
  });
  const prev = el('button', {
    type: 'button',
    text: '‹ Prev',
    onclick: () => onChange(result.page - 1, result.pageSize),
  });
  const next = el('button', {
    type: 'button',
    text: 'Next ›',
    onclick: () => onChange(result.page + 1, result.pageSize),
  });
  const last = el('button', {
    type: 'button',
    text: 'Last »',
    onclick: () => onChange(result.pages, result.pageSize),
  });
  first.disabled = result.page <= 1;
  prev.disabled = result.page <= 1;
  next.disabled = result.page >= result.pages;
  last.disabled = result.page >= result.pages;

  return el('div', { class: 'pager' }, [
    summary,
    el('div', { class: 'pager-controls' }, [
      field('Rows', size),
      first,
      prev,
      el('span', { class: 'page-label', text: `Page ${result.page} of ${result.pages}` }),
      next,
      last,
    ]),
  ]);
}

function table(headers, rows) {
  const thead = el('thead', {}, [
    el(
      'tr',
      {},
      headers.map((header) => header.node ?? el('th', { text: header })),
    ),
  ]);
  const tbody = el('tbody', {}, rows);
  // A link element inside a header cell, for a sortable column.
  return el('table', {}, [thead, tbody]);
}

function sortableHeader(label, column, runs, reload, className) {
  const th = el('th', {
    class: className,
    'data-sort': column,
    text: label,
    onclick: () => {
      if (runs.sort === column) {
        runs.dir = runs.dir === 'asc' ? 'desc' : 'asc';
      } else {
        runs.sort = column;
        runs.dir = 'desc';
      }
      runs.page = 1;
      reload();
    },
  });
  if (runs.sort === column) th.classList.add(runs.dir);
  return { node: th };
}

async function renderRuns() {
  const runs = state.runs;
  const params = new URLSearchParams({
    schema: state.schema,
    page: String(runs.page),
    pageSize: String(runs.pageSize),
    sort: runs.sort,
    dir: runs.dir,
  });
  for (const [key, value] of Object.entries(runs.filters)) {
    if (value) params.set(key, value);
  }

  const result = await api(`${API.runs}?${params}`);
  runs.page = result.page;
  runs.pageSize = result.pageSize;
  runs.pages = result.pages;
  runs.total = result.total;

  const reload = () => renderRuns().catch(showError);
  const onChange = (page, pageSize) => {
    runs.page = Math.min(Math.max(1, page), runs.pages);
    if (pageSize) runs.pageSize = pageSize;
    reload();
  };

  const filters = el('form', { class: 'filters', autocomplete: 'off' }, [
    field(
      'Label',
      el('input', {
        name: 'label',
        type: 'text',
        placeholder: 'contains',
        value: runs.filters.label ?? '',
      }),
    ),
    field(
      'Strategy',
      select(
        'chunk_by',
        [
          ['', 'Any'],
          ['primary_key', 'primary_key'],
          ['blocks', 'blocks'],
        ],
        runs.filters.chunk_by,
      ),
    ),
    field(
      'State',
      select(
        'state',
        [
          ['all', 'All'],
          ['pending', 'Pending'],
          ['running', 'Running'],
          ['completed', 'Completed'],
          ['archived', 'Archived'],
        ],
        runs.filters.state ?? 'all',
      ),
    ),
    field(
      'Created from',
      el('input', { name: 'from', type: 'date', value: runs.filters.from ?? '' }),
    ),
    field('Created to', el('input', { name: 'to', type: 'date', value: runs.filters.to ?? '' })),
    el('div', { class: 'filters-actions' }, [
      el('button', { type: 'submit', text: 'Apply' }),
      el('button', {
        type: 'button',
        class: 'ghost',
        text: 'Clear',
        onclick: () => {
          runs.filters = {};
          runs.page = 1;
          reload();
        },
      }),
    ]),
  ]);
  filters.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(filters);
    runs.filters = {
      label: data.get('label').trim(),
      chunk_by: data.get('chunk_by'),
      state: data.get('state'),
      from: data.get('from'),
      to: data.get('to'),
    };
    runs.page = 1;
    reload();
  });

  const headers = [
    sortableHeader('Run', 'run_id', runs, reload, 'num'),
    sortableHeader('Label', 'label', runs, reload),
    'Strategy',
    'Size',
    'Threads',
    'Driving table',
    sortableHeader('Progress', 'total_chunks_completed', runs, reload),
    'State',
    sortableHeader('Created', 'created_at', runs, reload),
    sortableHeader('Started', 'started_at', runs, reload),
    sortableHeader('Completed', 'completed_at', runs, reload),
  ];

  const rows = result.rows.map((row) =>
    el('tr', {}, [
      cell(
        el('a', { class: 'run-link', href: `#/runs/${row.run_id}`, text: String(row.run_id) }),
        'num',
      ),
      cell(row.label),
      cell(row.chunk_by, 'mono'),
      cell(formatNumber(row.chunk_size), 'num'),
      cell(formatNumber(row.threads), 'num'),
      cell(`${row.driving_table_schema_name}.${row.driving_table_name}`, 'mono'),
      el('td', {}, [progressBar(row.total_chunks_completed, row.total_chunks)]),
      el('td', {}, [badge(row.state)]),
      cell(formatDateTime(row.created_at)),
      cell(formatDateTime(row.started_at)),
      cell(formatDateTime(row.completed_at)),
    ]),
  );

  const panel = el('section', { class: 'panel' }, [
    filters,
    el('div', { class: 'table-wrap' }, [table(headers, rows)]),
    result.total === 0 ? el('p', { class: 'empty', text: 'No runs match the filters.' }) : '',
    pager(result, onChange),
  ]);

  elements.view.replaceChildren(panel);
}

// Screens are registered here; an unknown route falls back to the runs list.
const views = {
  runs: renderRuns,
};

async function render() {
  clearError();
  const [name = 'runs', ...rest] = currentRoute();
  const view = views[name] ?? views.runs;
  setActiveNav(views[name] ? name : 'runs');
  try {
    await view(rest);
  } catch (error) {
    showError(error);
  }
}

async function loadConfig() {
  const config = await api(API.config);
  state.connection = config.connection;
  state.defaults = { schema: config.schema };
  state.schema = config.schema;
  state.runs.pageSize = config.server.pageSize;
  state.maxPageSize = config.server.maxPageSize;
  elements.schemaInput.value = config.schema;
  elements.target.textContent = `${config.connection} · ${config.schema}`;
}

elements.targetForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const schema = elements.schemaInput.value.trim();
  if (schema === '') return;
  state.schema = schema;
  state.runs.page = 1;
  elements.target.textContent = `${state.connection} · ${schema}`;
  render();
});

elements.targetReset.addEventListener('click', () => {
  state.schema = state.defaults.schema;
  state.runs.page = 1;
  elements.schemaInput.value = state.defaults.schema;
  elements.target.textContent = `${state.connection} · ${state.defaults.schema}`;
  render();
});

elements.errorClose.addEventListener('click', clearError);
window.addEventListener('hashchange', render);

async function main() {
  await loadConfig();
  await render();
}

main().catch((error) => showError(error));
