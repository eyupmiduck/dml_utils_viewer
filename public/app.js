// The front end is plain ES modules driven by a tiny hash router, so there is
// no build step. Views live in the `views` object; `render()` dispatches on the
// current route (#/runs, #/runs/:id, #/errors).

const API = {
  config: '/api/config',
};

const state = {
  schema: '',
  defaults: { schema: '' },
  pageSize: 25,
  maxPageSize: 200,
  connection: '',
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

// Views are registered here as they are implemented; an unknown route falls
// back to the runs list.
const views = {};

async function render() {
  clearError();
  const [name = 'runs', ...rest] = currentRoute();
  const view = views[name] ?? views.runs;
  setActiveNav(name);
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
  state.pageSize = config.server.pageSize;
  state.maxPageSize = config.server.maxPageSize;
  state.schema = config.schema;
  elements.schemaInput.value = config.schema;
  elements.target.textContent = `${config.connection} · ${config.schema}`;
}

elements.targetForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const schema = elements.schemaInput.value.trim();
  if (schema === '') return;
  state.schema = schema;
  elements.target.textContent = `${state.connection} · ${schema}`;
  render();
});

elements.targetReset.addEventListener('click', () => {
  state.schema = state.defaults.schema;
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
