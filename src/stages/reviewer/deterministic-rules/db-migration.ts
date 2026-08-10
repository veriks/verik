import type { DeterministicRule, DeterministicFinding, RuleContext } from './index.js';

export class DbMigrationRule implements DeterministicRule {
  id = 'db-migration';
  title = 'Database migration added';

  async run(ctx: RuleContext): Promise<DeterministicFinding[]> {
    const migrations = ctx.diff.changedFiles.filter(
      (f) =>
        /migrations?\/.*\.(sql|ts|js|py)$/.test(f.path) &&
        (f.changeType === 'added' || f.changeType === 'modified'),
    );
    return migrations.map((f) => ({
      ruleId: this.id,
      title: this.title,
      severity: 'medium' as const,
      confidence: 0.9,
      file: f.path,
      message: `A database migration file was added or modified: ${f.path}`,
      excerpt: f.path,
      remediation: 'Verify migration is backward-compatible and tested.',
    }));
  }
}
