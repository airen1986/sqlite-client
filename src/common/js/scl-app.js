/**
 * SQLite client main application logic.
 *
 * Uses template utilities:
 *   - dom.js ($, on) for DOM helpers
 *   - toast.js (toastSuccess, toastError, toastInfo) for SweetAlert2 toasts
 *   - Bootstrap Tab / Modal components
 */

import { $, on } from './dom';
import { toastSuccess, toastError, toastInfo, confirm } from './toast';
import {
  listDatabases,
  deleteFromOPFS,
  opfsPath,
  copyToClipboard,
  resultsToTSV,
  resultsToCSV,
  downloadCSV,
  downloadBlob,
  rowToCSVLine,
  getHistory,
  addToHistory,
  getSettings,
  saveSettings,
} from './scl-utils';

// ===== State =====
let currentDb = null;
let lastColumns = null;
let lastRows = null;
let renderedRowsCount = 0;
let lazyRows = null;
let msgIdCounter = 0;
const pendingMessages = new Map();
const RESULTS_CHUNK_SIZE = 1000;

// ===== Editor Tabs State =====
let tabIdCounter = 0;
const editorTabs = []; // [{ id, title, sql }]
let activeTabId = null;

// ===== Worker =====
const worker = new Worker('/js/sqlite-worker.js', { type: 'module' });

worker.onmessage = (e) => {
  const { id, error } = e.data;
  const pending = pendingMessages.get(id);
  if (pending) {
    pendingMessages.delete(id);
    if (error) pending.reject(new Error(error));
    else pending.resolve(e.data.result);
  }
};

worker.onerror = (e) => {
  setStatus('Worker error: ' + (e.message || 'Unknown error'), true);
};

function sendWorker(type, payload = {}, transferables = []) {
  return new Promise((resolve, reject) => {
    const id = ++msgIdCounter;
    pendingMessages.set(id, { resolve, reject });
    worker.postMessage({ id, type, payload }, transferables);
  });
}

// ===== DOM refs =====
const dbList = $('#db-list');
const dbEmpty = $('#db-empty');
const dbUpload = $('#db-upload');
const objectsSection = $('#objects-section');
const tableList = $('#table-list');
const viewList = $('#view-list');
const historyEmpty = $('#history-empty');
const historyTableWrap = $('#history-table-wrap');
const historyTbody = $('#history-tbody');
const sqlEditor = $('#sql-editor');
const runBtn = $('#run-btn');
const clearBtn = $('#clear-btn');
const editorTabsUl = $('#editor-tabs');
const addTabBtn = $('#add-tab-btn');
const statusText = $('#status-text');
const resultsToolbar = $('#results-toolbar');
const copyResultsBtn = $('#copy-results-btn');
const exportCsvBtn = $('#export-csv-btn');
const rowCount = $('#row-count');
const resultsPlaceholder = $('#results-placeholder');
const resultsContainer = $('#results-container');
const resultsTableWrap = $('#results-table-wrap');
const resultsThead = $('#results-thead');
const resultsTbody = $('#results-tbody');
const resultsMessage = $('#results-message');
const ddlObjectName = $('#ddl-object-name');
const ddlCode = $('#ddl-code');
const ddlCopyBtn = $('#ddl-copy-btn');
const ddlCountBtn = $('#ddl-count-btn');
const ddlExportCsvBtn = $('#ddl-export-csv-btn');
const ddlQueryBtn = $('#ddl-query-btn');
const apiKeyInput = $('#api-key-input');
const saveSettingsBtn = $('#save-settings-btn');
const settingsModal = $('#settingsModal');

// Bootstrap Tab instances
const resultsTabEl = $('#results-tab');
const ddlTabEl = $('#ddl-tab');

