import { redactSecrets } from '../../shared/redaction.js';
import { shouldExcludeFromLlm } from '../context/source-redaction.js';
import type { RawPatch, SafePatch } from './patch-types.js';

/**
 * Removes excluded files and redacts secrets from a unified diff, before it
 * reaches any prompt, report or log.
 *
 * This runs at the point the canonical diff is produced so every downstream
 * consumer inherits it. Previously exclusion and redaction were applied only to
 * file *bodies* in the context selector, so a tracked `.env`, a `*.pem`, or an
 * `sk-…` on an added line travelled to the API inside the patch itself.
 *
 * This module is the sole minter of SafePatch — see patch-types.ts.
 */

export interface ExcludedFile {
  path: string;
  reason: 'privacy-policy';
}

export interface SanitizedPatch {
  patch: SafePatch;
  excludedFiles: ExcludedFile[];
  redactionCount: number;
}

const BEGIN_PRIVATE_KEY = /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/;
const END_PRIVATE_KEY = /-----END (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/;

/**
 * Structural lines carry no user content and must survive untouched. An `index`
 * line is a 40-hex blob id, which the base64-ish secret pattern would otherwise
 * redact — corrupting the patch.
 */
function isStructuralLine(line: string): boolean {
  return (
    line.startsWith('diff --git ') ||
    line.startsWith('index ') ||
    line.startsWith('--- ') ||
    line.startsWith('+++ ') ||
    line.startsWith('@@') ||
    line.startsWith('\\ ') ||
    line.startsWith('new file mode') ||
    line.startsWith('deleted file mode') ||
    line.startsWith('old mode') ||
    line.startsWith('new mode') ||
    line.startsWith('similarity index') ||
    line.startsWith('rename from') ||
    line.startsWith('rename to') ||
    line.startsWith('copy from') ||
    line.startsWith('copy to') ||
    line.startsWith('Binary files') ||
    line.startsWith('GIT binary patch')
  );
}

/** Splits a git-produced patch into whole per-file sections. */
export function splitFileSections(patch: string): string[] {
  if (!patch.trim()) return [];
  const lines = patch.split('\n');
  const sections: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith('diff --git ') && current.length) {
      sections.push(current.join('\n'));
      current = [];
    }
    current.push(line);
  }
  if (current.length) sections.push(current.join('\n'));
  return sections;
}

/**
 * Extracts the paths a section touches, from the `---`/`+++` headers rather
 * than the `diff --git` line — the latter is ambiguous for paths containing
 * spaces.
 */
