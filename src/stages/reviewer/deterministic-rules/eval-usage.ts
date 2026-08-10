import { defineLineRule } from './line-rule.js';

/**
 * Patterns require a non-empty argument. `eval()` with nothing between the
 * parentheses cannot execute anything, so a bare `eval()` in a sentence is
 * documentation — which is how this rule used to flag its own remediation text,
 * and would flag the release notes of any project that ever mentions eval.
 */
export const EvalUsageRule = defineLineRule({
  id: 'eval-usage',
  title: 'Dangerous eval or equivalent',
  severity: 'high',
  confidence: 0.8,
  patterns: [
    /\beval\s*\(\s*[^)\s]/,
    /\bnew\s+Function\s*\(\s*[^)\s]/,
    /child_process\.exec\s*\(.*\$\{/,
    /\bsetTimeout\s*\(\s*['"`]/,
  ],
  message: 'Potentially dangerous code execution pattern detected in added line.',
  remediation: 'Avoid dynamic code execution. Use a safer alternative.',
});
