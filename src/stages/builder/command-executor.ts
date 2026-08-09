import { execa } from 'execa';
import { tailLog } from './log-sanitizer.js';
import { canExecute } from './executable-lookup.js';
import type { BuilderCommandResult } from './builder-schema.js';
import type { PlannedCommand } from './command-planner.js';

export async function executeCommand(
  planned: PlannedCommand,
  cwd: string,
  timeoutMs: number,
  _index: number,
): Promise<BuilderCommandResult> {
  const start = Date.now();
  const parts = planned.command.split(' ');
  const bin = parts[0]!;
  const args = parts.slice(1);

  // Resolved before spawning: an unrunnable tool must not be reported as a
  // failing one. See executable-lookup.ts — the two are indistinguishable by
  // exit code once cmd.exe has had its say.
  if (!canExecute(bin)) {
    return {
      name: planned.name,
      command: planned.command,
      status: 'unavailable',
      exitCode: 0,
      durationMs: Date.now() - start,
      stdoutTail: '',
      stderrTail: `${bin} was not found on PATH — this check did not run.`,
    };
  }

  try {
    const result = await execa(bin, args, {
      cwd,
      timeout: timeoutMs,
      reject: false,
      all: true,
      env: { ...process.env, CI: '1', NO_COLOR: '1' },
    });

    const durationMs = Date.now() - start;
    const status = result.timedOut ? 'timed_out' : result.exitCode === 0 ? 'passed' : 'failed';

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
