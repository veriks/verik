import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { customAlphabet } from 'nanoid';
import {
  MemoryIndexSchema,
  StoredFindingSchema,
  OverrideSchema,
  RunSummarySchema,
} from './memory-schema.js';
import type {
  MemoryIndex,
  StoredFinding,
  Override,
  RunSummary,
} from './memory-schema.js';
import { logger } from '../../shared/logger.js';

const generateId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 10);

const MEMORY_DIR = '.crosscheck';
const MEMORY_FILE = 'memory.json';

function memoryPath(repoRoot: string): string {
  return join(repoRoot, MEMORY_DIR, MEMORY_FILE);
}

async function loadIndex(repoRoot: string): Promise<MemoryIndex> {
  const path = memoryPath(repoRoot);
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    const result = MemoryIndexSchema.safeParse(parsed);
    if (result.success) return result.data;
    logger.warn(`Memory index parse error: ${result.error.message}. Starting fresh.`);
  } catch {
    // file doesn't exist yet — start fresh
  }
  return {
    version: 1,
    runs: [],
    findings: [],
    overrides: [],
    lastUpdated: new Date().toISOString(),
  };
}

async function saveIndex(repoRoot: string, index: MemoryIndex): Promise<void> {
  const path = memoryPath(repoRoot);
  await mkdir(join(repoRoot, MEMORY_DIR), { recursive: true });
  const updated = { ...index, lastUpdated: new Date().toISOString() };
  const tmp = path + '.tmp';
  await writeFile(tmp, JSON.stringify(updated, null, 2), 'utf8');
  const { rename } = await import('node:fs/promises');
  await rename(tmp, path);
}

export async function saveRun(repoRoot: string, summary: Omit<RunSummary, never>): Promise<void> {
  const parsed = RunSummarySchema.safeParse(summary);
  if (!parsed.success) {
    logger.warn(`saveRun: invalid summary: ${parsed.error.message}`);
    return;
  }
  const index = await loadIndex(repoRoot);
  // Replace if run already exists, otherwise prepend
  const existing = index.runs.findIndex((r) => r.runId === summary.runId);
  if (existing >= 0) {
    index.runs[existing] = parsed.data;
  } else {
    index.runs.unshift(parsed.data);
  }
  // Keep last 500 runs
  if (index.runs.length > 500) index.runs = index.runs.slice(0, 500);
  await saveIndex(repoRoot, index);
}

export async function saveFinding(
  repoRoot: string,
  finding: Omit<StoredFinding, 'id'>,
): Promise<string> {
  const id = `mf_${generateId()}`;
  const parsed = StoredFindingSchema.safeParse({ ...finding, id });
  if (!parsed.success) {
    logger.warn(`saveFinding: invalid finding: ${parsed.error.message}`);
    return id;
  }
  const index = await loadIndex(repoRoot);
  index.findings.unshift(parsed.data);
  // Keep last 2000 findings
  if (index.findings.length > 2000) index.findings = index.findings.slice(0, 2000);
  await saveIndex(repoRoot, index);
  return id;
}

export async function saveOverride(
  repoRoot: string,
  override: Omit<Override, 'id' | 'createdAt'>,
): Promise<string> {
  const id = `mo_${generateId()}`;
  const parsed = OverrideSchema.safeParse({
    ...override,
    id,
    createdAt: new Date().toISOString(),
  });
  if (!parsed.success) {
    logger.warn(`saveOverride: invalid override: ${parsed.error.message}`);
    return id;
  }
  const index = await loadIndex(repoRoot);
  index.overrides.push(parsed.data);
  await saveIndex(repoRoot, index);
  return id;
}

export async function markEscaped(
  repoRoot: string,
  findingId: string,
  note: string,
): Promise<void> {
  const index = await loadIndex(repoRoot);
  const finding = index.findings.find((f) => f.id === findingId);
  if (!finding) {
    logger.warn(`markEscaped: finding ${findingId} not found`);
    return;
  }
  finding.escaped = true;
  finding.escapeNote = note;
  await saveIndex(repoRoot, index);
}

export async function getRecentFindings(
  repoRoot: string,
  filePath: string,
  limit = 10,
): Promise<StoredFinding[]> {
  const index = await loadIndex(repoRoot);
  return index.findings
    .filter((f) => f.filePath === filePath)
    .slice(0, limit);
}

export async function getActiveOverrides(repoRoot: string): Promise<Override[]> {
  const index = await loadIndex(repoRoot);
  const now = new Date().toISOString();
  return index.overrides.filter((o) => !o.expiresAt || o.expiresAt > now);
}

export async function getRunHistory(repoRoot: string, limit = 20): Promise<RunSummary[]> {
  const index = await loadIndex(repoRoot);
  return index.runs.slice(0, limit);
}
