// The front end is plain ES modules driven by a tiny hash router, so there is
// no build step. Each screen is a function under `views`; `render()` dispatches
// on the current route (#/runs, #/runs/:id, #/errors).

const API = {
  config: '/api/config',
  runs: '/api/runs',
  errors: '/api/errors',
};

const state = {
  maxPageSize: 200,
  runs: { page: 1, pageSize: 25, sort: 'run_id', dir: 'desc', pages: 1, total: 0, filters: {} },
  boundaries: { runId: null, page: 1, pageSize: 25 },
  errors: { page: 1, pageSize: 25, sort: 'error_id', dir: 'desc', pages: 1, total: 0, filters: {} },
};

const elements = {
  target: document.getElementById('target'),
  nav: document.getElementById('nav'),
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

function cell(value, className) {
  const td = el('td', { class: className });
  if (value instanceof Node) {
    td.append(value);
  } else {
    td.textContent = value ?? '';
  }
  return td;
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
    (() => {
      const options = ['10', '25', '50', '100'];
      const current = String(result.pageSize);
      if (!options.includes(current)) options.unshift(current);
      return options.map((value) => [value, value]);
    })(),
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
  const applySort = () => {
    if (runs.sort === column) {
      runs.dir = runs.dir === 'asc' ? 'desc' : 'asc';
    } else {
      runs.sort = column;
      runs.dir = 'desc';
    }
    runs.page = 1;
    reload();
  };
  const th = el('th', {
    class: className,
    'data-sort': column,
    role: 'button',
    tabindex: '0',
    text: label,
    onclick: applySort,
    onkeydown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        applySort();
      }
    },
  });
  if (runs.sort === column) {
    th.setAttribute('aria-sort', runs.dir === 'asc' ? 'ascending' : 'descending');
  }
  return { node: th };
}

async function renderRuns(token) {
  const runs = state.runs;
  const params = new URLSearchParams({
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

  const reload = () => renderRuns(token).then(clearError).catch(showError);
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
          ['cancelled', 'Cancelled'],
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
    { node: el('th', { class: 'num', text: 'Size' }) },
    { node: el('th', { class: 'num', text: 'Threads' }) },
    { node: el('th', { class: 'num', text: 'Sleep (ms)' }) },
    'Driving table',
    sortableHeader('Progress', 'total_chunks_completed', runs, reload),
    'State',
    sortableHeader('Created', 'created_at', runs, reload),
    sortableHeader('Started', 'started_at', runs, reload),
    sortableHeader('Completed', 'completed_at', runs, reload),
    sortableHeader('Cancelled', 'cancelled_at', runs, reload),
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
      cell(formatNumber(row.sleep_ms), 'num'),
      cell(`${row.driving_table_schema_name}.${row.driving_table_name}`, 'mono'),
      el('td', {}, [progressBar(row.total_chunks_completed, row.total_chunks)]),
      el('td', {}, [badge(row.state)]),
      cell(formatDateTime(row.created_at)),
      cell(formatDateTime(row.started_at)),
      cell(formatDateTime(row.completed_at)),
      cell(formatDateTime(row.cancelled_at)),
    ]),
  );

  const panel = el('section', { class: 'panel' }, [
    filters,
    el('div', { class: 'table-wrap' }, [table(headers, rows)]),
    result.total === 0 ? el('p', { class: 'empty', text: 'No runs match the filters.' }) : '',
    pager(result, onChange),
  ]);

  if (token !== renderToken) return;
  elements.view.replaceChildren(panel);
}

/** Renders a migration_key from its position-aligned value arrays. */
function formatKey(row, prefix = '') {
  const arrays = [
    row[`${prefix}bigint_values`],
    row[`${prefix}text_values`],
    row[`${prefix}uuid_values`],
  ];
  const length = arrays.reduce((max, array) => Math.max(max, array?.length ?? 0), 0);
  const parts = [];
  for (let index = 0; index < length; index += 1) {
    const value = arrays
      .map((array) => (array ? array[index] : undefined))
      .find((candidate) => candidate !== undefined && candidate !== null);
    parts.push(value === undefined ? '' : String(value));
  }
  return `(${parts.join(', ')})`;
}

function detailList(pairs) {
  const list = el('dl', { class: 'detail-grid' });
  for (const [label, value] of pairs) {
    list.append(
      el('div', { class: 'detail-item' }, [
        el('dt', { text: label }),
        el('dd', { text: value ?? '' }),
      ]),
    );
  }
  return list;
}

