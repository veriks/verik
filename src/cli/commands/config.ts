import { block } from '../output/theme.js';
import { formatError } from '../../shared/format-error.js';
import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { getRepositoryInfo } from '../../core/repository/git-repository.js';
import { VERIK_DIR } from '../../config/config-loader.js';
import { join } from 'node:path';

export function buildConfigCommand(): Command {
  return new Command('config').description('Show current Verik configuration').action(async () => {
    try {
      const info = await getRepositoryInfo(process.cwd());
      const configPath = join(info.root, VERIK_DIR, 'config.json');
      try {
        const raw = await readFile(configPath, 'utf8');
        console.log(raw);
      } catch {
        console.log('No config found. Run: verik init');
      }
    } catch (err) {
      console.error(`${block('✕')} ${formatError(err)}`);
      process.exit(1);
    }
  });
}
