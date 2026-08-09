import ora, { type Ora } from 'ora';
import { bold, brand, block, muted, pass, subtle } from './theme.js';

const isTty = (): boolean =>
  !!process.stderr.isTTY && !process.env['NO_COLOR'] && !process.env['CI'];

export interface StageProgress {
  start(stage: string, detail?: string): void;
  succeed(stage: string, durationMs: number, extra?: string): void;
  fail(stage: string, durationMs: number, error?: string): void;
  skip(stage: string, reason?: string): void;
  cached(stage: string): void;
}

/** Pulsing star, matching the mark's weight. Cycles roughly once per second. */
const FRAMES = ['·', '✢', '✳', '✻', '✽', '✻', '✳', '✢'];

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

/** Stage labels are padded to a common width so the persisted lines form a column. */
const LABEL_WIDTH = 9;

class TtyProgress implements StageProgress {
  private spinner: Ora | null = null;
  private ticker: NodeJS.Timeout | null = null;
  private startedAt = 0;
  private stage = '';
  private detail = '';

  start(stage: string, detail?: string): void {
    this.clearTicker();
    this.spinner?.stop();

    this.stage = stage;
    this.detail = detail ?? '';
    this.startedAt = Date.now();

    this.spinner = ora({
      spinner: { interval: 120, frames: FRAMES },
      stream: process.stderr,
      text: this.line(),
    }).start();

    // Re-render every 500ms so the elapsed counter ticks while the stage runs.
    // unref() keeps this timer from holding the event loop open at exit.
    this.ticker = setInterval(() => {
      if (this.spinner) this.spinner.text = this.line();
    }, 500);
    this.ticker.unref?.();
  }

  private line(): string {
    const elapsed = subtle(`(${seconds(Date.now() - this.startedAt)})`);
    const detail = this.detail ? ` ${subtle(this.detail)}` : '';
    return `${bold(this.stage.padEnd(LABEL_WIDTH))}${detail} ${elapsed}`;
  }

  private clearTicker(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  /** Replaces the spinner with a persisted, symbol-prefixed line. */
  private settle(symbol: string, text: string): void {
    this.clearTicker();
    if (this.spinner) {
      this.spinner.stopAndPersist({ symbol, text });
      this.spinner = null;
    } else {
      process.stderr.write(`${symbol} ${text}\n`);
    }
  }

  succeed(stage: string, durationMs: number, extra?: string): void {
    this.settle(
      pass('✓'),
      `${bold(stage.padEnd(LABEL_WIDTH))}${extra ? ` ${extra}` : ''} ${subtle(seconds(durationMs))}`,
    );
  }

  fail(stage: string, durationMs: number, error?: string): void {
    this.settle(
      block('✕'),
      `${bold(stage.padEnd(LABEL_WIDTH))}${error ? ` ${block(error)}` : ''} ${subtle(seconds(durationMs))}`,
    );
  }

  skip(stage: string, reason?: string): void {
    this.settle(
      subtle('–'),
      subtle(`${stage.padEnd(LABEL_WIDTH)}${reason ? ` ${reason}` : 'skipped'}`),
    );
  }

  cached(stage: string): void {
    this.settle(brand('↩'), `${bold(stage.padEnd(LABEL_WIDTH))} ${muted('cached')}`);
  }
}

/** Non-TTY: one line per transition, no animation, no cursor control. */
class PlainProgress implements StageProgress {
  start(stage: string, detail?: string): void {
    process.stderr.write(`  ${stage}${detail ? ` — ${detail}` : ''}...\n`);
  }
  succeed(stage: string, durationMs: number, extra?: string): void {
    process.stderr.write(`  ✓ ${stage} (${seconds(durationMs)})${extra ? `  ${extra}` : ''}\n`);
  }
  fail(stage: string, durationMs: number, error?: string): void {
    process.stderr.write(`  ✕ ${stage} (${seconds(durationMs)})${error ? `: ${error}` : ''}\n`);
  }
  skip(stage: string, reason?: string): void {
    process.stderr.write(`  – ${stage}${reason ? ` (${reason})` : ''}\n`);
  }
  cached(stage: string): void {
    process.stderr.write(`  ↩ ${stage} (cached)\n`);
  }
}

class SilentProgress implements StageProgress {
  start(): void {}
  succeed(): void {}
  fail(): void {}
  skip(): void {}
  cached(): void {}
}

export function createProgress(quiet: boolean): StageProgress {
  if (quiet) return new SilentProgress();
  if (isTty()) return new TtyProgress();
  return new PlainProgress();
}
