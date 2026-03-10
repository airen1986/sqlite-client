# SQLite Client

Browser-based SQLite client that runs fully in the browser using SQLite WASM + OPFS (Origin Private File System).

This project provides a local SQL workspace with persistent databases, query editor, results explorer, DDL view, history, CSV export, and database file management.

## Highlights

- In-browser SQLite execution with `@sqlite.org/sqlite-wasm`
- OPFS-backed persistence (databases remain available across sessions)
- Modern SQL editor powered by CodeMirror 6 with syntax highlighting and autocomplete
- Multi-tab SQL editing and `Ctrl/Cmd + Enter` query execution
- Results grid with chunked rendering for large datasets
- DDL inspection for tables/views
- CSV export (query results and full-table streaming export)
- Database upload, download, and delete from sidebar
- Query history and local settings persistence

## Tech Stack

- Vite 5
- Vanilla JavaScript (ES modules)
- Bootstrap 5 + SCSS theme
- Font Awesome (icons)
- SweetAlert2 (toasts/confirm dialogs)
- SQLite WASM + Web Worker

## Getting Started

### Prerequisites

- Node.js `>=22`
- npm

### Install

```bash
npm install
```

`postinstall` runs `scripts/copy-sqlite-wasm.js` to place SQLite WASM assets in the expected public path.

### Run Dev Server

```bash
npm run dev
```

Then open the local URL shown by Vite.

### Build & Preview

```bash
npm run build
npm run preview
```

## Available Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start Vite dev server |
| `npm run build` | Create production build |
| `npm run preview` | Preview production build |
| `npm run setup` | Copy SQLite WASM runtime files |
| `npm run lint` | Lint JavaScript files with ESLint |
| `npm run lint:fix` | Auto-fix ESLint issues |
| `npm run format` | Format project files with Prettier |
| `npm run format:check` | Check formatting only |

## How It Works

1. UI sends commands to a dedicated SQLite worker (`src/public/js/sqlite-worker.js`).
2. Worker opens/executes against OPFS database files under `/scl-databases`.
3. Results are returned to the main thread for rendering and export.
4. Query history/settings are stored in browser local storage.

## Project Structure

```text
src/
	index.html                     # Main application page
	common/js/
		scl-app.js                   # Main app logic and UI orchestration
		scl-utils.js                 # OPFS, download, CSV, history, settings helpers
		dom.js                       # DOM helper utilities
		toast.js                     # SweetAlert2 wrappers
		bsToast.js                   # Bootstrap native toast helpers
	page_assets/index/js/main.js   # Entry point imports Bootstrap + styles + app init
	public/js/sqlite-worker.js     # SQLite worker runtime
	public/sqlite-wasm/            # WASM runtime files copied on setup/postinstall
	scss/                          # Theme and component styles
scripts/
	copy-sqlite-wasm.js            # Copies SQLite WASM assets into public folder
```

## Usage Notes

- Upload one or more `.db/.sqlite/.sqlite3` files from the top navbar.
- Select a database in the left sidebar to connect.
- Use the sidebar actions to download or delete a database file.
- Use **Run** or `Ctrl/Cmd + Enter` to execute SQL.
- Use results toolbar to copy TSV or export CSV.

## Environment

The project supports Vite-style environment variables (`VITE_*`).

Example access pattern:

```js
import.meta.env.VITE_API_BASE_URL;
```

## Repository

- GitHub: https://github.com/airen1986/sqlite-client

## License

[MIT](LICENSE)