// ===== Init =====
export async function init() {
  setStatus('Initializing SQLite...');
  try {
    const info = await sendWorker('init');
    setStatus(`SQLite ${info.version} | OPFS: ${info.opfsAvailable ? 'Yes' : 'No'}`);
    if (!info.opfsAvailable) {
      toastInfo("OPFS not available — databases won't persist");
    }
  } catch (err) {
    setStatus('Failed to init SQLite: ' + err.message, true);
    return;
  }
  addEditorTab(); // create the first default tab
  await refreshDbList();
  renderHistory();
  bindEvents();
}

// ===== Database List =====
async function refreshDbList() {
  try {
    const dbs = await listDatabases();
    dbList.innerHTML = '';
    dbEmpty.classList.toggle('d-none', dbs.length > 0);
    for (const name of dbs) {
      const li = document.createElement('li');
      li.className =
        'list-group-item d-flex align-items-center justify-content-between' +
        (name === currentDb ? ' active' : '');
      li.innerHTML = `<span class="db-name text-truncate" title="${esc(name)}">${esc(name)}</span>
        <button class="db-delete" title="Delete database"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>`;
      on(li.querySelector('.db-name'), 'click', () => selectDatabase(name));
      on(li.querySelector('.db-delete'), 'click', (e) => {
        e.stopPropagation();
        confirmDeleteDb(name);
      });
      dbList.appendChild(li);
    }
  } catch (err) {
    setStatus('Failed to list databases: ' + err.message, true);
  }
}

async function selectDatabase(name) {
  if (name === currentDb) return;
  setStatus(`Opening ${name}...`);
  try {
    await sendWorker('open', { filename: opfsPath(name) });
    currentDb = name;
    setStatus(`Connected: ${name}`);
    await refreshDbList();
    await refreshObjects();
    renderHistory();
    clearResults();
    showTab(resultsTabEl);
  } catch (err) {
    setStatus('Open failed: ' + err.message, true);
  }
}

async function confirmDeleteDb(name) {
  const result = await confirm(`Delete database "${name}"?`, 'This cannot be undone.');
  if (!result.isConfirmed) return;
  try {
    if (name === currentDb) {
      await sendWorker('close');
      currentDb = null;
      objectsSection.classList.add('d-none');
      clearResults();
      setStatus('');
    }
    await deleteFromOPFS(name);
    toastSuccess(`Deleted ${name}`);
    await refreshDbList();
  } catch (err) {
    toastError('Delete failed: ' + err.message);
  }
}

// ===== Upload =====
async function handleUpload(files) {
  for (const file of files) {
    setStatus(`Uploading ${file.name}...`);
    try {
      const buf = await file.arrayBuffer();
      // Import via worker using OpfsDb.importDb() which handles WAL-mode databases
      await sendWorker('import', { filename: opfsPath(file.name), buffer: buf }, [buf]);
      toastSuccess(`Uploaded ${file.name}`);
    } catch (err) {
      toastError(`Upload failed: ${file.name} — ${err.message}`);
    }
  }
  await refreshDbList();
  setStatus('');
  // Auto-select the first uploaded DB if none is open
  if (!currentDb && files.length > 0) {
    await selectDatabase(files[0].name);
  }
}

// ===== Objects =====
async function refreshObjects() {
  try {
    const { tables, views } = await sendWorker('get-objects');
    objectsSection.classList.remove('d-none');
    renderObjectList(tableList, tables);
    renderObjectList(viewList, views);
    $('#objects-views').classList.toggle('d-none', views.length === 0);
  } catch (err) {
    objectsSection.classList.add('d-none');
    setStatus('Failed to get objects: ' + err.message, true);
  }
}

function renderObjectList(ul, names) {
  ul.innerHTML = '';
  for (const name of names) {
    const li = document.createElement('li');
    li.className = 'list-group-item obj-item';
    li.textContent = name;
    on(li, 'click', () => showDDL(name));
    ul.appendChild(li);
  }
}

