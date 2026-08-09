import ora, { type Ora } from 'ora';

const isTty = () => process.stderr.isTTY && !process.env['NO_COLOR'] && !process.env['CI'];

export interface StageProgress {
  start(stage: string, detail?: string): void;
  succeed(stage: string, durationMs: number, extra?: string): void;
  fail(stage: string, durationMs: number, error?: string): void;
  skip(stage: string, reason?: string): void;
  cached(stage: string): void;
}

class TtyProgress implements StageProgress {
  private spinner: Ora | null = null;

  start(stage: string, detail?: string): void {
    this.spinner?.stop();
    this.spinner = ora({
      text: detail ? `${stage}  ${detail}` : stage,
      stream: process.stderr,
      color: 'blue',
    }).start();
  }

  succeed(stage: string, durationMs: number, extra?: string): void {
    const dur = `${(durationMs / 1000).toFixed(1)}s`;
    this.spinner?.succeed(`${stage}  ${dur}${extra ? `  ${extra}` : ''}`);
    this.spinner = null;
  }

  fail(stage: string, durationMs: number, error?: string): void {
    const dur = `${(durationMs / 1000).toFixed(1)}s`;
    this.spinner?.fail(`${stage}  ${dur}${error ? `  ${error}` : ''}`);
    this.spinner = null;
  }

  skip(stage: string, reason?: string): void {
    this.spinner?.stop();
    this.spinner = null;
    ora({ stream: process.stderr }).stopAndPersist({
      symbol: '–',
      text: `${stage}${reason ? `  ${reason}` : ''}`,
    });
  }

  cached(stage: string): void {
    this.spinner?.stop();
    this.spinner = null;
    ora({ stream: process.stderr }).stopAndPersist({
      symbol: '↩',
      text: `${stage}  cached`,
    });
  }
}

class PlainProgress implements StageProgress {
  start(stage: string, detail?: string): void {
    process.stderr.write(`  ${stage}${detail ? ` — ${detail}` : ''}...\n`);
  }
  succeed(stage: string, durationMs: number, extra?: string): void {
    const dur = `${(durationMs / 1000).toFixed(1)}s`;
    process.stderr.write(`  ✓ ${stage} (${dur})${extra ? `  ${extra}` : ''}\n`);
  }
  fail(stage: string, durationMs: number, error?: string): void {
    const dur = `${(durationMs / 1000).toFixed(1)}s`;
    process.stderr.write(`  ✗ ${stage} (${dur})${error ? `: ${error}` : ''}\n`);
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
