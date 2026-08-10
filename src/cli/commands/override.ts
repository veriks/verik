import { block } from '../output/theme.js';
import { formatError } from '../../shared/format-error.js';
import { Command } from 'commander';
import { getRepositoryInfo } from '../../core/repository/git-repository.js';
import { saveOverride, getActiveOverrides } from '../../core/memory/memory-store.js';
import type { Override } from '../../core/memory/memory-schema.js';

export function buildOverrideCommand(): Command {
  const cmd = new Command('override').description('Manage finding overrides for this repository');

  cmd
    .command('add')
    .description('Suppress a finding pattern in future runs')
    .requiredOption('--reason <text>', 'Why this finding is being suppressed')
    .option('--rule <id>', 'Deterministic rule ID to suppress (e.g. secret-leak)')
    .option('--path <file>', 'File path to scope the suppression to')
    .option('--title <pattern>', 'Regex pattern matched against finding titles')
    .option('--expires <date>', 'ISO date when this override expires (e.g. 2026-12-31)')
    .action(
      async (options: {
        reason: string;
        rule?: string;
        path?: string;
        title?: string;
        expires?: string;
      }) => {
        try {
          const info = await getRepositoryInfo(process.cwd());
          const id = await saveOverride(info.root, {
            repositoryPath: info.root,
            reason: options.reason,
            ruleId: options.rule,
            filePath: options.path,
            titlePattern: options.title,
            expiresAt: options.expires,
          });
          console.log(`Override saved: ${id}`);
          if (options.expires) console.log(`Expires: ${options.expires}`);
        } catch (err) {
          console.error(`${block('✕')} ${formatError(err)}`);
          process.exit(1);
        }
      },
    );

  cmd
    .command('list')
    .description('List active overrides')
    .option('--json', 'Machine-readable output')
    .action(async (options: { json?: boolean }) => {
      try {
        const info = await getRepositoryInfo(process.cwd());
        const overrides = await getActiveOverrides(info.root);

        if (overrides.length === 0) {
          console.log('No active overrides.');
          return;
        }

        if (options.json) {
          console.log(JSON.stringify(overrides, null, 2));
          return;
        }

        for (const o of overrides) {
          console.log(`${o.id}`);
          console.log(`  Reason:  ${o.reason}`);
          if (o.ruleId) console.log(`  Rule:    ${o.ruleId}`);
          if (o.filePath) console.log(`  Path:    ${o.filePath}`);
          if (o.titlePattern) console.log(`  Title:   ${o.titlePattern}`);
          if (o.expiresAt) console.log(`  Expires: ${o.expiresAt}`);
          console.log();
        }
      } catch (err) {
        console.error(`${block('✕')} ${formatError(err)}`);
        process.exit(1);
      }
    });

  cmd
    .command('remove <id>')
    .description('Remove an override by ID')
    .action(async (overrideId: string) => {
      try {
        const info = await getRepositoryInfo(process.cwd());
        const { readFile, writeFile } = await import('node:fs/promises');
        const { join } = await import('node:path');
        const memPath = join(info.root, '.crosscheck', 'memory.json');
        try {
          const raw = await readFile(memPath, 'utf8');
          const index = JSON.parse(raw) as { overrides?: Override[] };
          const before = index.overrides?.length ?? 0;
          index.overrides = (index.overrides ?? []).filter((o) => o.id !== overrideId);
          const after = index.overrides.length;
          if (before === after) {
            console.log(`Override ${overrideId} not found.`);
            return;
          }
          const tmp = memPath + '.tmp';
          await writeFile(tmp, JSON.stringify(index, null, 2), 'utf8');
          const { rename } = await import('node:fs/promises');
          await rename(tmp, memPath);
          console.log(`Override ${overrideId} removed.`);
        } catch {
          console.log('No memory store found — nothing to remove.');
        }
      } catch (err) {
        console.error(`${block('✕')} ${formatError(err)}`);
        process.exit(1);
      }
    });

  return cmd;
}