async function showDDL(objectName) {
  try {
    const { ddl } = await sendWorker('get-ddl', { name: objectName });
    ddlObjectName.textContent = objectName;
    ddlCode.textContent = ddl || '-- No DDL available';
    ddlCountBtn.innerHTML = '<i class="fa-solid fa-hashtag me-1" aria-hidden="true"></i>Count';
    showTab(ddlTabEl);
  } catch (err) {
    toastError('DDL error: ' + err.message);
  }
}

// ===== Editor Tabs =====
function addEditorTab(sql = '') {
  const id = ++tabIdCounter;
  const title = `Query ${id}`;
  editorTabs.push({ id, title, sql });
  switchEditorTab(id);
  renderEditorTabs();
  sqlEditor.focus();
}

function removeEditorTab(id) {
  if (editorTabs.length <= 1) return; // keep at least one tab
  const idx = editorTabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  editorTabs.splice(idx, 1);
  if (activeTabId === id) {
    // switch to nearest tab
    const next = editorTabs[Math.min(idx, editorTabs.length - 1)];
    switchEditorTab(next.id);
  }
  renderEditorTabs();
}

function switchEditorTab(id) {
  // save current tab's sql
  if (activeTabId !== null) {
    const cur = editorTabs.find((t) => t.id === activeTabId);
    if (cur) cur.sql = sqlEditor.value;
  }
  activeTabId = id;
  const tab = editorTabs.find((t) => t.id === id);
  if (tab) sqlEditor.value = tab.sql;
}

function renderEditorTabs() {
  editorTabsUl.innerHTML = '';
  for (const tab of editorTabs) {
    const li = document.createElement('li');
    li.className = 'nav-item';

    const btn = document.createElement('button');
    btn.className = 'nav-link editor-tab-btn' + (tab.id === activeTabId ? ' active' : '');
    btn.type = 'button';
    btn.textContent = tab.title;
    btn.title = tab.title;
    on(btn, 'click', () => {
      switchEditorTab(tab.id);
      renderEditorTabs();
      sqlEditor.focus();
    });

    li.appendChild(btn);

    if (editorTabs.length > 1) {
      const close = document.createElement('span');
      close.className = 'editor-tab-close';
      close.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
      close.title = 'Close tab';
      on(close, 'click', (e) => {
        e.stopPropagation();
        removeEditorTab(tab.id);
      });
      btn.appendChild(close);
    }

    editorTabsUl.appendChild(li);
  }
}

// ===== Query Execution =====
async function executeQuery() {
  const sql = sqlEditor.value.trim();
  if (!sql) return;
  if (!currentDb) {
    toastInfo('Open a database first');
    return;
  }

  showResultsLoader();
  setStatus('Executing...');
  runBtn.disabled = true;
  const start = performance.now();

  try {
    const result = await sendWorker('exec', { sql });
    const elapsed = ((performance.now() - start) / 1000).toFixed(3);

    if (result.type === 'rows') {
      lastColumns = result.columns;
      lastRows = result.rows;
      renderResultsTable(result.columns, result.rows);
      const statusMsg = `${result.rows.length} row${result.rows.length !== 1 ? 's' : ''} in ${elapsed}s`;
      setStatus(statusMsg);
      addToHistory(currentDb, sql, statusMsg);
    } else {
      lastColumns = null;
      lastRows = null;
      const statusMsg = `${result.changes} row(s) affected (${elapsed}s)`;
      showMessage(`Query OK. ${statusMsg}`);
      setStatus(statusMsg);
      addToHistory(currentDb, sql, statusMsg);
      // Refresh objects in case schema changed
      await refreshObjects();
    }
    renderHistory();
    showTab(resultsTabEl);
  } catch (err) {
    showMessage(err.message, true);
    setStatus('Error', true);
    addToHistory(currentDb, sql, err.message, true);
    renderHistory();
  } finally {
    runBtn.disabled = false;
  }
}

