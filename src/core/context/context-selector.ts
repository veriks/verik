import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DiffResult } from '../repository/diff-capture.js';
import { shouldExcludeFromLlm } from './source-redaction.js';
import { sliceFile } from './file-slicer.js';
import { createBudget, consumeBudget } from './context-budget.js';
import type { ContextBudget } from './context-budget.js';
import { redactSecrets } from '../../shared/redaction.js';
import { logger } from '../../shared/logger.js';

export interface SelectedContext {
  diff: string;
  changedFiles: ContextFile[];
  manifestFiles: ContextFile[];
  readmeExcerpt?: string;
  tokenBudget: ContextBudget;
  limitations: string[];
}

export interface ContextFile {
  path: string;
  content: string;
  startLine: number;
  endLine: number;
  truncated: boolean;
}

export interface ContextSelectorOptions {
  repoRoot: string;
  diff: DiffResult;
  maxDiffBytes: number;
  maxFileBytes: number;
  maxTotalTokens: number;
  excludePatterns: string[];
}

const MANIFEST_NAMES = [
  'package.json', 'pyproject.toml', 'requirements.txt', 'setup.py',
  'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle',
];
const README_NAMES = ['README.md', 'readme.md', 'README.txt'];

export async function selectContext(opts: ContextSelectorOptions): Promise<SelectedContext> {
  const { repoRoot, diff, maxFileBytes, maxTotalTokens, excludePatterns } = opts;
  const limitations: string[] = [];
  let budget = createBudget(maxTotalTokens);

  // Diff always goes first
  const patchResult = consumeBudget(budget, diff.patch);
  const patchForContext = patchResult.text;
  budget = patchResult.budget;
  if (budget.truncated) {
    limitations.push('Diff was truncated to fit token budget.');
  }

  // Changed files (excluding binary, lockfiles, secrets)
  const changedFiles: ContextFile[] = [];
  const filteredPaths = diff.changedFiles
    .filter((f) => f.changeType !== 'deleted' && !shouldExcludeFromLlm(f.path, excludePatterns));

  for (const f of filteredPaths) {
    if (budget.remainingTokens < 500) {
      limitations.push(`Skipped ${filteredPaths.length - changedFiles.length} files due to token budget.`);
      break;
    }
    const slice = await sliceFile(repoRoot, f.path, maxFileBytes);
    if (!slice) continue;
    const redacted = redactSecrets(slice.content);
    const result = consumeBudget(budget, redacted);
    budget = result.budget;
    changedFiles.push({ ...slice, content: result.text });
    if (slice.truncated) limitations.push(`${f.path} was truncated.`);
  }

  // Manifests
  const manifestFiles: ContextFile[] = [];
  for (const name of MANIFEST_NAMES) {
    const fullPath = join(repoRoot, name);
    if (!existsSync(fullPath)) continue;
    if (budget.remainingTokens < 300) break;
    const slice = await sliceFile(repoRoot, name, Math.min(maxFileBytes, 8000));
    if (!slice) continue;
    const result = consumeBudget(budget, slice.content);
    budget = result.budget;
    manifestFiles.push({ ...slice, content: result.text });
  }

  // README
  let readmeExcerpt: string | undefined;
  for (const name of README_NAMES) {
    const fullPath = join(repoRoot, name);
    if (!existsSync(fullPath)) continue;
    if (budget.remainingTokens < 200) break;
    try {
      const raw = await readFile(fullPath, 'utf8');
      const excerpt = raw.slice(0, 2000);
      const result = consumeBudget(budget, excerpt);
      budget = result.budget;
      readmeExcerpt = result.text;
    } catch {
      logger.debug(`Could not read ${name}`);
    }
    break;
  }

  return {
    diff: patchForContext,
    changedFiles,
    manifestFiles,
    readmeExcerpt,
    tokenBudget: budget,
    limitations,
  };
}
