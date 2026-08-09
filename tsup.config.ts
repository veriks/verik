import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  // Sourcemaps are for local debugging only — they embed the full original
  // TypeScript via sourcesContent, and are excluded from the npm tarball
  // by the "!dist/**/*.map" entry in package.json "files".
  sourcemap: true,
  minify: true,
  splitting: false,
  bundle: true,
  shims: false,
  dts: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
});
