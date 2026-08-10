import { createInterface } from 'node:readline/promises';
import { brand, muted, subtle } from './theme.js';

/**
 * Minimal interactive prompts for onboarding.
 *
 * Deliberately dependency-free and non-interactive-safe: when stdin is not a
 * TTY (CI, piped input, an agent wrapping us) every prompt returns its default
 * instead of hanging forever waiting for a keypress that will never come.
 */
export const isInteractive = (): boolean => Boolean(process.stdin.isTTY && process.stdout.isTTY);

export interface Choice<T> {
  value: T;
  label: string;
  hint?: string;
}

export async function select<T>(
  question: string,
  choices: Choice<T>[],
  defaultIndex = 0,
): Promise<T> {
  const fallback = choices[defaultIndex]!.value;
  if (!isInteractive()) return fallback;

  console.log(`\n${question}`);
  choices.forEach((c, i) => {
    const marker = i === defaultIndex ? brand('❯') : ' ';
    console.log(`  ${marker} ${brand(String(i + 1))}  ${c.label}`);
    if (c.hint) console.log(`      ${subtle(c.hint)}`);
  });

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(muted(`\nChoice [${defaultIndex + 1}]: `))).trim();
    if (!answer) return fallback;
    const index = Number(answer) - 1;
    return choices[index]?.value ?? fallback;
  } finally {
    rl.close();
  }
}

export async function ask(question: string, fallback = ''): Promise<string> {
  if (!isInteractive()) return fallback;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const suffix = fallback ? subtle(` [${fallback}]`) : '';
    const answer = (await rl.question(`${muted(question)}${suffix}: `)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}