async function renderRunDetail(id, token) {
  // Reset the boundary pager when switching to another run, so a page that was
  // valid for the previous run cannot carry over.
  if (state.boundaries.runId !== id) {
    state.boundaries.runId = id;
    state.boundaries.page = 1;
  }
  const boundaries = state.boundaries;
  const [detail, boundaryPage, errorPage] = await Promise.all([
    api(`${API.runs}/${id}`),
    api(`${API.runs}/${id}/boundaries?page=${boundaries.page}&pageSize=${boundaries.pageSize}`),
    api(`${API.runs}/${id}/errors?pageSize=${state.maxPageSize}`),
  ]);

  const { run, counts } = detail;
  const reload = () => renderRunDetail(id, token).then(clearError).catch(showError);

  const summary = el('section', { class: 'panel' }, [
    el('p', {}, [el('a', { class: 'run-link', href: '#/runs', text: '← Runs' })]),
    el('h2', { class: 'section-title' }, [
      el('span', { text: `Run ${run.run_id} · ${run.label} ` }),
      badge(run.state),
    ]),
    detailList([
      ['Strategy', run.chunk_by],
      ['Chunk size', run.chunk_size],
      ['Threads', run.threads],
      ['Sleep (ms)', run.sleep_ms],
      ['Driving table', `${run.driving_table_schema_name}.${run.driving_table_name}`],
      ['Alias', run.driving_table_alias],
      ['Relation filepath', run.driving_table_relation_filepath],
      ['Chunks', `${run.total_chunks_completed}/${run.total_chunks}`],
      ['Boundaries', `${counts.boundaries_completed}/${counts.boundaries}`],
      ['Errors', counts.errors],
      ['Created', formatDateTime(run.created_at)],
      ['Started', formatDateTime(run.started_at)],
      ['Boundaries calculated', formatDateTime(run.boundaries_calculated_at)],
      ['Completed', formatDateTime(run.completed_at)],
      ['Cancelled', formatDateTime(run.cancelled_at)],
      ['Archived', formatDateTime(run.archived_at)],
    ]),
    el('h3', { class: 'section-title', text: 'SQL' }),
    el('pre', { class: 'sql-text', text: run.sql_text }),
  ]);

  const boundaryRows = boundaryPage.rows.map((row) =>
    el('tr', {}, [
      cell(
        row.is_chunk
          ? el('a', {
              class: 'run-link',
              href: `#/runs/${run.run_id}/chunks/${row.boundary_no}`,
              text: String(row.boundary_no),
            })
          : el('span', {
              text: String(row.boundary_no),
              title: 'Terminal high-water boundary; there is no chunk to explain.',
            }),
        'num',
      ),
      cell(formatKey(row), 'mono'),
      el('td', {}, [badge(row.state)]),
      cell(formatDateTime(row.started_at)),
      cell(formatDateTime(row.completed_at)),
      cell(formatDateTime(row.cancelled_at)),
    ]),
  );
  const boundariesSection = el('section', { class: 'panel' }, [
    el('h3', { class: 'section-title', text: `Boundaries (${boundaryPage.completed} completed)` }),
    el('div', { class: 'table-wrap' }, [
      table(['#', 'Key', 'State', 'Started', 'Completed', 'Cancelled'], boundaryRows),
    ]),
    boundaryPage.total === 0
      ? el('p', { class: 'empty', text: 'No boundaries for this run.' })
      : pager(boundaryPage, (page, pageSize) => {
          state.boundaries.page = Math.min(Math.max(1, page), boundaryPage.pages);
          if (pageSize) state.boundaries.pageSize = pageSize;
          reload();
        }),
    run.total_chunks > 0
      ? el('p', {
          class: 'empty',
          text: 'Select a chunk number to view its details and EXPLAIN plan.',
        })
      : '',
  ]);

  const errorRows = errorPage.rows.map((row) =>
    el('tr', {}, [
      cell(row.error_id, 'num'),
      cell(row.boundary_no, 'num'),
      cell(row.sqlstate, 'mono'),
      cell(row.message),
      cell(formatDateTime(row.created_at)),
    ]),
  );
  const errorsSection = el('section', { class: 'panel' }, [
    el('h3', { class: 'section-title', text: `Errors (${errorPage.total})` }),
    errorPage.total === 0
      ? el('p', { class: 'empty', text: 'No errors recorded for this run.' })
      : el('div', {}, [
          el('div', { class: 'table-wrap' }, [
            table(['Error', 'Boundary', 'SQLSTATE', 'Message', 'Created'], errorRows),
          ]),
          errorPage.total > errorPage.rows.length
            ? el('p', {
                class: 'empty',
                text: `Showing the first ${errorPage.rows.length} of ${errorPage.total} errors; see the Errors screen for the rest.`,
              })
            : '',
        ]),
  ]);

  if (token !== renderToken) return;
  elements.view.replaceChildren(summary, boundariesSection, errorsSection);
}

