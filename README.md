# Frontend Template

A modern frontend starter template built with **Vite**, **Bootstrap 5**, and **SCSS**.

## Features

- **Vite** — fast dev server and optimized builds
- **Bootstrap 5.3** — with deep SCSS variable customization (Brutopia theme)
- **Sass** — modular SCSS architecture with components, layouts, mixins, and utilities
- **SweetAlert2** — pre-configured toast and dialog helpers
- **ESLint + Prettier + Stylelint** — linting and formatting out of the box
- **Multi-page support** — Vite auto-discovers `.html` files in `src/`
- **GitHub Actions CI** — build, lint, and format checks on every PR

## Getting Started

### Prerequisites

- Node.js 18+ (see `.nvmrc`)
- npm

### Installation

```bash
npm install
```

Copy the example environment file and adjust as needed:

```bash
cp .env.example src/.env
```

### Development

```bash
npm run dev
```

Open `http://localhost:3000` in your browser.

### Build for Production

```bash
npm run build
```

Output goes to `dist/`.

### Preview Production Build

```bash
npm run preview
```

## Project Structure

```
├── src/
│   ├── common/
│   │   └── js/
│   │       ├── api.js           # Fetch-based API client
│   │       ├── toast.js         # SweetAlert2 toast helpers
│   │       └── dom.js           # DOM utility helpers
│   ├── page_assets/
│   │   └── index/
│   │       └── js/main.js       # Entry point for index page
│   ├── public/                  # Static assets (copied as-is)
│   ├── scss/
│   │   ├── components/          # Bootstrap component overrides
│   │   ├── layouts/             # Page layout styles
│   │   ├── mixins/              # SCSS mixins
│   │   ├── _variables.scss      # Bootstrap + theme variables
│   │   ├── _brutopia.scss       # Component import manifest
│   │   ├── _fonts.scss          # Self-hosted font declarations
│   │   ├── _utilities.scss      # Custom utility classes
│   │   └── styles.scss          # Main SCSS entry point
│   ├── .env                     # Environment variables (not committed)
│   └── index.html               # Landing page
├── .editorconfig
├── .env.example                 # Environment variable template
├── .github/workflows/ci.yml    # CI pipeline
├── .nvmrc                       # Node version
├── .prettierrc                  # Prettier config
├── .stylelintrc.json            # Stylelint config
├── eslint.config.js             # ESLint flat config
├── LICENSE
├── package.json
├── vite.config.js
└── README.md
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the production build |
| `npm run lint` | Lint JavaScript with ESLint |
| `npm run lint:fix` | Auto-fix ESLint issues |
| `npm run lint:css` | Lint SCSS with Stylelint |
| `npm run lint:css:fix` | Auto-fix Stylelint issues |
| `npm run format` | Format code with Prettier |
| `npm run format:check` | Check formatting without writing |

## Customization

### Theme Colors

Edit `src/scss/_variables.scss` to change the color palette:

```scss
$primary:   #141414;
$secondary: #A8A196;
$success:   #6fc59a;
$danger:    #d1503b;
```

### Adding a New Page

1. Create `src/my-page.html`
2. Create `src/page_assets/my-page/js/main.js` for page-specific JS
3. Vite will auto-discover the HTML file — no config changes needed

### Environment Variables

All `VITE_`-prefixed variables in `src/.env` are available in JS via `import.meta.env`:

```js
const apiUrl = import.meta.env.VITE_API_BASE_URL;
```

### JS Utilities

Pre-built helpers are available in `src/common/js/`:

```js
import api from '@/common/js/api';
import { toastSuccess } from '@/common/js/toast';
import { $, on } from '@/common/js/dom';
```

## License

[MIT](LICENSE)

