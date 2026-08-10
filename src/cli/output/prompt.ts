import { createInterface } from 'node:readline/promises';
import {
  LiveRegion,
  PromptCancelled,
  isCancel,
  isConfirm,
  isDown,
  isUp,
  withRawMode,
  type Key,
} from './keypress.js';
import { MARK_RAW, bold, brand, frameWidth, muted, pass, subtle, warn } from './theme.js';

/**
 * Interactive prompts for onboarding.
 *
 * Non-interactive safety is a hard requirement, not a nicety: Crosscheck is
 * routinely run by CI and by coding agents wrapping it, where stdin is not a
 * TTY. Every prompt returns its default in that case rather than blocking
 * forever on a keypress that will never arrive.
 */
export const isInteractive = (): boolean => Boolean(process.stdin.isTTY && process.stdout.isTTY);

export interface Choice<T> {
  value: T;
  label: string;
  hint?: string;
  /** Rendered dim after the label, e.g. an already-detected value. */
  badge?: string;
}

export interface SelectOptions<T> {
  question: string;
  choices: Choice<T>[];
  defaultIndex?: number;
  /** Lines drawn above the question, redrawn with it. */
  header?: string[];
  footer?: string;
}

const CANCEL_HINT = '↑↓ move · enter select · esc cancel';

/** Arrow-key list. Falls back to a numbered read when stdin is not a TTY. */
export async function select<T>(opts: SelectOptions<T>): Promise<T> {
  const { question, choices, header = [], defaultIndex = 0 } = opts;
  const fallback = choices[defaultIndex]!.value;
  if (!isInteractive()) return fallback;

  let index = defaultIndex;
  const region = new LiveRegion();

  const draw = (): void => {
    const lines: string[] = [...header, question, ''];
    choices.forEach((c, i) => {
      const selected = i === index;
      // Shape carries the selection as well as colour, so it survives NO_COLOR
      // and colour-blindness.
      const marker = selected ? brand('❯') : ' ';
      const label = selected ? brand(bold(c.label)) : c.label;
      const badge = c.badge ? ` ${pass(c.badge)}` : '';
      lines.push(`  ${marker} ${label}${badge}`);
    });
    // Only the selected item's hint is shown. Showing all of them at once turns
    // the list into a wall of grey text, and the single line reserved here keeps
    // the block a constant height so it never jumps as you move.
    lines.push('', `    ${subtle(choices[index]!.hint ?? '')}`);
    lines.push('', subtle(opts.footer ?? CANCEL_HINT));
    region.render(lines);
  };

  return withRawMode<T>(async (onKey) => {
    return new Promise<T>((resolve, reject) => {
      draw();
      onKey((key: Key) => {
        if (isCancel(key)) {
          region.clear();
          reject(new PromptCancelled());
          return;
        }
        if (isUp(key)) {
          index = (index - 1 + choices.length) % choices.length;
          draw();
          return;
        }
        if (isDown(key)) {
          index = (index + 1) % choices.length;
          draw();
          return;
        }
        // Number keys remain a shortcut — muscle memory from the old prompt,
        // and the only way to pick quickly in a long list.
        const digit = Number(key.sequence);
        if (Number.isInteger(digit) && digit >= 1 && digit <= choices.length) {
          index = digit - 1;
          draw();
          return;
        }
        if (isConfirm(key)) {
          region.clear();
          // Collapse the answered question to one line so the finished screen
          // reads as a summary rather than a scrollback of dead menus.
          console.log(`  ${pass('✓')} ${muted(question)} ${bold(choices[index]!.label)}`);
          resolve(choices[index]!.value);
        }
      });
    });
  });
}

/** Single-line text input. Returns `fallback` when not interactive. */
export async function ask(question: string, fallback = '', hint?: string): Promise<string> {
  if (!isInteractive()) return fallback;
  if (hint) console.log(`  ${subtle(hint)}`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const suffix = fallback ? subtle(` (${fallback})`) : '';
    const answer = (await rl.question(`  ${brand('›')} ${question}${suffix} `)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}

export type CheckState = 'ok' | 'none' | 'warn';

export interface CheckItem {
  label: string;
  detail: string;
  state?: CheckState;
}

/**
 * A checklist of things actually determined about the repository.
 *
 * Every line here reports a real result — the project type that was detected,
 * the commands the Builder would run, whether a key is present. Nothing is
 * padded with invented steps or artificial delay: a progress list that narrates
 * work nobody did is just a loading bar with extra words, and it would be the
 * one part of a verification tool that lies to you.
 */
export function checklist(items: CheckItem[], width = 16): string[] {
  return items.map(({ label, detail, state = 'ok' }) => {
    const glyph = state === 'ok' ? pass('✓') : state === 'warn' ? warn('!') : subtle('–');
    const value = state === 'none' ? subtle(detail) : detail;
    return `  ${glyph} ${muted(label.padEnd(width))}${value}`;
  });
}

/** Step indicator, right-aligned against the frame. */
export function stepHeader(mark: string, step: number, total: number): string[] {
  const left = `${mark}  ${bold('crosscheck')}`;
  const rawLeft = `${MARK_RAW}  crosscheck`;
  const right = `step ${step} of ${total}`;
  const gap = Math.max(1, frameWidth() - rawLeft.length - right.length);
  return [`\n${left}${' '.repeat(gap)}${subtle(right)}`, subtle('─'.repeat(frameWidth())), ''];
}
