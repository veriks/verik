import type { DeterministicRule, DeterministicFinding, RuleContext } from './index.js';

export class EnvFileRule implements DeterministicRule {
  id = 'env-file-added';
  title = '.env file introduced';

  async run(ctx: RuleContext): Promise<DeterministicFinding[]> {
    const envFiles = ctx.diff.changedFiles.filter(
      (f) => f.changeType === 'added' && /^\.env(\..+)?$/.test(f.path.split('/').at(-1) ?? ''),
    );
    return envFiles.map((f) => ({
      ruleId: this.id,
      title: this.title,
      severity: 'high' as const,
      confidence: 0.95,
      file: f.path,
      message: `An .env file was added: ${f.path}`,
      excerpt: f.path,
      remediation: 'Do not commit .env files. Add them to .gitignore.',
    }));
  }
}

export class EvalUsageRule implements DeterministicRule {
  id = 'eval-usage';
  title = 'Dangerous eval or equivalent';

  async run(ctx: RuleContext): Promise<DeterministicFinding[]> {
    const findings: DeterministicFinding[] = [];
    const addedLines = ctx.patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
    const patterns = [/\beval\s*\(/, /\bnew\s+Function\s*\(/, /child_process\.exec\s*\(.*\$\{/];
    for (const line of addedLines) {
      for (const p of patterns) {
        if (p.test(line)) {
          findings.push({
            ruleId: this.id, title: this.title,
            severity: 'high', confidence: 0.8, file: 'diff',
            message: 'Potentially dangerous code execution pattern detected in added line.',
            excerpt: line.slice(0, 120),
            remediation: 'Avoid eval() and dynamic code execution. Use safer alternatives.',
          });
          break;
        }
      }
    }
    return findings;
  }
}

export class DisabledTestsRule implements DeterministicRule {
  id = 'disabled-tests';
  title = 'Tests disabled or skipped';

  async run(ctx: RuleContext): Promise<DeterministicFinding[]> {
    const findings: DeterministicFinding[] = [];
    const addedLines = ctx.patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
    const skipPatterns = [/\bit\.skip\b/, /\bdescribe\.skip\b/, /\btest\.skip\b/, /\bxtesting\b/, /\.skip\(/, /pytest\.mark\.skip/];
    for (const line of addedLines) {
      for (const p of skipPatterns) {
        if (p.test(line)) {
          findings.push({
            ruleId: this.id, title: this.title,
            severity: 'medium', confidence: 0.9, file: 'diff',
            message: 'A test was skipped or disabled in the diff.',
            excerpt: line.slice(0, 120),
            remediation: 'Restore or fix the test rather than skipping it.',
          });
          break;
        }
      }
    }
    return findings;
  }
}

export class EmptyCatchRule implements DeterministicRule {
  id = 'empty-catch';
  title = 'Empty catch block';

  async run(ctx: RuleContext): Promise<DeterministicFinding[]> {
    const findings: DeterministicFinding[] = [];
    const addedLines = ctx.patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
    for (let i = 0; i < addedLines.length - 1; i++) {
      const cur = addedLines[i] ?? '';
      const next = addedLines[i + 1] ?? '';
      if (/catch\s*\(/.test(cur) && /^\+\s*\}/.test(next)) {
        findings.push({
          ruleId: this.id, title: this.title,
          severity: 'low', confidence: 0.7, file: 'diff',
          message: 'An empty catch block was added.',
          excerpt: cur.slice(0, 120),
          remediation: 'Handle or log the error in the catch block.',
        });
      }
    }
    return findings;
  }
}

export class DbMigrationRule implements DeterministicRule {
  id = 'db-migration';
  title = 'Database migration added';

  async run(ctx: RuleContext): Promise<DeterministicFinding[]> {
    const migrations = ctx.diff.changedFiles.filter(
      (f) => /migrations?\/.*\.(sql|ts|js|py)$/.test(f.path) && (f.changeType === 'added' || f.changeType === 'modified'),
    );
    return migrations.map((f) => ({
      ruleId: this.id, title: this.title,
      severity: 'medium' as const, confidence: 0.9, file: f.path,
      message: `A database migration file was added or modified: ${f.path}`,
      excerpt: f.path,
      remediation: 'Verify migration is backward-compatible and tested.',
    }));
  }
}

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
      ruleId: this.id, title: this.title,
      severity: 'info' as const, confidence: 1.0, file: f.path,
      message: `Dependency lockfile was modified: ${f.path}`,
      excerpt: f.path,
      remediation: 'Review the dependency changes for supply-chain risks.',
    }));
  }
}
