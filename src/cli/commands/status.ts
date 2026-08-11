import { Command } from 'commander';
import { getRepositoryInfo } from '../../core/repository/git-repository.js';
import { listRunIds } from '../../storage/local-run-store.js';
import { loadConfig, loadPolicy } from '../../config/config-loader.js';
import { block, kv, mark, pass, section, subtle, warn } from '../output/theme.js';

export function buildStatusCommand(): Command {
  return new Command('status')
    .description('Show Verik status for the current repository')
    .action(async () => {
      try {
        const info = await getRepositoryInfo(process.cwd());
        const config = await loadConfig(info.root);
        const policy = await loadPolicy(info.root);
        const runs = await listRunIds(info.root);
        const hasKey = Boolean(process.env['ANTHROPIC_API_KEY']);

        console.log(`\n${mark()}  ${section('repository')}`);
        console.log(kv('path', info.root));
        console.log(kv('branch', info.branch));
        console.log(kv('commit', subtle(info.commitSha.slice(0, 8))));
        console.log(kv('dirty', info.isDirty ? warn('yes') : subtle('no')));

        console.log(`\n${section('verik')}`);
        console.log(kv('provider', config.provider));
        console.log(kv('policy', policy.mode));
        // Without a key every LLM stage fails, so this is the single most
        // common reason a run comes back inconclusive.
        console.log(
          kv('api key', hasKey ? pass('set') : block('not set — LLM stages will not run')),
        );

        console.log(`\n${section('runs')}`);
        if (runs.length > 0) {
          console.log(kv('latest', runs[0] ?? ''));
          console.log(kv('total', String(runs.length)));
        } else {
          console.log(subtle('  none yet — try: verik run -- <command>'));
        }
        console.log();
      } catch (err) {
        console.error(`${block('✕')} ${String(err)}`);
        process.exit(1);
      }
    });
}
