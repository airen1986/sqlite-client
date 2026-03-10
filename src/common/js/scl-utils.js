/**
 * SQLite client utility functions.
 *
 * OPFS helpers, clipboard, CSV/TSV conversion, query history, settings.
 */

// ===== OPFS Storage =====

const DB_DIR = 'scl-databases';

async function getDbDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DB_DIR, { create: true });
}

export async function listDatabases() {
  const dir = await getDbDir();
  const names = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file') names.push(name);
  }
  return names.sort();
}

export async function saveToOPFS(name, arrayBuffer) {
  const dir = await getDbDir();
  const fileHandle = await dir.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(arrayBuffer);
  await writable.close();
}

export async function deleteFromOPFS(name) {
  const dir = await getDbDir();
  await dir.removeEntry(name);
}

export async function readFromOPFS(name) {
  const dir = await getDbDir();
  const fileHandle = await dir.getFileHandle(name);
  return fileHandle.getFile();
}

/**
 * Returns the OPFS path that the worker should use to open the DB.
 * The OpfsDb constructor uses paths relative to OPFS root.
 */
export function opfsPath(name) {
  return `/${DB_DIR}/${name}`;
}

// ===== Clipboard =====

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  }
}

// ===== TSV / CSV =====

export function resultsToTSV(columns, rows) {
  const header = columns.join('\t');
  const body = rows
    .map((row) =>
      row.map((cell) => (cell === null ? '' : String(cell).replace(/\t/g, ' '))).join('\t')
    )
    .join('\n');
  return header + '\n' + body;
}

export function resultsToCSV(columns, rows) {
  function esc(val) {
    if (val === null || val === undefined) return '';
    const s = String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }
  const header = columns.map(esc).join(',');
  const body = rows.map((row) => row.map(esc).join(',')).join('\n');
  return header + '\n' + body;
}

export function downloadCSV(csvString, filename) {
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Download Blob as file
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Escape and format a cell value for CSV
 */
function escapeCSVCell(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Convert row array to CSV line
 */
export function rowToCSVLine(row) {
  return row.map(escapeCSVCell).join(',') + '\n';
}

// ===== Query History =====

const HISTORY_KEY = 'scl-sql-history';
const MAX_HISTORY = 50;

function loadAllHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || {};
  } catch {
    return {};
  }
}

function saveAllHistory(data) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(data));
}

export function getHistory(dbName) {
  const all = loadAllHistory();
  if (!dbName) {
    // Return all history across all databases, merged and sorted
    const merged = [];
    for (const [db, entries] of Object.entries(all)) {
      for (const e of entries) merged.push({ ...e, db });
    }
    merged.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return merged;
  }
  return (all[dbName] || []).map((e) => ({ ...e, db: dbName }));
}

/**
 * @param {string} dbName
 * @param {string} sql
 * @param {string} status - e.g. "5 rows in 0.123s" or "3 row(s) affected (0.05s)" or error text
 * @param {boolean} isError
 */
export function addToHistory(dbName, sql, status, isError = false) {
  const all = loadAllHistory();
  const list = all[dbName] || [];
  list.unshift({ sql, status, isError, timestamp: new Date().toISOString() });
  if (list.length > MAX_HISTORY) list.length = MAX_HISTORY;
  all[dbName] = list;
  saveAllHistory(all);
  return getHistory(); // return full merged history
}

// ===== Settings =====

const SETTINGS_KEY = 'scl-sql-settings';

export function getSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
