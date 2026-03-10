/**
 * SQLite WASM Web Worker.
 *
 * This file is served as a static asset (not processed by Vite).
 * It imports sqlite-wasm from /sqlite-wasm/ which is copied from node_modules.
 */

import sqlite3InitModule from '/sqlite-wasm/index.mjs';

let sqlite3 = null;
let db = null;
let opfsAvailable = false;

async function handleInit() {
  // eslint-disable-next-line no-console
  sqlite3 = await sqlite3InitModule({ print: console.log, printErr: console.error });
  opfsAvailable = 'opfs' in sqlite3;
  return { opfsAvailable, version: sqlite3.version.libVersion };
}

function handleOpen(filename) {
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    db = null;
  }
  if (opfsAvailable) {
    db = new sqlite3.oo1.OpfsDb(filename);
  } else {
    // Fallback to transient in-memory db (won't persist)
    db = new sqlite3.oo1.DB(filename, 'ct');
  }
  return { filename: db.filename, persistent: opfsAvailable };
}

function handleExec(sql) {
  if (!db) throw new Error('No database is open');
  const trimmed = sql.trim();
  if (!trimmed) throw new Error('Empty query');

  // Detect if this is a SELECT-like statement that returns rows
  const isSelect = /^\s*(SELECT|PRAGMA|EXPLAIN|WITH)\b/i.test(trimmed);

  if (isSelect) {
    const columnNames = [];
    const rows = db.exec(trimmed, {
      returnValue: 'resultRows',
      rowMode: 'array',
      columnNames,
    });
    return { type: 'rows', columns: columnNames, rows };
  } else {
    db.exec(trimmed);
    const changes = db.changes();
    return { type: 'changes', changes };
  }
}

function handleGetObjects() {
  if (!db) throw new Error('No database is open');
  const columnNames = [];
  const rows = db.exec(
    `SELECT type, name, sql FROM sqlite_master
     WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'
     ORDER BY type, name`,
    { returnValue: 'resultRows', rowMode: 'object', columnNames }
  );
  const tables = rows.filter((r) => r.type === 'table').map((r) => r.name);
  const views = rows.filter((r) => r.type === 'view').map((r) => r.name);
  return { tables, views };
}

function handleGetDDL(objectName) {
  if (!db) throw new Error('No database is open');
  const rows = db.exec(`SELECT sql FROM sqlite_master WHERE name = ?`, {
    bind: [objectName],
    returnValue: 'resultRows',
    rowMode: 'array',
  });
  if (rows.length === 0) throw new Error(`Object "${objectName}" not found`);
  return { name: objectName, ddl: rows[0][0] };
}

async function handleImport(filename, arrayBuffer) {
  // Close any open DB first
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    db = null;
  }
  // importDb writes to OPFS and automatically clears the WAL-mode flag,
  // which avoids SQLITE_CANTOPEN for WAL-mode databases.
  await sqlite3.oo1.OpfsDb.importDb(filename, arrayBuffer);
  return { ok: true };
}

function handleExportStream(tableName, chunkSize = 10000) {
  if (!db) throw new Error('No database is open');
  
  // Get column names
  const columnNames = [];
  db.exec(`SELECT * FROM [${tableName}] LIMIT 0`, { columnNames });
  
  // Get total count for progress
  const countRows = db.exec(`SELECT COUNT(*) as cnt FROM [${tableName}]`, {
    returnValue: 'resultRows',
    rowMode: 'array',
  });
  const totalRows = countRows[0]?.[0] || 0;
  
  return { columns: columnNames, totalRows };
}

function handleExportChunk(tableName, offset, chunkSize = 10000) {
  if (!db) throw new Error('No database is open');
  
  const rows = db.exec(
    `SELECT * FROM [${tableName}] LIMIT ${chunkSize} OFFSET ${offset}`,
    { returnValue: 'resultRows', rowMode: 'array' }
  );
  
  return { rows, hasMore: rows.length === chunkSize };
}

function handleClose() {
  if (db) {
    db.close();
    db = null;
  }
  return { closed: true };
}

// Message handler
self.onmessage = async (e) => {
  const { id, type, payload } = e.data;
  try {
    let result;
    switch (type) {
      case 'init':
        result = await handleInit();
        break;
      case 'open':
        result = handleOpen(payload.filename);
        break;
      case 'exec':
        result = handleExec(payload.sql);
        break;
      case 'get-objects':
        result = handleGetObjects();
        break;
      case 'get-ddl':
        result = handleGetDDL(payload.name);
        break;
      case 'import':
        result = await handleImport(payload.filename, payload.buffer);
        break;
      case 'export-stream':
        result = handleExportStream(payload.tableName, payload.chunkSize);
        break;
      case 'export-chunk':
        result = handleExportChunk(payload.tableName, payload.offset, payload.chunkSize);
        break;
      case 'close':
        result = handleClose();
        break;
      default:
        throw new Error(`Unknown message type: ${type}`);
    }
    self.postMessage({ id, type, result });
  } catch (err) {
    self.postMessage({ id, type, error: err.message || String(err) });
  }
};
