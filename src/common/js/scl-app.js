/**
 * SQLite client main application logic.
 *
 * Uses template utilities:
 *   - dom.js ($, on) for DOM helpers
 *   - toast.js (toastSuccess, toastError, toastInfo) for SweetAlert2 toasts
 *   - Bootstrap Tab / Modal components
 */

import { $, on } from './dom';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import {
  acceptCompletion,
  autocompletion,
  completionKeymap,
  completionStatus,
} from '@codemirror/autocomplete';
import { tags as t } from '@lezer/highlight';
import { sql } from '@codemirror/lang-sql';
import { toastSuccess, toastError, toastInfo, confirm } from './toast';
import {
  listDatabases,
  readFromOPFS,
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
let textToSqlPopupEl = null;
const pendingMessages = new Map();
const RESULTS_CHUNK_SIZE = 1000;
const ENABLE_SQL_AUTOCOMPLETE = true;
const DESKTOP_VIEWPORT = 'width=1280, initial-scale=1.0';
const TEXT_TO_SQL_PROVIDER_DEFAULT = 'chatgpt';
const TEXT_TO_SQL_MODEL_DEFAULT = 'gpt-4o-mini';
const TEXT_TO_SQL_CUSTOM_ENDPOINT_DEFAULT = '';
const TEXT_TO_SQL_CUSTOM_AUTH_TYPE_DEFAULT = 'Bearer';
const SQL_KEYWORDS = [
  'SELECT',
  'FROM',
  'WHERE',
  'GROUP BY',
  'ORDER BY',
  'LIMIT',
  'OFFSET',
  'INSERT INTO',
  'UPDATE',
  'DELETE FROM',
  'CREATE TABLE',
  'ALTER TABLE',
  'DROP TABLE',
  'CREATE INDEX',
  'DROP INDEX',
  'CREATE VIEW',
  'DROP VIEW',
  'JOIN',
  'LEFT JOIN',
  'RIGHT JOIN',
  'INNER JOIN',
  'ON',
  'AS',
  'AND',
  'OR',
  'NOT',
  'IN',
  'LIKE',
  'BETWEEN',
  'IS NULL',
  'IS NOT NULL',
  'DISTINCT',
  'HAVING',
  'UNION',
  'UNION ALL',
  'EXCEPT',
  'INTERSECT',
  'WITH',
  'VALUES',
  'PRAGMA',
  'BEGIN',
  'COMMIT',
  'ROLLBACK',
];

const sqlHighlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.definitionKeyword, t.modifier], class: 'cm-tok-keyword' },
  { tag: [t.string], class: 'cm-tok-string' },
  { tag: [t.number, t.bool], class: 'cm-tok-number' },
  { tag: [t.comment], class: 'cm-tok-comment' },
  { tag: [t.null, t.atom], class: 'cm-tok-atom' },
  { tag: [t.operator, t.punctuation], class: 'cm-tok-operator' },
  { tag: [t.variableName, t.propertyName, t.name], class: 'cm-tok-name' },
  { tag: [t.typeName, t.className], class: 'cm-tok-type' },
]);

// ===== Editor Tabs State =====
let tabIdCounter = 0;
const editorTabs = []; // [{ id, title, sql }]
let activeTabId = null;
let sqlEditorView = null;
const completionSchema = {
  dbName: null,
  tables: [],
  views: [],
  columnsByTable: new Map(),
  loadingPromise: null,
};

function clearCompletionSchema() {
  completionSchema.dbName = null;
  completionSchema.tables = [];
  completionSchema.views = [];
  completionSchema.columnsByTable = new Map();
}

function escapeSqlIdentifier(name) {
  return String(name).replace(/]/g, ']]');
}

