import type { DeterministicRule, DeterministicFinding, RuleContext } from './index.js';

export class EnvFileRule implements DeterministicRule {
  id = 'env-file-added';
  title = '.env file introduced';
  defaultSeverity = 'high' as const;

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
