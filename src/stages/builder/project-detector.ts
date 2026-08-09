import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type ProjectType = 'node' | 'python' | 'generic';
export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun' | null;

export interface ProjectDetection {
  projectTypes: ProjectType[];
  packageManager: PackageManager;
  hasLockfile: boolean;
  scripts: Record<string, string>;
}

export function detectProject(root: string): ProjectDetection {
  const projectTypes: ProjectType[] = [];
  let packageManager: PackageManager = null;
  let scripts: Record<string, string> = {};

  if (existsSync(join(root, 'package.json'))) {
    projectTypes.push('node');
    try {
      const pkgRaw = readFileSync(join(root, 'package.json'), 'utf8');
      const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
      scripts = pkg.scripts ?? {};
    } catch {
      // ignore
    }
  }

  if (existsSync(join(root, 'pnpm-lock.yaml'))) packageManager = 'pnpm';
  else if (existsSync(join(root, 'yarn.lock'))) packageManager = 'yarn';
  else if (existsSync(join(root, 'bun.lockb'))) packageManager = 'bun';
  else if (existsSync(join(root, 'package-lock.json'))) packageManager = 'npm';

  if (
    existsSync(join(root, 'requirements.txt')) ||
    existsSync(join(root, 'pyproject.toml')) ||
    existsSync(join(root, 'setup.py'))
  ) {
    projectTypes.push('python');
  }

  if (projectTypes.length === 0) projectTypes.push('generic');

  const hasLockfile =
    existsSync(join(root, 'pnpm-lock.yaml')) ||
    existsSync(join(root, 'yarn.lock')) ||
    existsSync(join(root, 'package-lock.json')) ||
    existsSync(join(root, 'bun.lockb'));

  return { projectTypes, packageManager, hasLockfile, scripts };
}