async function refreshCompletionSchema() {
  if (!currentDb) {
    clearCompletionSchema();
    return;
  }
  if (completionSchema.loadingPromise) {
    await completionSchema.loadingPromise;
    return;
  }

  const activeDbName = currentDb;
  const loadPromise = (async () => {
    const { tables, views } = await sendWorker('get-objects');
    const columnsByTable = new Map();
    const tableNames = [...tables, ...views];

    for (const tableName of tableNames) {
      try {
        const pragmaResult = await sendWorker('exec', {
          sql: `PRAGMA table_info([${escapeSqlIdentifier(tableName)}]);`,
        });
        if (pragmaResult.type !== 'rows') {
          columnsByTable.set(tableName, []);
          continue;
        }
        const nameIndex = pragmaResult.columns.indexOf('name');
        if (nameIndex === -1) {
          columnsByTable.set(tableName, []);
          continue;
        }
        const columns = pragmaResult.rows
          .map((row) => row[nameIndex])
          .filter((column) => typeof column === 'string');
        columnsByTable.set(tableName, columns);
      } catch {
        columnsByTable.set(tableName, []);
      }
    }

    if (currentDb !== activeDbName) return;

    completionSchema.dbName = activeDbName;
    completionSchema.tables = tables;
    completionSchema.views = views;
    completionSchema.columnsByTable = columnsByTable;
  })();

  completionSchema.loadingPromise = loadPromise;
  try {
    await loadPromise;
  } finally {
    completionSchema.loadingPromise = null;
  }
}

function buildCompletionOptions(prefix = '') {
  const normalizedPrefix = prefix.toLowerCase();
  const options = [];
  const seen = new Set();
  const addOption = (label, type, detail) => {
    const key = `${type}:${label}`;
    if (seen.has(key)) return;
    if (normalizedPrefix && !label.toLowerCase().startsWith(normalizedPrefix)) return;
    seen.add(key);
    options.push({ label, type, detail });
  };

  for (const keyword of SQL_KEYWORDS) addOption(keyword, 'keyword', 'SQL');
  for (const table of completionSchema.tables) addOption(table, 'class', 'table');
  for (const view of completionSchema.views) addOption(view, 'class', 'view');
  for (const [tableName, columns] of completionSchema.columnsByTable.entries()) {
    for (const columnName of columns) {
      addOption(columnName, 'property', tableName);
    }
  }

  return options;
}

async function sqlCompletionSource(context) {
  const word = context.matchBefore(/[\w$]*/);
  if (!word) return null;
  if (!context.explicit && word.from === word.to) return null;

  // Fast check: don't show completions inside comments
  // Only parse syntax tree if we might be in a comment
  const line = context.state.doc.lineAt(context.pos);
  const lineText = line.text.trimStart();
  if (lineText.startsWith('--')) return null;

  // if (currentDb && completionSchema.dbName !== currentDb) {
  //   if (context.explicit) await refreshCompletionSchema();
  //   else if (!completionSchema.loadingPromise) void refreshCompletionSchema();
  // }

  const options = buildCompletionOptions(word.text);
  return {
    from: word.from,
    options,
    validFor: /[\w$]*/,
  };
}

// ===== Worker =====
const worker = new Worker('./js/sqlite-worker.js', { type: 'module' });

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
const promptBtn = $('#prompt-btn');
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
const textToSqlProviderInput = $('#text-to-sql-provider-input');
const textToSqlModelInput = $('#text-to-sql-model-input');
const textToSqlApiKeyInput = $('#text-to-sql-api-key-input');
const textToSqlCustomEndpointInput = $('#text-to-sql-custom-endpoint-input');
const textToSqlCustomAuthTypeInput = $('#text-to-sql-custom-auth-type-input');
const textToSqlCustomEndpointGroup = $('#text-to-sql-custom-endpoint-group');
const saveSettingsBtn = $('#save-settings-btn');
const settingsModal = $('#settingsModal');

// Bootstrap Tab instances
const resultsTabEl = $('#results-tab');
const ddlTabEl = $('#ddl-tab');

function getEditorValue() {
  if (sqlEditorView) return sqlEditorView.state.doc.toString();
  return sqlEditor.value;
}

