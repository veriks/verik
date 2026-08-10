import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type ProjectType =
  | 'node'
  | 'python'
  | 'go'
  | 'rust'
  | 'java-maven'
  | 'java-gradle'
  | 'ruby'
  | 'dotnet'
  | 'php'
  | 'generic';

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun' | null;

export interface ProjectDetection {
  projectTypes: ProjectType[];
  packageManager: PackageManager;
  hasLockfile: boolean;
  /** package.json scripts, for node projects. */
  scripts: Record<string, string>;
  /** True when a Gradle wrapper is present — prefer it over a global gradle. */
  hasGradleWrapper: boolean;
  /** True when a Maven wrapper is present. */
  hasMavenWrapper: boolean;
  /** Python tool config detected in pyproject.toml, so we only plan what is set up. */
  pythonTools: { ruff: boolean; mypy: boolean; pytest: boolean };
}

const exists = (root: string, ...names: string[]): boolean =>
  names.some((n) => existsSync(join(root, n)));

/** Cheap top-level glob — avoids walking a large repository. */
function hasFileMatching(root: string, pattern: RegExp): boolean {
  try {
    return readdirSync(root).some((f) => pattern.test(f));
  } catch {
    return false;
  }
}

/**
 * Identifies the ecosystems present so the Builder can run the project's real
 * checks.
 *
 * A repository can legitimately be several of these at once — a Go service with
 * a TypeScript frontend is one repo, two ecosystems — so this returns a list
 * rather than picking a winner. `generic` means nothing was recognised, and is
 * reported honestly rather than guessed at.
 */
export function detectProject(root: string): ProjectDetection {
  const projectTypes: ProjectType[] = [];
  let packageManager: PackageManager = null;
  let scripts: Record<string, string> = {};

  if (exists(root, 'package.json')) {
    projectTypes.push('node');
    try {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
        scripts?: Record<string, string>;
      };
      scripts = pkg.scripts ?? {};
    } catch {
      // A malformed package.json is the user's problem, not a reason to crash.
    }
  }

  if (exists(root, 'pnpm-lock.yaml')) packageManager = 'pnpm';
  else if (exists(root, 'yarn.lock')) packageManager = 'yarn';
  else if (exists(root, 'bun.lockb', 'bun.lock')) packageManager = 'bun';
  else if (exists(root, 'package-lock.json')) packageManager = 'npm';

  const pythonTools = { ruff: false, mypy: false, pytest: false };
  if (exists(root, 'requirements.txt', 'pyproject.toml', 'setup.py', 'setup.cfg', 'Pipfile')) {
    projectTypes.push('python');
    // Only plan a tool the project has actually configured — running ruff on a
    // repo that has never used it produces noise, not evidence.
    try {
      const toml = readFileSync(join(root, 'pyproject.toml'), 'utf8');
      pythonTools.ruff = /\[tool\.ruff/.test(toml);
      pythonTools.mypy = /\[tool\.mypy/.test(toml);
      pythonTools.pytest = /\[tool\.pytest/.test(toml);
    } catch {
      /* pyproject.toml is optional */
    }
    if (exists(root, 'pytest.ini', 'tox.ini', 'conftest.py')) pythonTools.pytest = true;
    if (exists(root, 'mypy.ini', '.mypy.ini')) pythonTools.mypy = true;
    if (exists(root, 'ruff.toml', '.ruff.toml')) pythonTools.ruff = true;
  }

  if (exists(root, 'go.mod')) projectTypes.push('go');
  if (exists(root, 'Cargo.toml')) projectTypes.push('rust');
  if (exists(root, 'pom.xml')) projectTypes.push('java-maven');
  if (exists(root, 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts')) {
    projectTypes.push('java-gradle');
  }
  if (exists(root, 'Gemfile')) projectTypes.push('ruby');
  if (exists(root, 'composer.json')) projectTypes.push('php');
  if (hasFileMatching(root, /\.(sln|csproj|fsproj)$/)) projectTypes.push('dotnet');

  if (projectTypes.length === 0) projectTypes.push('generic');

  return {
    projectTypes,
    packageManager,
    hasLockfile: exists(
      root,
      'pnpm-lock.yaml',
      'yarn.lock',
      'package-lock.json',
      'bun.lockb',
      'Cargo.lock',
      'go.sum',
      'Gemfile.lock',
      'poetry.lock',
      'composer.lock',
    ),
    scripts,
    hasGradleWrapper: exists(root, 'gradlew', 'gradlew.bat'),
    hasMavenWrapper: exists(root, 'mvnw', 'mvnw.cmd'),
    pythonTools,
  };
}
