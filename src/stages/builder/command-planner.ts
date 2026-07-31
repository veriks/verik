import type { ProjectDetection } from './project-detector.js';

export interface VerificationGoal {
  goal: 'typecheck' | 'test' | 'lint' | 'build' | 'custom';
  description: string;
}

export interface PlannedCommand {
  name: string;
  command: string;
  goal: VerificationGoal['goal'];
}

/**
 * Maps Scout's natural-language verification goals to allowlisted commands.
 * Scout may recommend goals (e.g. "TypeScript compilation should be checked")
 * but never produces shell commands. This planner maps goals deterministically.
 * Nothing from LLM output reaches shell execution.
 */
export function planCommands(
  detection: ProjectDetection,
  extraCommands: { name: string; command: string }[],
): PlannedCommand[] {
  const planned: PlannedCommand[] = [];
  const pm = detection.packageManager ?? 'npm';

  if (detection.projectTypes.includes('node')) {
    const scripts = Object.keys(detection.scripts);

    if (scripts.includes('typecheck')) {
      planned.push({ name: 'typecheck', command: `${pm} run typecheck`, goal: 'typecheck' });
    } else if (detection.scripts['build']?.includes('tsc')) {
      planned.push({ name: 'typecheck', command: `${pm} run build`, goal: 'typecheck' });
    }

    if (scripts.includes('test')) {
      planned.push({ name: 'test', command: `${pm} run test`, goal: 'test' });
    }

    if (scripts.includes('lint')) {
      planned.push({ name: 'lint', command: `${pm} run lint`, goal: 'lint' });
    }

    if (scripts.includes('build') && !planned.find((p) => p.name === 'build' || p.goal === 'typecheck')) {
      planned.push({ name: 'build', command: `${pm} run build`, goal: 'build' });
    }
  }

  if (detection.projectTypes.includes('python')) {
    planned.push({ name: 'pytest', command: 'python -m pytest --tb=short -q', goal: 'test' });
  }

  for (const extra of extraCommands) {
    if (!planned.find((p) => p.name === extra.name)) {
      planned.push({ name: extra.name, command: extra.command, goal: 'custom' });
    }
  }

  return planned;
}

/**
 * Goals that Scout's builderRecommendations might reference.
 * Maps recommendation keywords to goal types for display purposes only —
 * the actual command selection is always deterministic via planCommands().
 */
export function goalFromRecommendation(recommendation: string): VerificationGoal {
  const lower = recommendation.toLowerCase();
  if (lower.includes('typecheck') || lower.includes('typescript') || lower.includes('tsc')) {
    return { goal: 'typecheck', description: recommendation };
  }
  if (lower.includes('test')) {
    return { goal: 'test', description: recommendation };
  }
  if (lower.includes('lint')) {
    return { goal: 'lint', description: recommendation };
  }
  if (lower.includes('build')) {
    return { goal: 'build', description: recommendation };
  }
  return { goal: 'custom', description: recommendation };
}
