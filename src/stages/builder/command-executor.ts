import { execa } from 'execa';
import { tailLog } from './log-sanitizer.js';
import type { BuilderCommandResult } from './builder-schema.js';
import type { PlannedCommand } from './command-planner.js';

export async function executeCommand(
  planned: PlannedCommand,
  cwd: string,
  timeoutMs: number,
  index: number,
): Promise<BuilderCommandResult> {
  const start = Date.now();
  const parts = planned.command.split(' ');
  const bin = parts[0]!;
  const args = parts.slice(1);

  try {
    const result = await execa(bin, args, {
      cwd,
      timeout: timeoutMs,
      reject: false,
      all: true,
      env: { ...process.env, CI: '1', NO_COLOR: '1' },
    });

    const durationMs = Date.now() - start;
    const status = result.timedOut
      ? 'timed_out'
      : result.exitCode === 0
      ? 'passed'
      : 'failed';

    return {
      name: planned.name,
      command: planned.command,
      status,
      exitCode: result.exitCode ?? 1,
      durationMs,
      stdoutTail: tailLog(result.stdout ?? ''),
      stderrTail: tailLog(result.stderr ?? ''),
    };
  } catch (err) {
    return {
      name: planned.name,
      command: planned.command,
      status: 'errored',
      exitCode: 1,
      durationMs: Date.now() - start,
      stdoutTail: '',
      stderrTail: String(err),
    };
  }
}
