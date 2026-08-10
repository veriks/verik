import { describe, it, expect } from 'vitest';
import { resolveExit, type ExitInputs } from './exit-code.js';
import type { PolicyResult } from '../policy/policy-schema.js';

const pass = { exitCode: 0 } as PolicyResult;
const block = { exitCode: 2 } as PolicyResult;

const base: ExitInputs = {
  commandExitCode: 0,
  policy: pass,
  stageStatuses: { judge: 'completed' },
  policyMode: 'advisory',
};

describe('resolveExit', () => {
  it('passes a clean run', () => {
    expect(resolveExit(base)).toMatchObject({ exitCode: 0, status: 'completed' });
  });

  it('does not mask a failing wrapped command when the verdict passes', () => {
    // The regression: advisory mode used to discard the command's exit code, so
    // `crosscheck run -- npm test` with failing tests reported success.
    const r = resolveExit({ ...base, commandExitCode: 1 });
    expect(r.exitCode).toBe(1);
  });

  it('lets a policy block outrank the wrapped command exit code', () => {
    const r = resolveExit({ ...base, commandExitCode: 1, policy: block, policyMode: 'blocking' });
    expect(r.exitCode).toBe(2);
  });

  it('does not report completed when verification never reached a verdict', () => {
    // No API key: every LLM stage fails, so there is no judge and no policy.
    const r = resolveExit({
      ...base,
      policy: undefined,
      stageStatuses: { judge: 'failed' },
    });
    expect(r.status).toBe('inconclusive');
    expect(r.warning).toMatch(/does not mean the change is safe/);
  });

  it('keeps advisory at 0 when verification did not complete', () => {
    // Advisory promises never to fail a build on Crosscheck's opinion.
    const r = resolveExit({ ...base, policy: undefined, stageStatuses: { judge: 'failed' } });
    expect(r.exitCode).toBe(0);
  });

  it('returns inconclusive (3) in blocking mode when verification did not complete', () => {
    const r = resolveExit({
      ...base,
      policy: undefined,
      stageStatuses: { judge: 'failed' },
      policyMode: 'blocking',
    });
    expect(r.exitCode).toBe(3);
  });

  it('still surfaces a failing command when verification did not complete', () => {
    const r = resolveExit({
      ...base,
      commandExitCode: 1,
      policy: undefined,
      stageStatuses: { judge: 'failed' },
    });
    expect(r.exitCode).toBe(1);
    expect(r.status).toBe('inconclusive');
  });

  it('shadow mode never fails on a verdict but still surfaces a failing command', () => {
    expect(resolveExit({ ...base, policy: block, policyMode: 'shadow' }).exitCode).toBe(0);
    expect(
      resolveExit({ ...base, commandExitCode: 7, policy: block, policyMode: 'shadow' }).exitCode,
    ).toBe(7);
  });

  it('treats a judge that did not run as no verdict, even if a policy object exists', () => {
    const r = resolveExit({ ...base, stageStatuses: { judge: 'failed' } });
    expect(r.status).toBe('inconclusive');
  });

  describe('rules mode', () => {
    // No Judge and no policy by design, so the absence of a verdict is success.
    const rules = { ...base, mode: 'rules' as const, policy: undefined, stageStatuses: {} };

    it('completes without a verdict rather than reporting inconclusive', () => {
      expect(resolveExit(rules)).toMatchObject({ exitCode: 0, status: 'completed' });
    });

    it('does not dereference the absent policy', () => {
      // Regression: an earlier version treated rules mode as "reached a
      // verdict" and then read policy!.exitCode, throwing on every run.
      expect(() => resolveExit(rules)).not.toThrow();
    });

    it('still surfaces a failing wrapped command', () => {
      expect(resolveExit({ ...rules, commandExitCode: 1 }).exitCode).toBe(1);
    });
  });
});