function getEditorSelectionInfo() {
  if (sqlEditorView) {
    const sel = sqlEditorView.state.selection.main;
    return {
      from: sel.from,
      to: sel.to,
      hasSelection: sel.from !== sel.to,
      cursor: sel.head,
    };
  }
  return {
    from: sqlEditor.selectionStart,
    to: sqlEditor.selectionEnd,
    hasSelection: sqlEditor.selectionStart !== sqlEditor.selectionEnd,
    cursor: sqlEditor.selectionEnd,
  };
}

function setEditorValue(value) {
  if (sqlEditorView) {
    sqlEditorView.dispatch({
      changes: {
        from: 0,
        to: sqlEditorView.state.doc.length,
        insert: value,
      },
    });
    return;
  }
  sqlEditor.value = value;
}

function focusEditor() {
  if (sqlEditorView) {
    sqlEditorView.focus();
    return;
  }
  sqlEditor.focus();
}

function hasExecutableSql(sqlText) {
  const withoutBlockComments = sqlText.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const withoutLineComments = withoutBlockComments.replace(/--.*$/gm, ' ');
  return withoutLineComments.trim().length > 0;
}

function stripLeadingSqlComments(sqlText) {
  let remaining = sqlText;

  while (true) {
    const trimmedStart = remaining.replace(/^\s+/, '');
    if (trimmedStart.startsWith('--')) {
      const lineEnd = trimmedStart.indexOf('\n');
      remaining = lineEnd === -1 ? '' : trimmedStart.slice(lineEnd + 1);
      continue;
    }
    if (trimmedStart.startsWith('/*')) {
      const blockEnd = trimmedStart.indexOf('*/');
      remaining = blockEnd === -1 ? '' : trimmedStart.slice(blockEnd + 2);
      continue;
    }
    return trimmedStart;
  }
}