// ===== Results Rendering =====
function showResultsLoader() {
  lazyRows = null;
  renderedRowsCount = 0;
  resultsTableWrap.classList.add('d-none');
  resultsToolbar.classList.add('d-none');
  resultsToolbar.classList.remove('d-flex');
  resultsMessage.classList.add('d-none');
  resultsPlaceholder.classList.remove('d-none');
  resultsPlaceholder.className =
    'd-flex align-items-center justify-content-center gap-2 text-muted p-4';
  resultsPlaceholder.innerHTML =
    '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span><span>Running query...</span>';
}

function renderResultsTable(columns, rows) {
  resultsPlaceholder.className = 'text-center text-muted fst-italic p-4';
  resultsPlaceholder.textContent = 'Run a query to see results';
  resultsPlaceholder.classList.add('d-none');
  resultsMessage.classList.add('d-none');
  resultsTableWrap.classList.remove('d-none');
  resultsToolbar.classList.remove('d-none');
  resultsToolbar.classList.add('d-flex');
  rowCount.textContent = `${rows.length} row${rows.length !== 1 ? 's' : ''}`;

  resultsThead.innerHTML = '<tr>' + columns.map((c) => `<th>${esc(c)}</th>`).join('') + '</tr>';
  resultsTbody.innerHTML = '';
  lazyRows = rows;
  renderedRowsCount = 0;
  renderNextResultsChunk();
  while (
    lazyRows &&
    renderedRowsCount < lazyRows.length &&
    resultsContainer.scrollHeight <= resultsContainer.clientHeight
  ) {
    renderNextResultsChunk();
  }
}

function renderNextResultsChunk() {
  if (!lazyRows || renderedRowsCount >= lazyRows.length) return;

  const end = Math.min(renderedRowsCount + RESULTS_CHUNK_SIZE, lazyRows.length);
  const chunkHtml = lazyRows
    .slice(renderedRowsCount, end)
    .map(
      (row) =>
        '<tr>' +
        row
          .map(
            (cell) =>
              `<td>${cell === null ? '<i class="text-muted">NULL</i>' : esc(String(cell))}</td>`
          )
          .join('') +
        '</tr>'
    )
    .join('');

  resultsTbody.insertAdjacentHTML('beforeend', chunkHtml);
  renderedRowsCount = end;
}

function onResultsScroll() {
  if (!lazyRows || renderedRowsCount >= lazyRows.length) return;
  const threshold = 150;
  const atBottom =
    resultsContainer.scrollTop + resultsContainer.clientHeight >=
    resultsContainer.scrollHeight - threshold;
  if (atBottom) {
    renderNextResultsChunk();
  }
}

function showMessage(text, isError = false) {
  lazyRows = null;
  renderedRowsCount = 0;
  resultsPlaceholder.className = 'text-center text-muted fst-italic p-4';
  resultsPlaceholder.textContent = 'Run a query to see results';
  resultsPlaceholder.classList.add('d-none');
  resultsTableWrap.classList.add('d-none');
  resultsToolbar.classList.add('d-none');
  resultsToolbar.classList.remove('d-flex');
  resultsMessage.classList.remove('d-none');
  resultsMessage.className = `m-0 p-3 text-sm ${isError ? 'text-danger' : 'text-muted'}`;
  resultsMessage.textContent = text;
}

function clearResults() {
  lastColumns = null;
  lastRows = null;
  lazyRows = null;
  renderedRowsCount = 0;
  resultsPlaceholder.className = 'text-center text-muted fst-italic p-4';
  resultsPlaceholder.textContent = 'Run a query to see results';
  resultsPlaceholder.classList.remove('d-none');
  resultsTableWrap.classList.add('d-none');
  resultsToolbar.classList.add('d-none');
  resultsToolbar.classList.remove('d-flex');
  resultsMessage.classList.add('d-none');
  resultsThead.innerHTML = '';
  resultsTbody.innerHTML = '';
}

// ===== Tabs (Bootstrap) =====
function showTab(tabEl) {
  if (tabEl && window.bootstrap) {
    const tab = new window.bootstrap.Tab(tabEl);
    tab.show();
  }
}

