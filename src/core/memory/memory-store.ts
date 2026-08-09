import { readFile, writeFile, mkdir, open } from 'node:fs/promises';
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
const LOCK_FILE = 'memory.lock';
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_RETRY_INTERVAL_MS = 50;

function memoryPath(repoRoot: string): string {
  return join(repoRoot, MEMORY_DIR, MEMORY_FILE);
}

function lockPath(repoRoot: string): string {
  return join(repoRoot, MEMORY_DIR, LOCK_FILE);
}

/**
 * File-based exclusive lock for memory.json.
 * Prevents concurrent crosscheck processes on the same repo from clobbering
 * each other's read-modify-write cycle.
 * Uses O_EXCL (exclusive create) — atomic on POSIX and Windows NTFS.
 */
async function acquireLock(repoRoot: string): Promise<() => Promise<void>> {
  const lp = lockPath(repoRoot);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const fh = await open(lp, 'wx');  // exclusive create — fails if exists
      await fh.writeFile(String(process.pid));
      await fh.close();
      return async () => {
        try { await import('node:fs/promises').then((fs) => fs.unlink(lp)); } catch { /* ignore */ }
      };
    } catch {
      await sleep(LOCK_RETRY_INTERVAL_MS);
    }
  }
  // Lock timeout — proceed anyway (stale lock from a crashed process).
  logger.warn('Memory lock timed out — proceeding without lock (possible stale lock).');
  return async () => {};
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
  return { version: 1, runs: [], findings: [], overrides: [], lastUpdated: new Date().toISOString() };
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

/** Execute a read-modify-write on the memory index under an exclusive file lock. */
async function withLock<T>(repoRoot: string, fn: (index: MemoryIndex) => Promise<{ index: MemoryIndex; result: T }>): Promise<T> {
  const release = await acquireLock(repoRoot);
  try {
    const index = await loadIndex(repoRoot);
    const { index: updated, result } = await fn(index);
    await saveIndex(repoRoot, updated);
    return result;
  } finally {
    await release();
  }
}

export async function saveRun(repoRoot: string, summary: RunSummary): Promise<void> {
  const parsed = RunSummarySchema.safeParse(summary);
  if (!parsed.success) { logger.warn(`saveRun: invalid summary: ${parsed.error.message}`); return; }
  await withLock(repoRoot, async (index) => {
    const existing = index.runs.findIndex((r) => r.runId === summary.runId);
    if (existing >= 0) index.runs[existing] = parsed.data;
    else index.runs.unshift(parsed.data);
    if (index.runs.length > 500) index.runs = index.runs.slice(0, 500);
    return { index, result: undefined };
  });
}

export async function saveFinding(repoRoot: string, finding: Omit<StoredFinding, 'id'>): Promise<string> {
  const id = `mf_${generateId()}`;
  const parsed = StoredFindingSchema.safeParse({ ...finding, id });
  if (!parsed.success) { logger.warn(`saveFinding: invalid finding: ${parsed.error.message}`); return id; }
  await withLock(repoRoot, async (index) => {
    index.findings.unshift(parsed.data);
    if (index.findings.length > 2000) index.findings = index.findings.slice(0, 2000);
    return { index, result: undefined };
  });
  return id;
}

export async function saveOverride(repoRoot: string, override: Omit<Override, 'id' | 'createdAt'>): Promise<string> {
  const id = `mo_${generateId()}`;
  const parsed = OverrideSchema.safeParse({ ...override, id, createdAt: new Date().toISOString() });
  if (!parsed.success) { logger.warn(`saveOverride: invalid override: ${parsed.error.message}`); return id; }
  await withLock(repoRoot, async (index) => {
    index.overrides.push(parsed.data);
    return { index, result: undefined };
  });
  return id;
}

export async function markEscaped(repoRoot: string, findingId: string, note: string): Promise<void> {
  await withLock(repoRoot, async (index) => {
    const finding = index.findings.find((f) => f.id === findingId);
    if (!finding) { logger.warn(`markEscaped: finding ${findingId} not found`); }
    else { finding.escaped = true; finding.escapeNote = note; }
    return { index, result: undefined };
  });
}

export async function getRecentFindings(repoRoot: string, filePath: string, limit = 10): Promise<StoredFinding[]> {
  const index = await loadIndex(repoRoot);
  return index.findings.filter((f) => f.filePath === filePath).slice(0, limit);
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
