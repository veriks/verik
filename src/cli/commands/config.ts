import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { getRepositoryInfo } from '../../core/repository/git-repository.js';
import { CROSSCHECK_DIR } from '../../config/config-loader.js';
import { join } from 'node:path';

export function buildConfigCommand(): Command {
  return new Command('config')
    .description('Show current Crosscheck configuration')
    .action(async () => {
      try {
        const info = await getRepositoryInfo(process.cwd());
        const configPath = join(info.root, CROSSCHECK_DIR, 'config.json');
        try {
          const raw = await readFile(configPath, 'utf8');
          console.log(raw);
        } catch {
          console.log('No config found. Run: crosscheck init');
        }
      } catch (err) {
        console.error('Error:', String(err));
        process.exit(1);
      }
    });
}
