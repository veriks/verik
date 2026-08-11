import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 } from '../../shared/hashing.js';
import { logger } from '../../shared/logger.js';

const CACHE_DIR = '.verik/cache';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry<T> {
  key: string;
  cachedAt: string;
  expiresAt: string;
  repoId: string;
  data: T;
}

/**
 * Verification cache for deterministic stage results.
 *
 * Cache key combines repoId + inputHash so results never bleed between repos,
 * and expire automatically when the diff or commands change.
 *
 * Only used for Builder today (fully deterministic). AI stages are not cached —
 * promptHash + model changes would invalidate constantly and the TTL logic
 * would need to be much more careful.
 */
export class VerificationCache {
  constructor(private readonly repoRoot: string) {}

  private cachePath(key: string): string {
    return join(this.repoRoot, CACHE_DIR, `${key.slice(0, 16)}.json`);
  }

  /**
   * Build a cache key for Builder: repo identity + diff hash + command list.
   * Any change to the diff or the commands produces a new key and a cache miss.
   */
  static builderKey(repoId: string, diffHash: string, commands: string[]): string {
    return sha256(`builder:${repoId}:${diffHash}:${commands.sort().join(',')}`);
  }

  async get<T>(key: string, repoId: string): Promise<T | null> {
    const path = this.cachePath(key);
    try {
      const raw = await readFile(path, 'utf8');
      const entry = JSON.parse(raw) as CacheEntry<T>;
      if (entry.repoId !== repoId) {
        logger.debug('Cache miss: repoId mismatch');
        return null;
      }
      if (new Date(entry.expiresAt) < new Date()) {
        logger.debug('Cache miss: expired');
        return null;
      }
      logger.debug(`Cache hit: ${key.slice(0, 8)}…`);
      return entry.data;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, repoId: string, data: T): Promise<void> {
    const path = this.cachePath(key);
    const now = new Date();
    const entry: CacheEntry<T> = {
      key,
      cachedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + CACHE_TTL_MS).toISOString(),
      repoId,
      data,
    };
    try {
      await mkdir(join(this.repoRoot, CACHE_DIR), { recursive: true });
      const tmp = path + '.tmp';
      await writeFile(tmp, JSON.stringify(entry, null, 2), 'utf8');
      const { rename } = await import('node:fs/promises');
      await rename(tmp, path);
    } catch (err) {
      logger.warn(`Cache write failed (non-fatal): ${String(err)}`);
    }
  }
}
