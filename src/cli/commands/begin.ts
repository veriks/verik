import { block } from '../output/theme.js';
import { formatError } from '../../shared/format-error.js';
import { Command } from 'commander';
import { getRepositoryInfo } from '../../core/repository/git-repository.js';
import { loadConfig } from '../../config/config-loader.js';
import {
  clearCheckpoint,
  readCheckpoint,
  writeCheckpoint,
} from '../../core/repository/checkpoint.js';
import { brand, muted, pass, section, subtle } from '../output/theme.js';
import { checklist } from '../output/prompt.js';

/**
 * `crosscheck begin` — mark the baseline before letting an agent work.
 *
 * For agents that cannot be wrapped: Cursor, Copilot, the Claude or ChatGPT
 * desktop apps, anything where code arrives by paste. Without this, `verify`
 * diffs against HEAD and cannot separate the agent's work from the developer's.
 */
export function buildBeginCommand(): Command {
  const cmd = new Command('begin')
    .description('Mark the current state as the baseline, for agents that cannot be wrapped')
    .option('--clear', 'Discard the current checkpoint and go back to diffing against HEAD')
    .action(async (options: { clear?: boolean }) => {
      try {
        const info = await getRepositoryInfo(process.cwd());

        if (options.clear) {
          await clearCheckpoint(info.root);
          console.log(
            `\n  ${pass('✓')} ${muted('checkpoint cleared')} — verify now diffs against HEAD\n`,
          );
          return;
        }

        const config = await loadConfig(info.root);
        const existing = await readCheckpoint(info.root);

        const checkpoint = await writeCheckpoint(
          info.root,
          info.branch,
          info.commitSha,
          config.verification.includeUntrackedFiles,
        );

        console.log(`\n  ${section('baseline recorded')}`);
        console.log(
          checklist([
            { label: 'branch', detail: info.branch },
            { label: 'commit', detail: info.commitSha.slice(0, 8) },
            { label: 'tree', detail: subtle(checkpoint.tree.slice(0, 12)) },
            ...(existing
              ? [{ label: 'replaced', detail: subtle(existing.createdAt), state: 'none' as const }]
              : []),
          ]).join('\n'),
        );

        console.log(`\n  ${muted('Now let the agent work, then:')}`);
        console.log(
          `    ${brand('crosscheck verify')}${muted('   verifies only what changed since this point')}`,
        );
        console.log(
          `    ${brand('crosscheck begin --clear')}${muted('   discard the baseline')}\n`,
        );
      } catch (err) {
        console.error(`${block('✕')} ${formatError(err)}`);
        process.exit(1);
      }
    });

  return cmd;
}
