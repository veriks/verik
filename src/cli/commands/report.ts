import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { getRepositoryInfo } from '../../core/repository/git-repository.js';
import { listRunIds } from '../../storage/local-run-store.js';
import { runFilePath } from '../../storage/paths.js';

export function buildReportCommand(): Command {
  return new Command('report')
    .description('Print a Crosscheck run report')
    .argument('[run-id]', 'Run ID (defaults to latest)')
    .option('--json', 'Print JSON report')
    .action(async (runId: string | undefined, options: { json?: boolean }) => {
      try {
        const info = await getRepositoryInfo(process.cwd());
        let id = runId;
        if (!id) {
          const ids = await listRunIds(info.root);
          id = ids[0];
          if (!id) {
            console.log('No runs found. Try: crosscheck run -- <command>');
            return;
          }
        }
        const filename = options.json ? 'report.json' : 'report.md';
        const path = runFilePath(info.root, id, filename);
        try {
          const content = await readFile(path, 'utf8');
          console.log(content);
        } catch {
          console.error(`Report not found: ${path}`);
          process.exit(1);
        }
      } catch (err) {
        console.error('Error:', String(err));
        process.exit(1);
      }
    });
}
