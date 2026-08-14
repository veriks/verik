import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The exit code is the entire integration surface.
 *
 * A git hook and a CI job cannot read the report; they read `$?`. So 2 has to
 * mean "policy blocked" every time, on every platform.
 *
 * `process.exit()` breaks that promise on Windows. Forcing exit while an HTTP
 * handle is still closing trips a libuv assertion —
 *
 *     Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c
 *
 * — which aborts the process and reports 127, so a policy block arrives
 * looking like a crash. It reproduces on stock Node 24 in three lines with no
 * Verik code involved:
 *
 *     fetch(url).then(r => r.json()).then(() => process.exit(7))   // -> 127
 *
 * Setting `process.exitCode` and letting the event loop drain gives the right
 * code and still exits promptly, because the pooled sockets do not hold the
 * loop open. Every mitigation that kept the forced exit was tried and failed:
 * `connection: close`, an awaited `setImmediate`, an awaited zero-delay timer,
 * and an unref'd timer all still aborted.
 *
 * These are the commands that can reach a provider over HTTP before deciding
 * their exit code, so these are the ones where the bug is reachable.
 */
const FETCH_CAPABLE = ['doctor.ts', 'verify.ts', 'run.ts', 'dry-run.ts'];

describe('exit-code contract', () => {
  for (const file of FETCH_CAPABLE) {
    it(`${file} sets process.exitCode rather than calling process.exit`, async () => {
      const path = join(process.cwd(), 'src', 'cli', 'commands', file);
      const source = await readFile(path, 'utf8');

      const offenders = source
        .split(/\r?\n/)
        .map((line, i) => ({ line: line.trim(), no: i + 1 }))
        // Comments explain why the call is absent; they are not the call.
        .filter(({ line }) => !line.startsWith('//') && !line.startsWith('*'))
        .filter(({ line }) => /process\.exit\s*\(/.test(line));

      expect(
        offenders,
        `${file} calls process.exit(). This command performs HTTP requests, and forcing ` +
          'exit while a socket is closing aborts the process on Windows with code 127, ' +
          'destroying the verdict. Set process.exitCode and return instead.',
      ).toEqual([]);
    });
  }
});
