import { describe, it, expect } from 'vitest';
import { canExecute } from './executable-lookup.js';
import { executeCommand } from './command-executor.js';

describe('canExecute', () => {
  it('finds a binary that exists on PATH', () => {
    // node is running this test, so it is by definition resolvable.
    expect(canExecute('node')).toBe(true);
  });

  it('rejects a binary that does not exist', () => {
    expect(canExecute('definitely-not-a-real-binary-xyz')).toBe(false);
  });

  it('rejects a path-qualified binary that does not exist', () => {
    expect(canExecute('./scripts/nope-not-here.sh')).toBe(false);
  });
});

describe('executeCommand', () => {
  it('reports a missing tool as unavailable, not failed', async () => {
    const result = await executeCommand(
      { name: 'typecheck', command: 'definitely-not-a-real-pm run typecheck', goal: 'typecheck' },
      process.cwd(),
      30_000,
      0,
    );

    // The distinction the Judge depends on. On Windows a missing binary is
    // routed through cmd.exe and exits 1, identical in shape to a real test
    // failure — reporting it as 'failed' told the Judge the build was broken
    // when nothing had been checked at all.
    expect(result.status).toBe('unavailable');
    expect(result.stderrTail).toContain('not found on PATH');
  });

  it('still reports a genuine non-zero exit as failed', async () => {
    const result = await executeCommand(
      { name: 'boom', command: 'node -e process.exit(3)', goal: 'custom' },
      process.cwd(),
      30_000,
      0,
    );

    expect(result.status).toBe('failed');
    expect(result.exitCode).toBe(3);
  });

  it('reports a clean exit as passed', async () => {
    const result = await executeCommand(
      { name: 'ok', command: 'node -e 0', goal: 'custom' },
      process.cwd(),
      30_000,
      0,
    );

    expect(result.status).toBe('passed');
    expect(result.exitCode).toBe(0);
  });
});
