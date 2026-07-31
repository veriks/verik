import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { runFilePath } from '../../storage/paths.js';
import { logger } from '../../shared/logger.js';

export interface CommandResult {
  exitCode: number;
  signalName?: string;
  stdoutPath: string;
  stderrPath: string;
}

export async function runCommand(
  command: string[],
  cwd: string,
  repoRoot: string,
  runId: string,
  abortSignal: AbortSignal,
): Promise<CommandResult> {
  const stdoutPath = runFilePath(repoRoot, runId, 'command.stdout.log');
  const stderrPath = runFilePath(repoRoot, runId, 'command.stderr.log');

  const stdoutStream = createWriteStream(stdoutPath, { flags: 'a' });
  const stderrStream = createWriteStream(stderrPath, { flags: 'a' });

  const [bin, ...args] = command;
  if (!bin) throw new Error('Empty command');

  logger.debug(`Spawning: ${command.join(' ')}`);

  const child = spawn(bin, args, {
    cwd,
    stdio: ['inherit', 'pipe', 'pipe'],
    env: process.env,
    shell: false,
  });

  child.stdout?.pipe(process.stdout, { end: false });
  child.stdout?.pipe(stdoutStream);
  child.stderr?.pipe(process.stderr, { end: false });
  child.stderr?.pipe(stderrStream);

  const forwardSignal = (sig: NodeJS.Signals) => {
    logger.debug(`Forwarding signal ${sig} to child process`);
    child.kill(sig);
  };

  process.on('SIGINT', () => forwardSignal('SIGINT'));
  process.on('SIGTERM', () => forwardSignal('SIGTERM'));

  if (abortSignal.aborted) {
    child.kill('SIGTERM');
  } else {
    abortSignal.addEventListener('abort', () => child.kill('SIGTERM'));
  }

  return new Promise((resolve, reject) => {
    child.on('error', (err) => {
      stdoutStream.close();
      stderrStream.close();
      reject(err);
    });

    child.on('close', (code, signal) => {
      stdoutStream.close();
      stderrStream.close();
      resolve({
        exitCode: code ?? 1,
        signalName: signal ?? undefined,
        stdoutPath,
        stderrPath,
      });
    });
  });
}
