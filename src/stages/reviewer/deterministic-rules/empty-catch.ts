import type { DeterministicRule, DeterministicFinding, RuleContext } from './index.js';
import { iterateAddedLines } from './patch-lines.js';

export class EmptyCatchRule implements DeterministicRule {
  id = 'empty-catch';
  title = 'Empty catch block';

  async run(ctx: RuleContext): Promise<DeterministicFinding[]> {
    const findings: DeterministicFinding[] = [];
    const added = [...iterateAddedLines(ctx.patch)];

    for (let i = 0; i < added.length - 1; i++) {
      const cur = added[i]!;
      const next = added[i + 1]!;
      // Previously this paired entries from a flat list of every added line in
      // the patch, so a `catch (` at the end of one file could match a closing
      // brace from the next file entirely. Both halves must be the same file
      // and genuinely consecutive lines.
      if (cur.path !== next.path || next.line !== cur.line + 1) continue;

      if (/catch\s*\(/.test(cur.text) && /^\s*\}/.test(next.text)) {
        findings.push({
          ruleId: this.id,
          title: this.title,
          severity: 'low',
          confidence: 0.7,
          file: cur.path || 'diff',
          line: cur.line,
          message: 'An empty catch block was added.',
          excerpt: cur.text.slice(0, 120),
          remediation: 'Handle or log the error in the catch block.',
        });
      }
    }
    return findings;
  }
}
