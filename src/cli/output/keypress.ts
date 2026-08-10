import { emitKeypressEvents } from 'node:readline';

/**
 * Raw-mode keyboard handling for interactive prompts.
 *
 * Node's readline can emit keypress events without any dependency, but raw mode
 * comes with an obligation: while it is on, the terminal will not echo, will not
 * show a cursor if we hid it, and will not translate Ctrl-C into SIGINT. If we
 * exit any path without restoring those, the user's shell is left broken and
 * they have to run `reset`. Everything here is therefore wrapped so the restore
 * happens on success, on throw, and on signal.
 */

export interface Key {
  name?: string;
  ctrl: boolean;
  shift: boolean;
  sequence?: string;
}

const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

/** Thrown when the user presses Ctrl-C or Escape during a prompt. */
export class PromptCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'PromptCancelled';
  }
}

/**
 * Runs `handler` with the terminal in raw mode, restoring it afterwards no
 * matter how the function exits.
 */
export async function withRawMode<T>(
  handler: (onKey: (cb: (key: Key) => void) => void) => Promise<T>,
): Promise<T> {
  const stdin = process.stdin;
  const wasRaw = stdin.isRaw ?? false;

  emitKeypressEvents(stdin);
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  process.stdout.write(HIDE_CURSOR);

  let listener: ((str: string, key: Key) => void) | undefined;

  const restore = (): void => {
    if (listener) stdin.off('keypress', listener);
    process.stdout.write(SHOW_CURSOR);
    if (stdin.isTTY) stdin.setRawMode(wasRaw);
    stdin.pause();
  };

  // A signal during raw mode would otherwise skip the restore entirely.
  const onSignal = (): void => {
    restore();
    process.exit(130);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    return await handler((cb) => {
      listener = (_str, key) => cb(key);
      stdin.on('keypress', listener);
    });
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    restore();
  }
}

/**
 * Redraws a block of lines in place.
 *
 * Tracks how many lines it last wrote so it can move the cursor back up exactly
 * that far — printing a fresh block each time would scroll the terminal and
 * leave a trail of stale menus behind.
 */
export class LiveRegion {
  private lines = 0;

  render(content: string[]): void {
    this.clear();
    process.stdout.write(content.join('\n') + '\n');
    this.lines = content.length;
  }

  clear(): void {
    if (this.lines === 0) return;
    // \x1b[1A up one line, \x1b[2K erase that whole line.
    process.stdout.write('\x1b[1A\x1b[2K'.repeat(this.lines));
    this.lines = 0;
  }

  /** Leaves the current content on screen and stops tracking it. */
  commit(): void {
    this.lines = 0;
  }
}

export const isCancel = (key: Key): boolean =>
  (key.ctrl && key.name === 'c') || key.name === 'escape';

export const isConfirm = (key: Key): boolean => key.name === 'return' || key.name === 'enter';

export const isUp = (key: Key): boolean => key.name === 'up' || key.name === 'k';

export const isDown = (key: Key): boolean => key.name === 'down' || key.name === 'j';
