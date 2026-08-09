#!/usr/bin/env node
// Builds standalone binaries for all platforms and generates sha256 checksums.
// Designed to run in GitHub Actions on Ubuntu — pkg cross-compiles for all targets.
// Local dev on Windows/Mac: use `npm install -g crosscheck` or `pnpm link` instead.

import { execSync } from 'node:child_process';
import { createReadStream, mkdirSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

mkdirSync('releases', { recursive: true });

const TARGETS = [
  'node20-linux-x64',
  'node20-linux-arm64',
  'node20-macos-x64',
  'node20-macos-arm64',
  'node20-win-x64',
];

console.log('Building binaries for all platforms...');
execSync(
  `node node_modules/@yao-pkg/pkg/lib-es5/bin.js dist-bin/index.cjs` +
  ` --targets ${TARGETS.join(',')}` +
  ` --output releases/crosscheck`,
  { stdio: 'inherit' },
);

console.log('\nGenerating sha256 checksums...');
const files = (await readdir('releases')).filter(f => !f.includes('checksum'));
const lines = await Promise.all(
  files.map(async f => {
    const hash = await fileHash(join('releases', f));
    return `${hash}  ${f}`;
  }),
);
await writeFile('releases/checksums.txt', lines.join('\n') + '\n');

console.log('\nReleases:');
files.forEach(f => console.log(' ', join('releases', f)));
console.log('  releases/checksums.txt');

async function fileHash(path) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path)
      .on('data', d => h.update(d))
      .on('end',  () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}
