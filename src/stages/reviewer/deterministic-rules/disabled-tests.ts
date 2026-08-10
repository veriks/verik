import { defineLineRule } from './line-rule.js';

/**
 * Skip markers added to a suite. Unlike the other hygiene rules this one is
 * *about* test files, so it keeps the default scope rather than excluding them.
 */
export const DisabledTestsRule = defineLineRule({
  id: 'disabled-tests',
  title: 'Tests disabled or skipped',
  severity: 'medium',
  confidence: 0.9,
  patterns: [
    /\bit\.skip\b/,
    /\bdescribe\.skip\b/,
    /\btest\.skip\b/,
    /\bxit\s*\(/,
    /\bxdescribe\s*\(/,
    /\.skip\s*\(/,
    /pytest\.mark\.skip/,
    /@Ignore\b/,
    /\bt\.Skip\s*\(/,
    /\.only\s*\(/,
  ],
  message: 'A test was skipped or disabled in the diff.',
  remediation: 'Restore or fix the test rather than skipping it.',
});
