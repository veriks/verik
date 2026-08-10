/**
 * Walks a unified diff and yields each added line with its real location.
 *
 * Rules previously scanned `patch.split('\n')` and reported `file: 'diff'` with
 * no line number, so a finding that could block a build could not say where the
 * problem was. Tracking the hunk headers gives every finding a genuine
 * `path:line`, which is what makes it evidence rather than an assertion.
 */

export interface AddedLine {
  /** Path on the new side of the diff. */
  path: string;
  /** 1-based line number in the file after the change. */
  line: number;
  /** Line content, without the leading '+'. */
  text: string;
  /** The raw diff line, including the marker. */
  raw: string;
}

/** A line on either side of the diff, with both line numbers resolved. */
export interface PatchLine {
  path: string;
  kind: 'add' | 'del' | 'ctx';
  /** 1-based line number on the new side; 0 for deletions. */
  newLine: number;
  /** 1-based line number on the old side; 0 for additions. */
  oldLine: number;
  text: string;
  raw: string;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Single pass over a unified diff, tracking both side's line numbers.
 *
 * Rules that detect *removal* — a deleted assertion, a dropped auth check, a
 * weakened .gitignore — need the old side, which an added-lines-only walk
 * cannot give them. Both public iterators are filters over this one so the
 * hunk-header arithmetic exists in exactly one place.
 */
export function* iteratePatchLines(patch: string): Generator<PatchLine> {
  let newPath = '';
  let oldPath = '';
  let newNo = 0;
  let oldNo = 0;

  for (const raw of patch.split('\n')) {
    // The file headers also start with '+'/'-', so they are matched first.
    if (raw.startsWith('+++ ')) {
      const p = raw.slice(4).trim();
      newPath = p === '/dev/null' ? '' : p.replace(/^b\//, '');
      continue;
    }
    if (raw.startsWith('--- ')) {
      const p = raw.slice(4).trim();
      oldPath = p === '/dev/null' ? '' : p.replace(/^a\//, '');
      continue;
    }
    if (raw.startsWith('diff --git ') || raw.startsWith('index ')) continue;

    const hunk = HUNK.exec(raw);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      continue;
    }

    if (raw.startsWith('+')) {
      yield { path: newPath, kind: 'add', newLine: newNo, oldLine: 0, text: raw.slice(1), raw };
      newNo++;
      continue;
    }
    if (raw.startsWith('-')) {
      // For a deleted file the new-side path is /dev/null, so fall back to the
      // old path — otherwise every finding in a deletion reports no file.
      yield {
        path: newPath || oldPath,
        kind: 'del',
        newLine: 0,
        oldLine: oldNo,
        text: raw.slice(1),
        raw,
      };
      oldNo++;
      continue;
    }
    if (raw.startsWith(' ')) {
      yield { path: newPath, kind: 'ctx', newLine: newNo, oldLine: oldNo, text: raw.slice(1), raw };
      newNo++;
      oldNo++;
    }
  }
}

export function* iterateAddedLines(patch: string): Generator<AddedLine> {
  for (const l of iteratePatchLines(patch)) {
    if (l.kind === 'add') yield { path: l.path, line: l.newLine, text: l.text, raw: l.raw };
  }
}

/** Lines the change removed, numbered against the file as it was before. */
export function* iterateRemovedLines(patch: string): Generator<AddedLine> {
  for (const l of iteratePatchLines(patch)) {
    if (l.kind === 'del') yield { path: l.path, line: l.oldLine, text: l.text, raw: l.raw };
  }
}

/**
 * Values that look like secrets but are placeholders.
 *
 * Deterministic findings can now deny a build, which makes a false positive far
 * more expensive than a miss — a tool that blocks on `password: "changeme"` in a
 * test fixture gets uninstalled the same day.
 */
const PLACEHOLDER = new RegExp(
  '^(?:' +
    [
      'x{3,}',
      '\\.{3,}',
      '[-_*]+',
      // Multi-segment placeholders: your-api-key-here, replace_with_token.
      // `[\\w-]*` rather than `\\w*` — the latter stops at the first hyphen,
      // which is how most real placeholders are written.
      '(?:your|my|our|insert|replace|enter|add)[-_ ][\\w-]*',
      'change[-_ ]?me',
      'placeholder',
      'example(?:[-_ ][\\w-]*)?',
      'sample',
      'dummy',
      'testing?',
      'fake',
      'redacted',
      'secret',
      'password',
      'todo',
      'tbd',
      'none',
      'null',
      'undefined',
      // Templated or indirected values are references, not the secret itself.
      '<[^>]*>',
      '\\$\\{[^}]*\\}',
      '\\$[A-Z_]+',
      'process\\.env\\.\\w+',
      'os\\.environ\\[[^\\]]*\\]',
    ].join('|') +
    ')$',
  'i',
);

export function looksLikePlaceholder(value: string): boolean {
  const v = value.trim();
  if (v.length === 0) return true;
  if (PLACEHOLDER.test(v)) return true;
  // A value with no character variety carries no entropy — "aaaaaaaa".
  if (new Set(v).size <= 2) return true;
  return false;
}
