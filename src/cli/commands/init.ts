import { Command } from 'commander';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getRepositoryInfo } from '../../core/repository/git-repository.js';
import { CrosscheckError } from '../../shared/errors.js';
import { DEFAULT_CONFIG, DEFAULT_POLICY } from '../../config/defaults.js';

export function buildInitCommand(): Command {
  return new Command('init')
    .description('Initialize Crosscheck in the current repository')
    .action(async () => {
      try {
        const info = await getRepositoryInfo(process.cwd());
        const ccDir = join(info.root, '.crosscheck');
        const runsDir = join(ccDir, 'runs');
        const cacheDir = join(ccDir, 'cache');

        await mkdir(ccDir, { recursive: true });
        await mkdir(runsDir, { recursive: true });
        await mkdir(cacheDir, { recursive: true });

        const configPath = join(ccDir, 'config.json');
        const policyPath = join(ccDir, 'policy.json');
        const gitignorePath = join(ccDir, '.gitignore');

        await writeFile(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
        await writeFile(policyPath, JSON.stringify(DEFAULT_POLICY, null, 2), 'utf8');
        await writeFile(gitignorePath, 'runs/\ncache/\n', 'utf8');

        console.log('Crosscheck initialized.');
        console.log(`  Config: ${configPath}`);
        console.log(`  Policy: ${policyPath}`);
        console.log('');
        console.log('Set your API key:');
        console.log('  export ANTHROPIC_API_KEY=...');
        console.log('');
        console.log('Run a command:');
        console.log('  crosscheck run -- <your-command>');
      } catch (err) {
        if (err instanceof CrosscheckError) {
          console.error('Error:', err.message);
          process.exit(err.exitCode);
        }
        console.error('Error:', String(err));
        process.exit(1);
      }
    });
}