const PLAN_LABELS = {
  chunk_non_final: 'Chunk (non-final)',
  chunk_final: 'Chunk (final)',
  boundary_population: 'Boundary population',
};

function planLabel(kind) {
  return PLAN_LABELS[kind] ?? kind ?? 'Plan';
}

function parsePlan(value) {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

function planDocument(value) {
  const parsed = parsePlan(value);
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  return first && typeof first === 'object' ? first : null;
}

const PLAN_DETAIL_FIELDS = [
  ['Relation', 'Relation Name'],
  ['Schema', 'Schema'],
  ['Alias', 'Alias'],
  ['Index', 'Index Name'],
  ['Filter', 'Filter'],
  ['Index condition', 'Index Cond'],
  ['Hash condition', 'Hash Cond'],
  ['Join filter', 'Join Filter'],
  ['Merge condition', 'Merge Cond'],
  ['Recheck condition', 'Recheck Cond'],
  ['Sort key', 'Sort Key'],
  ['Group key', 'Group Key'],
  ['Rows removed by filter', 'Rows Removed by Filter'],
  ['Heap fetches', 'Heap Fetches'],
  ['Workers planned', 'Workers Planned'],
  ['Workers launched', 'Workers Launched'],
];

/** Renders one EXPLAIN JSON plan node and its children as an indented tree. */
function planNode(node) {
  const title = [
    node['Node Type'],
    node['Join Type'],
    node['Relation Name'] ? `on ${node['Relation Name']}` : '',
    node['Index Name'] ? `using ${node['Index Name']}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const metrics = [];
  if (node['Startup Cost'] !== undefined && node['Total Cost'] !== undefined) {
    metrics.push(`cost ${node['Startup Cost']}..${node['Total Cost']}`);
  }
  if (node['Plan Rows'] !== undefined) metrics.push(`rows ${node['Plan Rows']}`);
  if (node['Plan Width'] !== undefined) metrics.push(`width ${node['Plan Width']}`);
  if (node['Actual Total Time'] !== undefined) {
    metrics.push(`actual ${node['Actual Total Time']} ms`);
  }
  if (node['Actual Rows'] !== undefined) metrics.push(`actual rows ${node['Actual Rows']}`);
  if (node['Actual Loops'] !== undefined) metrics.push(`loops ${node['Actual Loops']}`);
  const details = PLAN_DETAIL_FIELDS.filter(
    ([, key]) => node[key] !== undefined && node[key] !== null,
  );
  const children = Array.isArray(node.Plans) ? node.Plans.map((child) => planNode(child)) : [];

  return el('div', { class: 'plan-node' }, [
    el('div', { class: 'plan-node-head' }, [
      el('span', { class: 'plan-node-type', text: title || 'Plan' }),
      metrics.length ? el('span', { class: 'plan-node-meta', text: metrics.join(' · ') }) : '',
    ]),
    details.length
      ? el(
          'dl',
          { class: 'plan-node-details' },
          details.flatMap(([label, key]) => [
            el('dt', { text: label }),
            el('dd', { text: String(node[key]) }),
          ]),
        )
      : '',
    children.length ? el('div', { class: 'plan-children' }, children) : '',
  ]);
}

function planText(value) {
  const parsed = parsePlan(value) ?? value;
  if (parsed === undefined || parsed === null) return '';
  if (typeof parsed === 'string') return parsed;
  return JSON.stringify(parsed, null, 2);
}

function planView(value) {
  const planDoc = planDocument(value);
  if (planDoc === null || planDoc.Plan === undefined) {
    return el('pre', { class: 'sql-text', text: planText(value) });
  }
  const timing = [];
  if (planDoc['Planning Time'] !== undefined) {
    timing.push(`Planning ${planDoc['Planning Time']} ms`);
  }
  if (planDoc['Execution Time'] !== undefined) {
    timing.push(`Execution ${planDoc['Execution Time']} ms`);
  }
  return el('div', { class: 'plan' }, [
    timing.length ? el('p', { class: 'plan-timing', text: timing.join(' · ') }) : '',
    planNode(planDoc.Plan),
    el('details', { class: 'plan-raw' }, [
      el('summary', { text: 'Raw JSON' }),
      el('pre', { class: 'sql-text', text: planText(value) }),
    ]),
  ]);
}

function plansSection(rows, planError, planErrorCode, planScope) {
  const section = el('section', { class: 'panel' }, [
    el('h3', { class: 'section-title', text: 'EXPLAIN plan' }),
  ]);
  if (planError) {
    section.append(
      el('p', {
        class: 'empty',
        text: `Plan unavailable: ${planError}${planErrorCode ? ` (SQLSTATE ${planErrorCode})` : ''}`,
      }),
    );
    return section;
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    section.append(el('p', { class: 'empty', text: 'No plan returned.' }));
    return section;
  }
  if (planScope === 'representative') {
    section.append(
      el('p', {
        class: 'plan-note',
        text: 'Representative plans for a blocks-strategy run: block chunks are physical ctid ranges, so these plans use synthetic ranges.',
      }),
    );
  }
  for (const row of rows) {
    section.append(
      el('div', { class: 'plan-block' }, [
        el('h4', { class: 'plan-title', text: planLabel(row.o_plan_kind) }),
        el('details', {}, [
          el('summary', { text: 'SQL' }),
          el('pre', { class: 'sql-text', text: row.o_sql_text }),
        ]),
        planView(row.o_plan),
      ]),
    );
  }
  return section;
}

async function renderChunkDetail(runId, boundaryNo, token) {
  const detail = await api(`${API.runs}/${runId}/chunks/${boundaryNo}`);
  const { run, boundary, plan, planError, planErrorCode, planScope } = detail;
  const isBlocks = run.chunk_by === 'blocks';
  const summary = el('section', { class: 'panel' }, [
    el('p', {}, [
      el('a', { class: 'run-link', href: `#/runs/${run.run_id}`, text: `← Run ${run.run_id}` }),
    ]),
    el('h2', { class: 'section-title' }, [
      el('span', { text: `Chunk ${boundary.boundary_no} · ${run.label} ` }),
      badge(boundary.state),
    ]),
    detailList([
      ['Run', run.run_id],
      ['Run state', run.state],
      ['Run cancelled', formatDateTime(run.cancelled_at)],
      ['Strategy', run.chunk_by],
      ['Chunk size', run.chunk_size],
      ['Sleep (ms)', run.sleep_ms],
      ['Driving table', `${run.driving_table_schema_name}.${run.driving_table_name}`],
      ['Alias', run.driving_table_alias],
      [isBlocks ? 'Start block' : 'Start key', formatKey(boundary)],
      [
        isBlocks ? 'End block' : 'End key',
        boundary.next_boundary_no === null || boundary.next_boundary_no === undefined
          ? '— (no following boundary)'
          : formatKey(boundary, 'next_'),
      ],
      ['Started', formatDateTime(boundary.started_at)],
      ['Completed', formatDateTime(boundary.completed_at)],
      ['Cancelled', formatDateTime(boundary.cancelled_at)],
    ]),
  ]);

  if (token !== renderToken) return;
  elements.view.replaceChildren(summary, plansSection(plan, planError, planErrorCode, planScope));
}

