import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
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

  // Named handlers so they can be removed after the child exits.
  // Anonymous lambdas passed to process.on() cannot be removed and accumulate
  // across multiple runs in the same process (e.g. tests).
  const onSigint  = () => { logger.debug('Forwarding SIGINT');  child.kill('SIGINT');  };
  const onSigterm = () => { logger.debug('Forwarding SIGTERM'); child.kill('SIGTERM'); };
  const onAbort   = () => child.kill('SIGTERM');

  process.on('SIGINT',  onSigint);
  process.on('SIGTERM', onSigterm);

  if (abortSignal.aborted) {
    child.kill('SIGTERM');
  } else {
    abortSignal.addEventListener('abort', onAbort);
  }

  const cleanup = () => {
    process.off('SIGINT',  onSigint);
    process.off('SIGTERM', onSigterm);
    abortSignal.removeEventListener('abort', onAbort);
    stdoutStream.close();
    stderrStream.close();
  };

  return new Promise((resolve, reject) => {
    child.on('error', (err) => {
      cleanup();
      reject(err);
    });

    child.on('close', (code, signal) => {
      cleanup();
      resolve({
        exitCode: code ?? 1,
        signalName: signal ?? undefined,
        stdoutPath,
        stderrPath,
      });
    });
  });
}