function getSqlStatementsWithRanges(sqlText) {
  const statements = [];
  let start = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inBracket = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < sqlText.length; index += 1) {
    const char = sqlText[index];
    const nextChar = sqlText[index + 1];

    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (inSingle) {
      if (char === "'" && nextChar === "'") {
        index += 1;
        continue;
      }
      if (char === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (char === '"' && nextChar === '"') {
        index += 1;
        continue;
      }
      if (char === '"') inDouble = false;
      continue;
    }
    if (inBacktick) {
      if (char === '`') inBacktick = false;
      continue;
    }
    if (inBracket) {
      if (char === ']') inBracket = false;
      continue;
    }

    if (char === '-' && nextChar === '-') {
      inLineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && nextChar === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (char === "'") {
      inSingle = true;
      continue;
    }
    if (char === '"') {
      inDouble = true;
      continue;
    }
    if (char === '`') {
      inBacktick = true;
      continue;
    }
    if (char === '[') {
      inBracket = true;
      continue;
    }

    if (char === ';') {
      const end = index + 1;
      const statement = sqlText.slice(start, end);
      if (statement.trim() && hasExecutableSql(statement)) {
        statements.push({ start, end, sql: statement.trim() });
      }
      start = end;
    }
  }

  const tail = sqlText.slice(start);
  if (tail.trim() && hasExecutableSql(tail)) {
    statements.push({ start, end: sqlText.length, sql: tail.trim() });
  }

  return statements;
}

function getRunnableSqlFromEditor() {
  const sqlText = getEditorValue();
  const selection = getEditorSelectionInfo();

  if (selection.hasSelection) {
    const selectedSql = sqlText.slice(selection.from, selection.to).trim();
    return selectedSql;
  }

  const statements = getSqlStatementsWithRanges(sqlText);
  if (statements.length === 0) return '';

  const statementAtCursor = statements.find(
    (statement) => selection.cursor >= statement.start && selection.cursor <= statement.end
  );
  if (statementAtCursor) return statementAtCursor.sql;

  const previousStatement = [...statements]
    .reverse()
    .find((statement) => selection.cursor > statement.end);
  if (previousStatement) return previousStatement.sql;

  return statements[0].sql;
}

async function buildSchemaContext() {
  await refreshCompletionSchema();

  return {
    dbName: currentDb,
    tables: completionSchema.tables.map((tableName) => ({
      name: tableName,
      columns: completionSchema.columnsByTable.get(tableName) || [],
    })),
    views: completionSchema.views.map((viewName) => ({
      name: viewName,
      columns: completionSchema.columnsByTable.get(viewName) || [],
    })),
  };
}

function extractGeneratedSql(response) {
  if (!response) return '';
  if (typeof response === 'string') return response.trim();
  const chatContent = response?.choices?.[0]?.message?.content;
  if (typeof chatContent === 'string') return chatContent.trim();
  if (typeof response.sql === 'string') return response.sql.trim();
  if (typeof response.query === 'string') return response.query.trim();
  if (response.data && typeof response.data.sql === 'string') return response.data.sql.trim();
  return '';
}

function stripSqlCodeFence(sqlText) {
  const trimmed = sqlText.trim();
  const fencedMatch = trimmed.match(/^```(?:sql)?\s*\n([\s\S]*?)\n```$/i);
  if (fencedMatch) return fencedMatch[1].trim();
  return trimmed;
}

function buildTextToSqlPrompt(promptText, schema) {
  const schemaJson = JSON.stringify(schema, null, 2);
  return [
    'Generate one valid SQLite SQL statement for the request below.',
    'Use only tables/views/columns from schema context.',
    'Return only SQL without explanation or markdown.',
    '',
    'Schema context:',
    schemaJson,
    '',
    'User request:',
    promptText,
  ].join('\n');
}

function isValidAbsoluteHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function resolveCustomTextToSqlEndpoint(settings) {
  const rawEndpoint = (
    settings?.textToSqlCustomEndpoint || TEXT_TO_SQL_CUSTOM_ENDPOINT_DEFAULT
  ).trim();
  if (!rawEndpoint) {
    throw new Error('Custom endpoint is required for Custom provider.');
  }
  if (!isValidAbsoluteHttpUrl(rawEndpoint)) {
    throw new Error('Custom endpoint must be a full URL starting with http:// or https://');
  }
  return rawEndpoint;
}

function resolveCustomTextToSqlAuthType(settings) {
  const rawAuthType = (
    settings?.textToSqlCustomAuthType || TEXT_TO_SQL_CUSTOM_AUTH_TYPE_DEFAULT
  ).trim();
  if (!rawAuthType) return TEXT_TO_SQL_CUSTOM_AUTH_TYPE_DEFAULT;
  return rawAuthType.toLowerCase() === 'bearer' ? 'Bearer' : rawAuthType;
}

function handleTextToSqlHttpError(response, bodyText) {
  const msg = bodyText || `${response.status} ${response.statusText}`;
  throw new Error(`Text-to-SQL request failed: ${msg}`);
}

async function requestChatGptSql({ apiKey, model, finalPrompt }) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'You are a SQLite SQL generator. Use "," for cross joins. Do not use aliases unless necessary. Return only SQL.',
        },
        {
          role: 'user',
          content: finalPrompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    handleTextToSqlHttpError(response, await response.text());
  }
  const data = await response.json();
  return data?.choices?.[0]?.message?.content || '';
}

async function requestClaudeSql({ apiKey, model, finalPrompt }) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      temperature: 0,
      system:
        'You are a SQLite SQL generator. Use "," for cross joins. Do not use aliases unless necessary. Return only SQL.',
      messages: [{ role: 'user', content: finalPrompt }],
    }),
  });

  if (!response.ok) {
    handleTextToSqlHttpError(response, await response.text());
  }
  const data = await response.json();
  const firstPart = data?.content?.[0];
  return firstPart?.text || '';
}

