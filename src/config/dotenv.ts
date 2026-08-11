import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../shared/logger.js';

/**
 * Reads `.env` from the repository root into `process.env`.
 *
 * Setting an API key is where people get stuck, and almost never because the
 * key is wrong. VS Code's terminal may be PowerShell, Git Bash or cmd, each
 * with different syntax; `setx` only affects processes started afterwards; and
 * quotes copied out of a browser arrive curly and are rejected. A file has none
 * of those failure modes.
 *
 * Two deliberate constraints:
 *
 * Existing variables always win. An explicit `VERIK_API_KEY=... verik verify`
 * must not be silently overridden by a stale file, and CI secrets must outrank
 * anything checked out.
 *
 * Only the repository root is read — no walking up the tree. Picking up a
 * `.env` from a parent directory would mean the key in use depends on where the
 * repository happens to sit on disk.
 *
 * `.env` is in Verik's default `privacy.excludePatterns`, so the file this
 * reads from is the same one it refuses to send to a model.
 */

/** `KEY=value`, allowing `export ` and inline comments outside quotes. */
const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    const match = LINE.exec(line);
    if (!match) continue;
    const key = match[1]!;
    let value = match[2]!.trim();

    // A quoted value is taken literally, so a '#' inside it is not a comment.
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }

    out[key] = value;
  }

  return out;
}

export async function loadDotenv(repoRoot: string): Promise<number> {
  let text: string;
  try {
    text = await readFile(join(repoRoot, '.env'), 'utf8');
  } catch {
    return 0; // No file is the normal case.
  }

  let applied = 0;
  for (const [key, value] of Object.entries(parseDotenv(text))) {
    if (process.env[key] !== undefined) continue;
    process.env[key] = value;
    applied++;
  }

  // The count only; never the names, and never the values.
  if (applied > 0) logger.debug(`Loaded ${applied} variable(s) from .env`);
  return applied;
}
