import { defineConfig } from 'tsup';

/**
 * Build nach dist/ (ESM, Node 22). Die Workspace-Pakete (@werkstatt/contracts,
 * @werkstatt/domain) liegen als TypeScript-Quellen vor und werden mitgebündelt.
 */
export default defineConfig({
  entry: ['src/server.ts'],
  outDir: 'dist',
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  noExternal: [/^@werkstatt\//],
});
