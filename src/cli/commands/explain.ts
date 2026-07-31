import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { getRepositoryInfo } from '../../core/repository/git-repository.js';
import { listRunIds } from '../../storage/local-run-store.js';
import { runFilePath } from '../../storage/paths.js';
import type { JudgeOutput } from '../../stages/judge/judge-schema.js';

export function buildExplainCommand(): Command {
  return new Command('explain')
    .description('Explain the latest verdict in plain English')
    .argument('[run-id]', 'Run ID (defaults to latest)')
    .action(async (runId: string | undefined) => {
      try {
        const info = await getRepositoryInfo(process.cwd());
        let id = runId;
        if (!id) {
          const ids = await listRunIds(info.root);
          id = ids[0];
          if (!id) {
            console.log('No runs found.');
            return;
          }
        }
        const judgePath = runFilePath(info.root, id, 'judge.json');
        try {
          const raw = await readFile(judgePath, 'utf8');
          const judge = JSON.parse(raw) as JudgeOutput;
          console.log(`Verdict: ${judge.verdict.toUpperCase()} (${Math.round(judge.confidence * 100)}% confidence)`);
          console.log('');
          console.log(judge.summary);
          if (judge.requiredActions.length) {
            console.log('\nRequired actions:');
            for (const a of judge.requiredActions) console.log(`  - ${a}`);
          }
        } catch {
          console.log(`No judge output found for run ${id}.`);
          console.log('This run may not have completed verification.');
        }
      } catch (err) {
        console.error('Error:', String(err));
        process.exit(1);
      }
    });
}
