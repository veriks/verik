import type { DeterministicRule, DeterministicFinding, RuleContext } from './index.js';
import { iterateAddedLines, looksLikePlaceholder } from './patch-lines.js';

/**
 * Patterns are deliberately NOT global.
 *
 * `RegExp.prototype.test` on a `/g` regex advances `lastIndex`, and these are
 * module-level constants shared across every line of every run — so alternate
 * calls resumed mid-string and returned false. The previous version reset
 * `lastIndex` only on the no-match path, after an unreachable `break`, which
 * meant it silently missed every second secret in a diff.
 */
const SECRET_PATTERNS = [
  {
    re: /(?:api[_-]?key|secret|token|password|passwd)\s*[=:]\s*["']([^"']{8,})["']/i,
    label: 'credential',
    /** The quoted value, for the placeholder check. */
    valueGroup: 1,
  },
  { re: /((?:sk-|pk-|ghp_|gho_|ghu_|ghs_)[a-zA-Z0-9_-]{10,})/, label: 'API key', valueGroup: 1 },
  {
    re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
    label: 'private key',
    valueGroup: 0,
  },
] as const;

export class SecretLeakRule implements DeterministicRule {
  id = 'secret-leak';
  title = 'Likely secret added to diff';

  async run(ctx: RuleContext): Promise<DeterministicFinding[]> {
    const findings: DeterministicFinding[] = [];

    for (const added of iterateAddedLines(ctx.patch)) {
      for (const { re, label, valueGroup } of SECRET_PATTERNS) {
        const match = re.exec(added.text);
        if (!match) continue;

        // A rule finding can deny a build now, so a false positive costs more
        // than a miss. `password: "changeme"` in a fixture must not block.
        const value = valueGroup === 0 ? match[0] : (match[valueGroup] ?? '');
        if (valueGroup !== 0 && looksLikePlaceholder(value)) break;

        findings.push({
          ruleId: this.id,
          title: this.title,
          severity: 'critical',
          confidence: 0.85,
          file: added.path || 'diff',
          line: added.line,
          message: `A ${label} pattern was found in an added line.`,
          // Never the matched value: this excerpt reaches reports, memory and
          // the Reviewer's prompt, and echoing the secret there would defeat
          // the redaction the rest of the pipeline performs.
          excerpt: redactMatch(added.text, value),
          remediation: 'Remove the credential from the diff and rotate it immediately.',
        });
        break;
      }
    }

    return findings;
  }
}

function redactMatch(text: string, value: string): string {
  const safe = value ? text.split(value).join('[REDACTED]') : text;
  return safe.slice(0, 160);
}
