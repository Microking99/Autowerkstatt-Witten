import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit-Tests der Datenschicht und der Demo-Regeln (reines TypeScript, ohne React Native).
// Oberflächen werden mit Playwright gegen den Web-Export geprüft (e2e/).
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
