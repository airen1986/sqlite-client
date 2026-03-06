import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readdirSync } from 'fs';

// Auto-discover HTML files in src/ for multi-page builds
function getHtmlInputs() {
  const srcDir = resolve(__dirname, 'src');
  const inputs = {};
  readdirSync(srcDir)
    .filter((file) => file.endsWith('.html'))
    .forEach((file) => {
      const name = file.replace('.html', '');
      inputs[name] = resolve(srcDir, file);
    });
  return inputs;
}

export default defineConfig({
  root: resolve(__dirname, 'src'),
  envDir: resolve(__dirname),
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: getHtmlInputs(),
    },
  },
  server: {
    port: 3000,
  },
});