async function requestGeminiSql({ apiKey, model, finalPrompt }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const systemPrompt =
    'You are a SQLite SQL generator. Use "," for cross joins. Do not use aliases unless necessary. Return only SQL.';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      generationConfig: {
        temperature: 0,
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: finalPrompt }],
        },
      ],
    }),
  });

  if (!response.ok) {
    handleTextToSqlHttpError(response, await response.text());
  }
  const data = await response.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function requestCustomSql({ endpoint, authType, apiKey, model, finalPrompt }) {
  const headers = {
    'Content-Type': 'application/json',
  };
  if (authType === 'Bearer') {
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else if (authType) {
    headers[authType] = `${apiKey}`;
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'You are a SQLite SQL generator. Use "," for cross joins. Do not use aliases unless necessary. Return only SQL.',
        },
        {
          role: 'user',
          content: finalPrompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    handleTextToSqlHttpError(response, await response.text());
  }
  return response.json();
}

function toggleCustomEndpointField() {
  if (!textToSqlProviderInput || !textToSqlCustomEndpointGroup) return;
  const provider = textToSqlProviderInput.value;
  textToSqlCustomEndpointGroup.classList.toggle('d-none', provider !== 'custom');
}

function enforceDesktopViewport() {
  const viewportMeta = document.querySelector('meta[name="viewport"]');
  if (viewportMeta) {
    viewportMeta.setAttribute('content', DESKTOP_VIEWPORT);
    return;
  }

  const createdViewportMeta = document.createElement('meta');
  createdViewportMeta.setAttribute('name', 'viewport');
  createdViewportMeta.setAttribute('content', DESKTOP_VIEWPORT);
  document.head.appendChild(createdViewportMeta);
}

async function generateSqlFromPrompt(promptText) {
  const settings = getSettings();
  const provider = settings.textToSqlProvider || TEXT_TO_SQL_PROVIDER_DEFAULT;
  const model = (settings.textToSqlModel || '').trim();
  const apiKey = (settings.textToSqlApiKey || '').trim();

  if (!apiKey) {
    throw new Error('Text-to-SQL API key not found. Set it in Settings first.');
  }
  if (!model) {
    throw new Error('Text-to-SQL model is required. Set it in Settings first.');
  }

  const schema = await buildSchemaContext();
  const finalPrompt = buildTextToSqlPrompt(promptText, schema);

  let generatedRaw;
  if (provider === 'chatgpt') {
    generatedRaw = await requestChatGptSql({ apiKey, model, finalPrompt });
  } else if (provider === 'claude') {
    generatedRaw = await requestClaudeSql({ apiKey, model, finalPrompt });
  } else if (provider === 'gemini') {
    generatedRaw = await requestGeminiSql({ apiKey, model, finalPrompt });
  } else if (provider === 'custom') {
    const customEndpoint = resolveCustomTextToSqlEndpoint(settings);
    const customAuthType = resolveCustomTextToSqlAuthType(settings);
    const customResponse = await requestCustomSql({
      endpoint: customEndpoint,
      authType: customAuthType,
      apiKey,
      model,
      finalPrompt,
    });
    generatedRaw = extractGeneratedSql(customResponse);
  } else {
    throw new Error(`Unsupported Text-to-SQL provider: ${provider}`);
  }

  const generatedSql = stripSqlCodeFence(generatedRaw);
  if (!generatedSql) {
    throw new Error('Text-to-SQL API returned no SQL.');
  }
  return generatedSql;
}

// ===== Text-to-SQL Popup =====
function openTextToSqlPopup(view) {
  closeTextToSqlPopup();
  const cursorPos = view.state.selection.main.head;
  const coords = view.coordsAtPos(cursorPos);
  if (!coords) return true;

  const popup = document.createElement('div');
  popup.className = 'scl-txt2sql-popup';
  popup.innerHTML = `
    <i class="fa-solid fa-wand-magic-sparkles scl-txt2sql-icon" aria-hidden="true"></i>
    <input
      type="text"
      class="scl-txt2sql-input"
      placeholder="Describe how to proceed in ..."
      autocomplete="off"
      spellcheck="false"
    />
    <button class="scl-txt2sql-submit" type="button" title="Generate SQL">
      <i class="fa-solid fa-arrow-up" aria-hidden="true"></i>
    </button>
  `;
  popup.style.top = `${Math.min(coords.bottom + 6, window.innerHeight - 80)}px`;
  popup.style.left = `${Math.max(0, Math.min(coords.left, window.innerWidth - 400))}px`;
  document.body.appendChild(popup);
  textToSqlPopupEl = popup;

  const input = popup.querySelector('.scl-txt2sql-input');
  const submitBtn = popup.querySelector('.scl-txt2sql-submit');
  requestAnimationFrame(() => input.focus());

  const submit = async () => {
    const prompt = input.value.trim();
    if (!prompt) return;
    closeTextToSqlPopup();
    await handleTextToSqlPopupSubmit(view, cursorPos, prompt);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeTextToSqlPopup();
      view.focus();
    }
  });
  submitBtn.addEventListener('click', submit);

  const onOutsideClick = (e) => {
    if (textToSqlPopupEl && !textToSqlPopupEl.contains(e.target)) {
      closeTextToSqlPopup();
      document.removeEventListener('mousedown', onOutsideClick);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', onOutsideClick), 0);
  return true;
}

function closeTextToSqlPopup() {
  if (textToSqlPopupEl) {
    textToSqlPopupEl.remove();
    textToSqlPopupEl = null;
  }
}

async function handleTextToSqlPopupSubmit(view, cursorPos, prompt) {
  if (!currentDb) {
    toastInfo('Open a database first');
    view.focus();
    return;
  }

  setStatus('Generating SQL...');
  try {
    const generatedSql = await generateSqlFromPrompt(prompt);
    const commentLines = prompt
      .split('\n')
      .map((l) => `-- ${l}`)
      .join('\n');
    const insertion = `${commentLines}\n${generatedSql}\n`;
    const line = view.state.doc.lineAt(cursorPos);
    view.dispatch({
      changes: { from: line.from, insert: insertion },
      selection: { anchor: line.from + insertion.length },
    });
    const cur = editorTabs.find((tab) => tab.id === activeTabId);
    if (cur) cur.sql = view.state.doc.toString();
    setStatus('SQL generated — press Ctrl+Enter to run');
  } catch (err) {
    toastError('Text-to-SQL failed: ' + err.message);
    setStatus('');
  } finally {
    view.focus();
  }
}

function initCodeMirrorEditor() {
  const editorHost = document.createElement('div');
  editorHost.id = 'sql-editor-cm';
  editorHost.className = 'scl-editor-textarea';
  sqlEditor.classList.add('d-none');
  sqlEditor.parentNode.insertBefore(editorHost, sqlEditor.nextSibling);

  sqlEditorView = new EditorView({
    parent: editorHost,
    state: EditorState.create({
      doc: '',
      extensions: [
        history(),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          {
            key: 'Tab',
            run: (view) => {
              if (ENABLE_SQL_AUTOCOMPLETE && completionStatus(view.state) === 'active') {
                return acceptCompletion(view);
              }
              return indentWithTab.run(view);
            },
          },
          {
            key: 'Enter',
            run: (view) => {
              if (ENABLE_SQL_AUTOCOMPLETE && completionStatus(view.state) === 'active') {
                return acceptCompletion(view);
              }
              return false;
            },
          },
          ...(ENABLE_SQL_AUTOCOMPLETE ? completionKeymap : []),
          {
            key: 'Mod-i',
            run: (view) => openTextToSqlPopup(view),
          },
          {
            key: 'Mod-Enter',
            run: () => {
              showTab(resultsTabEl);
              executeQuery();
              return true;
            },
          },
        ]),
        sql(),
        ...(ENABLE_SQL_AUTOCOMPLETE
          ? [
              autocompletion({
                activateOnTyping: true,
                override: [sqlCompletionSource],
              }),
            ]
          : []),
        syntaxHighlighting(sqlHighlightStyle),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || activeTabId === null) return;
          const cur = editorTabs.find((tab) => tab.id === activeTabId);
          if (cur) cur.sql = update.state.doc.toString();
        }),
      ],
    }),
  });

  // Ensure editor focuses when clicked anywhere
  editorHost.addEventListener('click', () => {
    if (!sqlEditorView.hasFocus) {
      sqlEditorView.focus();
    }
  });
}

