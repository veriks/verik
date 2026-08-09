import { defineConfig } from 'tsup';

// Separate build config for standalone binary distribution.
// Outputs CommonJS (required by pkg) to dist-bin/.
// Dynamic imports are resolved at build time by tsup's bundler.
export default defineConfig({
  entry: ['src/cli/index.ts'],
  format: ['cjs'],
  target: 'node20',
  outDir: 'dist-bin',
  clean: true,
  sourcemap: false,
  minify: true,
  splitting: false,
  bundle: true,
  shims: true,   // ESM shims for __dirname, __filename, import.meta, etc.
  noExternal: [/.*/],  // bundle every dependency into the single file
});
