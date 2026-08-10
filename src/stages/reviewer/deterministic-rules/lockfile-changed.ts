import type { DeterministicRule, DeterministicFinding, RuleContext } from './index.js';

export class LockfileChangedRule implements DeterministicRule {
  id = 'lockfile-changed';
  title = 'Dependency lockfile changed';

  async run(ctx: RuleContext): Promise<DeterministicFinding[]> {
    const lockfiles = ctx.diff.changedFiles.filter((f) =>
      ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'Pipfile.lock'].includes(
        f.path.split('/').at(-1) ?? '',
      ),
    );
    return lockfiles.map((f) => ({
      ruleId: this.id,
      title: this.title,
      severity: 'info' as const,
      confidence: 1.0,
      file: f.path,
      message: `Dependency lockfile was modified: ${f.path}`,
      excerpt: f.path,
      remediation: 'Review the dependency changes for supply-chain risks.',
    }));
  }
}
