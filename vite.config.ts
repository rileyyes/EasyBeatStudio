/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Adds a strict Content-Security-Policy to the production build only.
 * (The dev server injects inline scripts for hot reload, which a strict CSP would block.)
 * The app makes no network requests: everything runs and is stored locally.
 */
function productionCsp(): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'easybeat-production-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), productionCsp()],
  server: { port: 5173, strictPort: false, host: 'localhost' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