// ===== Init =====
export async function init() {
  enforceDesktopViewport();
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
  initCodeMirrorEditor();
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
        <div class="db-actions">
          <button class="db-download" title="Download database"><i class="fa-solid fa-download" aria-hidden="true"></i></button>
          <button class="db-delete" title="Delete database"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
        </div>`;
      on(li.querySelector('.db-name'), 'click', () => selectDatabase(name));
      on(li.querySelector('.db-download'), 'click', async (e) => {
        e.stopPropagation();
        await downloadDatabase(name);
      });
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
    await refreshCompletionSchema();
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
      clearCompletionSchema();
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

async function downloadDatabase(name) {
  try {
    const file = await readFromOPFS(name);
    downloadBlob(file, name);
    toastSuccess(`Downloaded ${name}`);
  } catch (err) {
    toastError('Download failed: ' + err.message);
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
  focusEditor();
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
    if (cur) cur.sql = getEditorValue();
  }
  activeTabId = id;
  const tab = editorTabs.find((t) => t.id === id);
  if (tab) setEditorValue(tab.sql);
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
      focusEditor();
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
async function executeQuery(sqlOverride = null) {
  const sql = stripLeadingSqlComments((sqlOverride ?? getRunnableSqlFromEditor()).trim());
  if (!sql) return;
  if (!currentDb) {
    toastInfo('Open a database first');
    return;
  }

  showResultsLoader();
  setStatus('Executing...');
  runBtn.disabled = true;

  try {
    const start = performance.now();
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
      setEditorValue(entry.sql);
      const cur = editorTabs.find((t) => t.id === activeTabId);
      if (cur) cur.sql = entry.sql;
      showTab(resultsTabEl);
      executeQuery(entry.sql);
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

  // Open text-to-sql prompt popup
  on(promptBtn, 'click', () => {
    if (!sqlEditorView) return;
    focusEditor();
    openTextToSqlPopup(sqlEditorView);
  });

  on(resultsContainer, 'scroll', onResultsScroll);

  // Clear
  on(clearBtn, 'click', () => {
    setEditorValue('');
    const cur = editorTabs.find((t) => t.id === activeTabId);
    if (cur) cur.sql = '';
    focusEditor();
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
    executeQuery(sql);
  });

  // Settings modal - load values when opened
  if (settingsModal) {
    on(settingsModal, 'show.bs.modal', () => {
      const settings = getSettings();
      textToSqlProviderInput.value = settings.textToSqlProvider || TEXT_TO_SQL_PROVIDER_DEFAULT;
      textToSqlModelInput.value = settings.textToSqlModel || TEXT_TO_SQL_MODEL_DEFAULT;
      textToSqlApiKeyInput.value = settings.textToSqlApiKey || '';
      textToSqlCustomEndpointInput.value = settings.textToSqlCustomEndpoint || '';
      textToSqlCustomAuthTypeInput.value =
        settings.textToSqlCustomAuthType || TEXT_TO_SQL_CUSTOM_AUTH_TYPE_DEFAULT;
      toggleCustomEndpointField();
    });
  }

  on(textToSqlProviderInput, 'change', () => {
    toggleCustomEndpointField();
  });

  // Save settings
  on(saveSettingsBtn, 'click', () => {
    const selectedProvider = textToSqlProviderInput.value || TEXT_TO_SQL_PROVIDER_DEFAULT;
    const customEndpoint = textToSqlCustomEndpointInput.value.trim();
    if (selectedProvider === 'custom' && !isValidAbsoluteHttpUrl(customEndpoint)) {
      toastError(
        'Custom endpoint must be a full URL (for example: https://openrouter.ai/api/v1/chat/completions).'
      );
      return;
    }

    saveSettings({
      ...getSettings(),
      textToSqlProvider: selectedProvider,
      textToSqlModel: textToSqlModelInput.value.trim(),
      textToSqlApiKey: textToSqlApiKeyInput.value.trim(),
      textToSqlCustomEndpoint: customEndpoint,
      textToSqlCustomAuthType:
        (textToSqlCustomAuthTypeInput?.value || TEXT_TO_SQL_CUSTOM_AUTH_TYPE_DEFAULT).trim() ||
        TEXT_TO_SQL_CUSTOM_AUTH_TYPE_DEFAULT,
    });
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
