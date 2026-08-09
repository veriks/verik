import type { Override } from '../../core/memory/memory-schema.js';
import type { DeterministicFinding } from '../../stages/reviewer/deterministic-rules/index.js';
import type { Finding } from '../../stages/reviewer/reviewer-schema.js';
import { logger } from '../../shared/logger.js';

export interface SuppressedFinding {
  type: 'deterministic' | 'llm';
  title: string;
  overrideId: string;
  reason: string;
}

function matchesDeterministic(finding: DeterministicFinding, override: Override): boolean {
  if (override.ruleId && override.ruleId !== finding.ruleId) return false;
  if (override.filePath && override.filePath !== finding.file) return false;
  if (override.titlePattern) {
    try {
      if (!new RegExp(override.titlePattern, 'i').test(finding.title)) return false;
    } catch {
      return false;
    }
  }
  // Must match at least one criterion
  return Boolean(override.ruleId || override.filePath || override.titlePattern);
}

function matchesLlm(finding: Finding, override: Override): boolean {
  if (override.filePath) {
    const evidencePaths = finding.evidence.map((e) => e.path);
    if (!evidencePaths.some((p) => p === override.filePath || p.startsWith(override.filePath!))) {
      return false;
    }
  }
  if (override.titlePattern) {
    try {
      if (!new RegExp(override.titlePattern, 'i').test(finding.title)) return false;
    } catch {
      return false;
    }
  }
  // LLM findings can't be matched by ruleId alone (they don't have one)
  return Boolean(override.filePath || override.titlePattern);
}

export function applyOverridesToDeterministic(
  findings: DeterministicFinding[],
  overrides: Override[],
): { kept: DeterministicFinding[]; suppressed: SuppressedFinding[] } {
  const kept: DeterministicFinding[] = [];
  const suppressed: SuppressedFinding[] = [];

  for (const finding of findings) {
    const match = overrides.find((o) => matchesDeterministic(finding, o));
    if (match) {
      logger.debug(`Override ${match.id} suppressed deterministic finding: ${finding.title}`);
      suppressed.push({ type: 'deterministic', title: finding.title, overrideId: match.id, reason: match.reason });
    } else {
      kept.push(finding);
    }
  }
  return { kept, suppressed };
}

export function applyOverridesToLlmFindings(
  findings: Finding[],
  overrides: Override[],
): { kept: Finding[]; suppressed: SuppressedFinding[] } {
  const kept: Finding[] = [];
  const suppressed: SuppressedFinding[] = [];

  for (const finding of findings) {
    const match = overrides.find((o) => matchesLlm(finding, o));
    if (match) {
      logger.debug(`Override ${match.id} suppressed LLM finding: ${finding.title}`);
      suppressed.push({ type: 'llm', title: finding.title, overrideId: match.id, reason: match.reason });
    } else {
      kept.push(finding);
    }
  }
  return { kept, suppressed };
}
