# Agent Instructions

This document defines coding conventions for AI agents working in this repository.

## Core Principles

- **Vanilla only** — use plain HTML, CSS, and JavaScript. Do NOT introduce any frontend frameworks (React, Vue, Angular, Svelte, etc.) or TypeScript.
- **Bootstrap theme** — all UI must use Bootstrap 5 classes and the project's custom SCSS theme. Do not add Tailwind, Material UI, or any other CSS framework.
- **No additional JS libraries** — avoid adding new npm dependencies unless explicitly requested. Use native browser APIs (`fetch`, `document.querySelector`, `addEventListener`, etc.) instead of jQuery or utility libraries.

## Technology Stack

- **Build tool**: Vite
- **CSS**: Bootstrap 5.3 with custom SCSS variables (`src/scss/_variables.scss`)
- **Icons**: Font Awesome 6 (free) — use `<i class="fa-solid fa-*">`, `<i class="fa-regular fa-*">`, or `<i class="fa-brands fa-*">` classes. Do NOT use Bootstrap Icons or inline SVGs.
- **JS**: Vanilla ES modules (`type: "module"`)
- **Alerts/Toasts**: SweetAlert2 (already installed) and Bootstrap native toasts
- **Package manager**: npm

## File Structure Conventions

- HTML pages go in `src/` (e.g. `src/my-page.html`). Vite auto-discovers them.
- Page-specific JS goes in `src/page_assets/<page-name>/js/main.js`.
- Page-specific CSS goes in `src/page_assets/<page-name>/css/`.
- Shared/reusable JS utilities go in `src/common/js/`.
- Shared/reusable CSS goes in `src/common/css/`.
- SCSS variables and component overrides go in `src/scss/`.
- Static assets (images, fonts) go in `src/public/`.
- Icons: use Font Awesome classes (`fa-solid`, `fa-regular`, `fa-brands`). Do NOT add icon image files or SVG sprite sheets.

## Styling Rules

- Always use Bootstrap utility classes first (e.g. `mt-3`, `d-flex`, `text-muted`).
- For custom styles, write SCSS in the appropriate component file under `src/scss/components/`.
- Use the existing SCSS variables from `_variables.scss` — do not hardcode colors or spacing values.
- Keep custom CSS minimal; prefer Bootstrap's built-in classes.
- All buttons should use Bootstrap button classes (`btn btn-primary`, `btn-outline-danger`, etc.).

## JavaScript Rules

- Use ES module `import`/`export` syntax.
- Use the existing utilities where applicable:
  - `src/common/js/api.js` — for all HTTP requests (uses `VITE_API_BASE_URL`).
  - `src/common/js/toast.js` — for SweetAlert2 toast notifications.
  - `src/common/js/bsToast.js` — for Bootstrap native toast notifications.
  - `src/common/js/dom.js` — for DOM helpers (`$`, `$$`, `on`, `off`, `ready`).
- Do not use `var`. Use `const` by default, `let` only when reassignment is needed.
- Use `async`/`await` over `.then()` chains.
- Each HTML page should have its own entry JS file that imports Bootstrap and the main stylesheet:
  ```js
  import * as bootstrap from 'bootstrap/dist/js/bootstrap.bundle.min.js';
  window.bootstrap = bootstrap;
  import '../../../scss/styles.scss';
  ```

## Adding a New Page

1. Create `src/<page-name>.html` with the standard `<head>` (charset, viewport, title, favicon, meta tags).
2. Create `src/page_assets/<page-name>/js/main.js` with the Bootstrap + SCSS imports above.
3. Reference the entry script in the HTML: `<script type="module" src="/page_assets/<page-name>/js/main.js"></script>`.
4. Reuse the navbar and footer markup from `index.html`.

## Environment Variables

- All environment variables must be prefixed with `VITE_`.
- Access them via `import.meta.env.VITE_*`.
- Never hardcode API URLs — always use `VITE_API_BASE_URL` through the `api.js` client.

## Linting & Formatting

- Run `npm run lint` and `npm run lint:css` before considering work complete.
- Follow the ESLint, Prettier, and Stylelint configs in the project root.
