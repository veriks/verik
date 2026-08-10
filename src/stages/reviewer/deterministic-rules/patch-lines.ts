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

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function* iterateAddedLines(patch: string): Generator<AddedLine> {
  let path = '';
  let lineNo = 0;

  for (const raw of patch.split('\n')) {
    // `+++ b/path` is the authoritative new-side path. Checked before the
    // added-line branch, since it also starts with '+'.
    if (raw.startsWith('+++ ')) {
      const p = raw.slice(4).trim();
      path = p === '/dev/null' ? '' : p.replace(/^b\//, '');
      continue;
    }
    if (raw.startsWith('--- ') || raw.startsWith('diff --git ') || raw.startsWith('index ')) {
      continue;
    }

    const hunk = HUNK.exec(raw);
    if (hunk) {
      lineNo = Number(hunk[1]);
      continue;
    }

    if (raw.startsWith('+')) {
      yield { path, line: lineNo, text: raw.slice(1), raw };
      lineNo++;
      continue;
    }
    // Context lines advance the new-side counter; removals do not exist on it.
    if (raw.startsWith(' ')) lineNo++;
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