export function pathsInSection(section: string): string[] {
  const paths = new Set<string>();
  for (const line of section.split('\n')) {
    if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      const raw = line.slice(4).trim();
      if (raw === '/dev/null') continue;
      paths.add(raw.replace(/^[ab]\//, ''));
    }
    if (line.startsWith('rename from ') || line.startsWith('copy from ')) {
      paths.add(line.replace(/^(?:rename|copy) from /, '').trim());
    }
    if (line.startsWith('rename to ') || line.startsWith('copy to ')) {
      paths.add(line.replace(/^(?:rename|copy) to /, '').trim());
    }
  }
  return [...paths];
}

/**
 * Redacts a hunk line while preserving its leading marker.
 *
 * The marker must be split off first: the long-base64 secret pattern matches
 * `+` and `/`, so redacting a whole line can consume the leading `+` and turn
 * an addition into a context line — silently corrupting every consumer that
 * classifies lines by their first character.
 */
function redactHunkLine(line: string): { line: string; redacted: boolean } {
  const marker = line[0];
  if (marker !== '+' && marker !== '-' && marker !== ' ') {
    return { line, redacted: false };
  }
  const body = line.slice(1);
  const cleaned = redactSecrets(body);
  return { line: marker + cleaned, redacted: cleaned !== body };
}

export function sanitizePatch(patch: RawPatch, excludePatterns: string[]): SanitizedPatch {
  const excludedFiles: ExcludedFile[] = [];
  let redactionCount = 0;
  const kept: string[] = [];

  for (const section of splitFileSections(patch)) {
    const paths = pathsInSection(section);
    // Check every path the section names, so a rename off `.env` is still caught.
    const excluded = paths.filter((p) => shouldExcludeFromLlm(p, excludePatterns));
    if (excluded.length) {
      for (const p of excluded) excludedFiles.push({ path: p, reason: 'privacy-policy' });
      continue;
    }

    const out: string[] = [];
    let inPrivateKey = false;

    for (const line of section.split('\n')) {
      if (isStructuralLine(line)) {
        out.push(line);
        continue;
      }

      // A private key spans many lines, so the single-line regex cannot see it;
      // track the BEGIN/END block explicitly.
      if (BEGIN_PRIVATE_KEY.test(line)) inPrivateKey = true;
      if (inPrivateKey) {
        const marker = line[0] === '+' || line[0] === '-' || line[0] === ' ' ? line[0] : '';
        out.push(`${marker}[REDACTED]`);
        redactionCount++;
        if (END_PRIVATE_KEY.test(line)) inPrivateKey = false;
        continue;
      }

      const result = redactHunkLine(line);
      if (result.redacted) redactionCount++;
      out.push(result.line);
    }

    kept.push(out.join('\n'));
  }

  const sanitized = kept.join('\n');

  // Fail closed: if an excluded path somehow survived, drop the patch entirely.
  // Sending no diff is always preferable to sending a leaking one.
  for (const section of splitFileSections(sanitized)) {
    for (const p of pathsInSection(section)) {
      if (shouldExcludeFromLlm(p, excludePatterns)) {
        return {
          patch: '' as SafePatch,
          excludedFiles: [...excludedFiles, { path: p, reason: 'privacy-policy' }],
          redactionCount,
        };
      }
    }
  }

  return { patch: sanitized as SafePatch, excludedFiles, redactionCount };
}

/**
 * Truncates on whole file-section boundaries. Slicing bytes mid-hunk produces a
 * syntactically invalid diff, and can also remove the `-----END` marker a
 * multi-line secret pattern depends on.
 */
export function truncatePatch(
  patch: string,
  maxBytes: number,
): { patch: string; truncated: boolean; droppedFiles: string[] } {
  if (Buffer.byteLength(patch) <= maxBytes) {
    return { patch, truncated: false, droppedFiles: [] };
  }

  const sections = splitFileSections(patch);
  const kept: string[] = [];
  const dropped: string[] = [];
  let size = 0;

  for (const section of sections) {
    const cost = Buffer.byteLength(section) + 1;
    if (size + cost > maxBytes) {
      dropped.push(...pathsInSection(section));
      continue;
    }
    kept.push(section);
    size += cost;
  }

  const note = dropped.length ? `\n... [diff truncated: ${dropped.length} file(s) omitted]` : '';
  return { patch: kept.join('\n') + note, truncated: true, droppedFiles: dropped };
}

export interface PreparedPatch extends SanitizedPatch {
  truncated: boolean;
  droppedFiles: string[];
}

/**
 * The single path from git output to something sendable: redact, then truncate.
 *
 * Order is load-bearing and not interchangeable. Truncating first can cut a
 * `-----BEGIN PRIVATE KEY-----` block before its `-----END`, and both the
 * multi-line regex and the stateful block tracker key off that terminator — so
 * the tail of a key would survive into the prompt as ordinary base64.
 */
export function prepareSafePatch(
  raw: RawPatch,
  excludePatterns: string[],
  maxBytes: number,
): PreparedPatch {
  const sanitized = sanitizePatch(raw, excludePatterns);
  const truncated = truncatePatch(sanitized.patch, maxBytes);

  return {
    patch: truncated.patch as SafePatch,
    excludedFiles: sanitized.excludedFiles,
    redactionCount: sanitized.redactionCount,
    truncated: truncated.truncated,
    droppedFiles: truncated.droppedFiles,
  };
}

/**
 * Re-brands text derived from an already-safe patch.
 *
 * Legitimate only when `derived` is a pure length reduction of `source` —
 * truncation, slicing — so no unsanitised content can be reintroduced. Every
 * call site is a place a reviewer should look; there should be very few.
 */
export function narrowSafePatch(_source: SafePatch, derived: string): SafePatch {
  return derived as SafePatch;
}
