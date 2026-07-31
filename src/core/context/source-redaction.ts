import { isExcluded } from '../repository/file-selection.js';

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg',
  '.pdf', '.zip', '.tar', '.gz', '.woff', '.woff2', '.ttf', '.eot',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
]);

const ALWAYS_EXCLUDED = [
  'node_modules/**', '.git/**', '.crosscheck/runs/**', '.crosscheck/cache/**',
  'dist/**', 'build/**', '.next/**', '__pycache__/**', '*.pyc',
  'vendor/**', 'coverage/**', '.nyc_output/**',
];

const LOCKFILES = [
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb',
  'Pipfile.lock', 'poetry.lock', 'Cargo.lock',
];

export function isBinaryPath(filePath: string): boolean {
  const ext = '.' + filePath.split('.').pop()?.toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

export function isLockfile(filePath: string): boolean {
  const name = filePath.split('/').at(-1) ?? filePath.split('\\').at(-1) ?? '';
  return LOCKFILES.includes(name);
}

export function shouldExcludeFromContext(filePath: string, excludePatterns: string[]): boolean {
  if (isBinaryPath(filePath)) return true;
  return isExcluded(filePath, [...ALWAYS_EXCLUDED, ...excludePatterns]);
}

export function shouldExcludeFromLlm(filePath: string, excludePatterns: string[]): boolean {
  if (shouldExcludeFromContext(filePath, excludePatterns)) return true;
  // Lockfiles are excluded from full LLM context unless dependency changes matter
  if (isLockfile(filePath)) return true;
  return false;
}
