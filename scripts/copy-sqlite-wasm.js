/**
 * Copies required @sqlite.org/sqlite-wasm dist files to src/public/sqlite-wasm/
 * so they can be served as static assets by Vite.
 *
 * Run: node scripts/copy-sqlite-wasm.js
 * Also runs automatically via npm postinstall.
 */

import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SRC = resolve(ROOT, 'node_modules/@sqlite.org/sqlite-wasm/dist');
const DEST = resolve(ROOT, 'src/public/sqlite-wasm');

const FILES = ['index.mjs', 'sqlite3.wasm', 'sqlite3-opfs-async-proxy.js'];

if (!existsSync(SRC)) {
  console.log('⚠  sqlite-wasm not installed yet — skipping copy.');
  process.exit(0);
}

mkdirSync(DEST, { recursive: true });

for (const file of FILES) {
  const src = resolve(SRC, file);
  const dest = resolve(DEST, file);
  if (existsSync(src)) {
    copyFileSync(src, dest);
    console.log(`  ✓ ${file}`);
  } else {
    console.warn(`  ✗ ${file} not found in ${SRC}`);
  }
}

console.log('Done — sqlite-wasm files copied to src/public/sqlite-wasm/');
