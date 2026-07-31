import type { DeterministicRule, DeterministicFinding, RuleContext } from './index.js';

const SECRET_PATTERNS = [
  { re: /(?:api[_-]?key|secret|token|password|passwd)\s*[=:]\s*["']([^"']{8,})["']/gi, label: 'credential' },
  { re: /(?:sk-|pk-|ghp_|gho_|ghu_|ghs_)[a-z0-9_-]{10,}/gi, label: 'API key' },
  { re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, label: 'private key' },
];

export class SecretLeakRule implements DeterministicRule {
  id = 'secret-leak';
  title = 'Likely secret added to diff';

  async run(ctx: RuleContext): Promise<DeterministicFinding[]> {
    const findings: DeterministicFinding[] = [];
    const addedLines = ctx.patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));

    for (const line of addedLines) {
      for (const { re, label } of SECRET_PATTERNS) {
        if (re.test(line)) {
          findings.push({
            ruleId: this.id,
            title: this.title,
            severity: 'critical',
            confidence: 0.85,
            file: 'diff',
            message: `A ${label} pattern was found in an added line.`,
            excerpt: line.slice(0, 120),
            remediation: 'Remove the credential from the diff and rotate it immediately.',
          });
          break;
        }
        re.lastIndex = 0;
      }
    }
    return findings;
  }
}
