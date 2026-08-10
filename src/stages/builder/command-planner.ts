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
/**
 * Wrapper scripts are invoked by relative path on POSIX and by name on Windows,
 * where the `.bat` is resolved through PATHEXT. `./gradlew` on Windows would not
 * resolve; `gradlew` on POSIX would search PATH and miss the local file.
 */
const gradleWrapper = (): string => (process.platform === 'win32' ? 'gradlew.bat' : './gradlew');
const mavenWrapper = (): string => (process.platform === 'win32' ? 'mvnw.cmd' : './mvnw');

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

    if (
      scripts.includes('build') &&
      !planned.find((p) => p.name === 'build' || p.goal === 'typecheck')
    ) {
      planned.push({ name: 'build', command: `${pm} run build`, goal: 'build' });
    }
  }

  if (detection.projectTypes.includes('python')) {
    planned.push({ name: 'pytest', command: 'python -m pytest --tb=short -q', goal: 'test' });
    // Only what the project has configured — see project-detector.
    if (detection.pythonTools.mypy) {
      planned.push({ name: 'mypy', command: 'python -m mypy .', goal: 'typecheck' });
    }
    if (detection.pythonTools.ruff) {
      planned.push({ name: 'ruff', command: 'python -m ruff check .', goal: 'lint' });
    }
  }

  if (detection.projectTypes.includes('go')) {
    // `go vet` is the built-in correctness check and needs no extra tooling.
    planned.push({ name: 'go-build', command: 'go build ./...', goal: 'build' });
    planned.push({ name: 'go-vet', command: 'go vet ./...', goal: 'lint' });
    planned.push({ name: 'go-test', command: 'go test ./...', goal: 'test' });
  }

  if (detection.projectTypes.includes('rust')) {
    // `cargo check` rather than `build`: same type errors, far faster, and the
    // Builder is verifying correctness rather than producing artifacts.
    planned.push({ name: 'cargo-check', command: 'cargo check --all-targets', goal: 'typecheck' });
    planned.push({ name: 'cargo-test', command: 'cargo test --no-fail-fast', goal: 'test' });
  }

  if (detection.projectTypes.includes('java-maven')) {
    // The wrapper pins the version the project expects; a global mvn may not match.
    const mvn = detection.hasMavenWrapper ? mavenWrapper() : 'mvn';
    planned.push({ name: 'maven-test', command: `${mvn} -B -q test`, goal: 'test' });
  }

  if (detection.projectTypes.includes('java-gradle')) {
    const gradle = detection.hasGradleWrapper ? gradleWrapper() : 'gradle';
    planned.push({ name: 'gradle-test', command: `${gradle} --console=plain test`, goal: 'test' });
  }

  if (detection.projectTypes.includes('ruby')) {
    planned.push({ name: 'rspec', command: 'bundle exec rspec', goal: 'test' });
  }

  if (detection.projectTypes.includes('dotnet')) {
    planned.push({ name: 'dotnet-build', command: 'dotnet build --nologo', goal: 'build' });
    planned.push({ name: 'dotnet-test', command: 'dotnet test --nologo', goal: 'test' });
  }

  if (detection.projectTypes.includes('php')) {
    planned.push({ name: 'phpunit', command: 'vendor/bin/phpunit', goal: 'test' });
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