// ===== Table Export =====
async function exportTableToCSV(tableName) {
  const CHUNK_SIZE = 10000;

  try {
    // Disable button and show loader
    ddlExportCsvBtn.disabled = true;
    const originalHTML = ddlExportCsvBtn.innerHTML;
    ddlExportCsvBtn.innerHTML =
      '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Exporting...';

    // Get metadata and total count
    const streamInfo = await sendWorker('export-stream', { tableName, chunkSize: CHUNK_SIZE });
    const { columns, totalRows } = streamInfo;

    if (totalRows === 0) {
      toastInfo('Table is empty');
      return;
    }

    // Build CSV incrementally with Blob chunks to avoid memory issues
    const csvParts = [];

    // Add header
    csvParts.push(rowToCSVLine(columns));

    // Stream chunks
    let offset = 0;
    let processedRows = 0;

    while (offset < totalRows) {
      const chunkResult = await sendWorker('export-chunk', {
        tableName,
        offset,
        chunkSize: CHUNK_SIZE,
      });

      // Convert rows to CSV lines
      for (const row of chunkResult.rows) {
        csvParts.push(rowToCSVLine(row));
      }

      offset += chunkResult.rows.length;
      processedRows += chunkResult.rows.length;

      // Update button with progress
      const percent = Math.floor((processedRows / totalRows) * 100);
      ddlExportCsvBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Exporting... ${percent}%`;

      if (!chunkResult.hasMore) break;
    }

    // Create and download the blob
    const blob = new Blob(csvParts, { type: 'text/csv;charset=utf-8;' });
    const filename = `${tableName}_export.csv`;
    downloadBlob(blob, filename);

    toastSuccess(`Exported ${processedRows.toLocaleString()} rows to ${filename}`);
    ddlExportCsvBtn.innerHTML = originalHTML;
  } catch (err) {
    toastError('Export failed: ' + err.message);
    ddlExportCsvBtn.innerHTML =
      '<i class="fa-solid fa-file-csv me-1" aria-hidden="true"></i>Export CSV';
  } finally {
    ddlExportCsvBtn.disabled = false;
  }
}

// ===== History =====
function renderHistory() {
  const list = getHistory();
  historyEmpty.classList.toggle('d-none', list.length > 0);
  historyTableWrap.classList.toggle('d-none', list.length === 0);
  historyTbody.innerHTML = '';
  for (const entry of list) {
    const tr = document.createElement('tr');
    const time = new Date(entry.timestamp);
    const timeStr =
      time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
      ' ' +
      time.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const statusClass = entry.isError ? 'text-danger' : 'text-success';
    tr.innerHTML = `
      <td class="text-muted text-sm text-nowrap">${esc(entry.db)}</td>
      <td class="hist-sql-cell" title="${esc(entry.sql)}">${esc(entry.sql)}</td>
      <td class="hist-status-cell ${statusClass}">${esc(entry.status || '')}</td>
      <td class="hist-time-cell">${timeStr}</td>
      <td class="text-center">
        <div class="d-flex gap-1 justify-content-center">
          <button class="btn btn-outline-dark btn-sm hist-use-btn" title="Execute"><i class="fa-solid fa-play" aria-hidden="true"></i></button>
          <button class="btn btn-outline-dark btn-sm hist-copy-btn" title="Copy to clipboard"><i class="fa-regular fa-copy" aria-hidden="true"></i></button>
        </div>
      </td>`;
    on(tr.querySelector('.hist-use-btn'), 'click', (e) => {
      e.stopPropagation();
      sqlEditor.value = entry.sql;
      const cur = editorTabs.find((t) => t.id === activeTabId);
      if (cur) cur.sql = entry.sql;
      showTab(resultsTabEl);
      executeQuery();
    });
    on(tr.querySelector('.hist-copy-btn'), 'click', (e) => {
      e.stopPropagation();
      copyToClipboard(entry.sql);
    });
    historyTbody.appendChild(tr);
  }
}

// ===== Event Binding =====
function bindEvents() {
  // Upload
  on(dbUpload, 'change', (e) => {
    if (e.target.files.length) handleUpload([...e.target.files]);
    e.target.value = '';
  });

  // Run query
  on(runBtn, 'click', () => {
    showTab(resultsTabEl);
    executeQuery();
  });
  on(resultsContainer, 'scroll', onResultsScroll);
  on(sqlEditor, 'keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      executeQuery();
    }
    // Tab inserts spaces
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = sqlEditor.selectionStart;
      const end = sqlEditor.selectionEnd;
      sqlEditor.value = sqlEditor.value.substring(0, start) + '  ' + sqlEditor.value.substring(end);
      sqlEditor.selectionStart = sqlEditor.selectionEnd = start + 2;
    }
  });

  // Clear
  on(clearBtn, 'click', () => {
    sqlEditor.value = '';
    const cur = editorTabs.find((t) => t.id === activeTabId);
    if (cur) cur.sql = '';
    sqlEditor.focus();
  });

  // Add editor tab
  on(addTabBtn, 'click', () => addEditorTab());

  // Copy results
  on(copyResultsBtn, 'click', async () => {
    if (!lastColumns || !lastRows) return;
    const tsv = resultsToTSV(lastColumns, lastRows);
    await copyToClipboard(tsv);
  });

  // Export CSV
  on(exportCsvBtn, 'click', () => {
    if (!lastColumns || !lastRows) return;
    const csv = resultsToCSV(lastColumns, lastRows);
    const filename = (currentDb || 'results').replace(/\.[^.]+$/, '') + '_export.csv';
    downloadCSV(csv, filename);
    toastSuccess('CSV exported');
  });

  // DDL copy
  on(ddlCopyBtn, 'click', async () => {
    await copyToClipboard(ddlCode.textContent);
  });

  // DDL export CSV
  on(ddlExportCsvBtn, 'click', async () => {
    const name = ddlObjectName.textContent;
    if (!name || !currentDb) return;
    await exportTableToCSV(name);
  });

  // DDL record count
  on(ddlCountBtn, 'click', async () => {
    const name = ddlObjectName.textContent;
    if (!name || !currentDb) return;
    try {
      ddlCountBtn.disabled = true;
      ddlCountBtn.innerHTML =
        '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Counting...';
      const result = await sendWorker('exec', { sql: `SELECT COUNT(*) AS cnt FROM [${name}];` });
      const count = result.rows?.[0]?.[0] ?? '?';
      ddlCountBtn.innerHTML = `<i class="fa-solid fa-hashtag me-1" aria-hidden="true"></i>${Number(count).toLocaleString()} rows`;
    } catch (err) {
      ddlCountBtn.innerHTML = '<i class="fa-solid fa-hashtag me-1" aria-hidden="true"></i>Count';
      toastError('Count failed: ' + err.message);
    } finally {
      ddlCountBtn.disabled = false;
    }
  });

  // DDL query top 100
  on(ddlQueryBtn, 'click', () => {
    const name = ddlObjectName.textContent;
    if (!name) return;
    const sql = `SELECT * FROM [${name}] LIMIT 1000;`;
    addEditorTab(sql);
    executeQuery();
  });

  // Settings modal - load values when opened
  if (settingsModal) {
    on(settingsModal, 'show.bs.modal', () => {
      const settings = getSettings();
      apiKeyInput.value = settings.apiKey || '';
    });
  }

  // Save settings
  on(saveSettingsBtn, 'click', () => {
    saveSettings({ ...getSettings(), apiKey: apiKeyInput.value.trim() });
    // Close modal via Bootstrap
    const modal = window.bootstrap.Modal.getInstance(settingsModal);
    if (modal) modal.hide();
    toastSuccess('Settings saved');
  });
}

// ===== Helpers =====
function setStatus(text, isError = false) {
  statusText.textContent = text;
  statusText.classList.toggle('text-danger', isError);
  statusText.classList.toggle('text-muted', !isError);
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
