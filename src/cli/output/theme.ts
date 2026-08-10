import chalk from 'chalk';

/**
 * Crosscheck's visual identity, shared by every terminal surface.
 *
 * These hex values mirror the HTML report (src/core/reports/report-renderer-html.ts)
 * so a verdict is the same colour whether you read it in the terminal or the
 * browser. Chalk downgrades hex to 256- or 16-colour automatically depending on
 * what the terminal advertises.
 */
export const palette = {
  brand: '#3b82f6', // accent — rails, wordmark, links
  block: '#ff4444',
  warn: '#f59e0b',
  pass: '#22c55e',
  muted: '#a1a1a1',
  subtle: '#525252',
} as const;

const colorEnabled = (): boolean => !!process.stdout.isTTY && !process.env['NO_COLOR'];

/** Wraps a chalk style so it no-ops when colour is disabled. */
const paint =
  (style: (s: string) => string) =>
  (s: string): string =>
    colorEnabled() ? style(s) : s;

export const brand = paint(chalk.hex(palette.brand));
export const block = paint(chalk.hex(palette.block));
export const warn = paint(chalk.hex(palette.warn));
export const pass = paint(chalk.hex(palette.pass));
export const muted = paint(chalk.hex(palette.muted));
export const subtle = paint(chalk.hex(palette.subtle));
export const bold = paint(chalk.bold);
export const underline = paint(chalk.underline);

/**
 * The mark: a check and a cross — the two things the tool decides between.
 *
 * The space between them is load-bearing. Both glyphs are full-width in most
 * monospace fonts, so set adjacent they visually collide into one smudge.
 *
 * MARK_RAW is the uncoloured form; anything aligning a column must measure with
 * it, since the coloured version carries escape codes that have no width.
 */
export const MARK_RAW = '✓ ✕';
export const mark = (): string => `${pass('✓')} ${block('✕')}`;

export const wordmark = (): string => `${mark()}  ${bold('crosscheck')}`;

/** Total width of framed output, clamped so it stays readable in wide terminals. */
export const frameWidth = (): number =>
  Math.max(40, Math.min((process.stdout.columns ?? 80) - 2, 76));

export const severityTint = (severity: string): ((s: string) => string) =>
  severity === 'critical' || severity === 'high'
    ? block
    : severity === 'medium'
      ? warn
      : severity === 'info'
        ? brand
        : muted;

export const verdictTint = (verdict: string): ((s: string) => string) =>
  verdict === 'block' ? block : verdict === 'warn' ? warn : verdict === 'pass' ? pass : muted;

export function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Draws a titled box. Padding is computed from the raw strings before any
 * colour is applied — chalk's escape codes would otherwise corrupt the width.
 */
export function box(title: string, body: string, tint: (s: string) => string): string[] {
  const w = frameWidth();
  const head = `─ ${title} `;
  const top = `╭${head}${'─'.repeat(Math.max(0, w - 2 - head.length))}╮`;
  const bottom = `╰${'─'.repeat(w - 2)}╯`;

  const out = [tint(top)];
  for (const line of wrap(body, w - 4)) {
    out.push(`${tint('│')} ${line.padEnd(w - 4)} ${tint('│')}`);
  }
  out.push(tint(bottom));
  return out;
}

/**
 * Wordmark banner — the brand moment on `crosscheck` with no arguments.
 *
 * Deliberately not ASCII art. A box-drawing letterform depends on the terminal
 * font rendering ┌ ┬ ┴ ┘ at consistent widths with no gaps; in most default
 * fonts, including Windows Terminal's, the strokes break apart and the word
 * becomes unreadable. A typeset lockup carries the identity through colour and
 * the mark instead, and renders identically everywhere.
 */
export function banner(): string {
  return [
    '',
    `  ${mark()}   ${bold(brand('crosscheck'))}`,
    `  ${' '.repeat(MARK_RAW.length)}   ${muted('independent verification for AI-generated code')}`,
    '',
  ].join('\n');
}

/** A labelled section heading, matching the FINDINGS/RULES blocks in a run. */
export function section(title: string): string {
  return muted(title.toUpperCase());
}

/**
 * Aligned label/value row. Padding is applied to the raw label before colour,
 * since escape codes have no display width.
 */
export function kv(label: string, value: string, width = 12): string {
  return `  ${muted(label.padEnd(width))}${value}`;
}

/** Full-width rule, optionally labelled. */
export function rule(label?: string): string {
  const w = frameWidth();
  if (!label) return subtle('─'.repeat(w));
  const text = ` ${label} `;
  const side = Math.max(0, Math.floor((w - text.length) / 2));
  return subtle('─'.repeat(side) + text + '─'.repeat(w - side - text.length));
}
