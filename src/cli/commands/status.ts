import { Command } from 'commander';
import { getRepositoryInfo } from '../../core/repository/git-repository.js';
import { listRunIds } from '../../storage/local-run-store.js';
import { loadConfig, loadPolicy } from '../../config/config-loader.js';

export function buildStatusCommand(): Command {
  return new Command('status')
    .description('Show Crosscheck status for the current repository')
    .action(async () => {
      try {
        const info = await getRepositoryInfo(process.cwd());
        const config = await loadConfig(info.root);
        const policy = await loadPolicy(info.root);
        const runs = await listRunIds(info.root);

        console.log('Repository:', info.root);
        console.log('Branch:', info.branch);
        console.log('Commit:', info.commitSha.slice(0, 8));
        console.log('Dirty:', info.isDirty ? 'yes' : 'no');
        console.log('');
        console.log('Crosscheck:');
        console.log('  Provider:', config.provider);
        console.log('  Policy mode:', policy.mode);
        console.log('  API key:', process.env['ANTHROPIC_API_KEY'] ? 'set' : 'NOT SET');
        console.log('');
        if (runs.length > 0) {
          console.log('Latest run:', runs[0]);
          console.log('Total runs:', runs.length);
        } else {
          console.log('No runs yet. Try: crosscheck run -- <command>');
        }
      } catch (err) {
        console.error('Error:', String(err));
        process.exit(1);
      }
    });
}