async function renderRunsView(rest, token) {
  if (rest.length >= 3 && rest[1] === 'chunks') {
    await renderChunkDetail(rest[0], rest[2], token);
    return;
  }
  if (rest.length > 0) {
    await renderRunDetail(rest[0], token);
    return;
  }
  await renderRuns(token);
}

async function renderErrors(token) {
  const errors = state.errors;
  const params = new URLSearchParams({
    page: String(errors.page),
    pageSize: String(errors.pageSize),
    sort: errors.sort,
    dir: errors.dir,
  });
  for (const [key, value] of Object.entries(errors.filters)) {
    if (value) params.set(key, value);
  }

  const result = await api(`${API.errors}?${params}`);
  errors.page = result.page;
  errors.pageSize = result.pageSize;
  errors.pages = result.pages;
  errors.total = result.total;

  const reload = () => renderErrors(token).then(clearError).catch(showError);
  const onChange = (page, pageSize) => {
    errors.page = Math.min(Math.max(1, page), errors.pages);
    if (pageSize) errors.pageSize = pageSize;
    reload();
  };

  const filters = el('form', { class: 'filters', autocomplete: 'off' }, [
    field(
      'Run id',
      el('input', {
        name: 'run_id',
        type: 'text',
        inputmode: 'numeric',
        pattern: '\\d*',
        title: 'Run id must be digits',
        placeholder: 'exact',
        value: errors.filters.run_id ?? '',
      }),
    ),
    field(
      'SQLSTATE',
      el('input', {
        name: 'sqlstate',
        type: 'text',
        placeholder: 'contains',
        value: errors.filters.sqlstate ?? '',
      }),
    ),
    field(
      'Message',
      el('input', {
        name: 'message',
        type: 'text',
        placeholder: 'contains',
        value: errors.filters.message ?? '',
      }),
    ),
    field(
      'Created from',
      el('input', { name: 'from', type: 'date', value: errors.filters.from ?? '' }),
    ),
    field('Created to', el('input', { name: 'to', type: 'date', value: errors.filters.to ?? '' })),
    el('div', { class: 'filters-actions' }, [
      el('button', { type: 'submit', text: 'Apply' }),
      el('button', {
        type: 'button',
        class: 'ghost',
        text: 'Clear',
        onclick: () => {
          errors.filters = {};
          errors.page = 1;
          reload();
        },
      }),
    ]),
  ]);
  filters.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(filters);
    errors.filters = {
      run_id: data.get('run_id').trim(),
      sqlstate: data.get('sqlstate').trim(),
      message: data.get('message').trim(),
      from: data.get('from'),
      to: data.get('to'),
    };
    if (errors.filters.run_id !== '' && !/^\d+$/.test(errors.filters.run_id)) {
      showError(new Error('Run id must be digits.'));
      return;
    }
    errors.page = 1;
    reload();
  });

  const headers = [
    sortableHeader('Error', 'error_id', errors, reload, 'num'),
    sortableHeader('Run', 'run_id', errors, reload, 'num'),
    'Label',
    sortableHeader('Boundary', 'boundary_no', errors, reload, 'num'),
    'SQLSTATE',
    'Message',
    sortableHeader('Created', 'created_at', errors, reload),
  ];

  const rows = result.rows.map((row) =>
    el('tr', {}, [
      cell(row.error_id, 'num'),
      cell(
        el('a', { class: 'run-link', href: `#/runs/${row.run_id}`, text: String(row.run_id) }),
        'num',
      ),
      cell(row.run_label),
      cell(row.boundary_no, 'num'),
      cell(row.sqlstate, 'mono'),
      cell(row.message),
      cell(formatDateTime(row.created_at)),
    ]),
  );

  const panel = el('section', { class: 'panel' }, [
    filters,
    el('div', { class: 'table-wrap' }, [table(headers, rows)]),
    result.total === 0 ? el('p', { class: 'empty', text: 'No errors match the filters.' }) : '',
    pager(result, onChange),
  ]);

  if (token !== renderToken) return;
  elements.view.replaceChildren(panel);
}

// Screens are registered here; an unknown route falls back to the runs list.
const views = {
  runs: renderRunsView,
  errors: renderErrors,
};

// Incremented on every render so a slower, older response cannot replace a
// newer screen.
let renderToken = 0;

async function render() {
  const token = (renderToken += 1);
  clearError();
  const [name = 'runs', ...rest] = currentRoute();
  const view = views[name] ?? views.runs;
  setActiveNav(views[name] ? name : 'runs');
  try {
    await view(rest, token);
  } catch (error) {
    if (token === renderToken) showError(error);
  }
}

async function loadConfig() {
  const config = await api(API.config);
  state.runs.pageSize = config.server.pageSize;
  state.maxPageSize = config.server.maxPageSize;
  elements.target.textContent = `${config.connection} · ${config.schema}`;
}

elements.errorClose.addEventListener('click', clearError);
window.addEventListener('hashchange', render);

async function main() {
  // A failed config still renders with the built-in defaults, so the screen is
  // never left permanently empty; the error is shown after the render (which
  // clears the toast).
  const configError = await loadConfig().then(
    () => null,
    (error) => error,
  );
  await render();
  if (configError) showError(configError);
}

main().catch((error) => showError(error));
