import { block } from '../output/theme.js';
import { formatError } from '../../shared/format-error.js';
import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { getRepositoryInfo } from '../../core/repository/git-repository.js';
import { listRunIds } from '../../storage/local-run-store.js';
import { runFilePath } from '../../storage/paths.js';
import { exec } from 'node:child_process';

function openInBrowser(path: string): void {
  const cmd =
    process.platform === 'win32'
      ? `start "" "${path}"`
      : process.platform === 'darwin'
        ? `open "${path}"`
        : `xdg-open "${path}"`;
  exec(cmd);
}

export function buildReportCommand(): Command {
  return new Command('report')
    .description('Print a Crosscheck run report')
    .argument('[run-id]', 'Run ID (defaults to latest)')
    .option('--json', 'Print JSON report')
    .option('--html', 'Print HTML report path')
    .option('--open', 'Open HTML report in browser')
    .action(
      async (
        runId: string | undefined,
        options: { json?: boolean; html?: boolean; open?: boolean },
      ) => {
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

          if (options.open || options.html) {
            const path = runFilePath(info.root, id, 'report.html');
            try {
              await readFile(path);
              if (options.open) {
                openInBrowser(path);
                console.log('Opening:', path);
              } else {
                console.log(path);
              }
            } catch {
              console.error('HTML report not found — run crosscheck again to generate it.');
              process.exit(1);
            }
            return;
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
          console.error(`${block('✕')} ${formatError(err)}`);
          process.exit(1);
        }
      },
    );
}
