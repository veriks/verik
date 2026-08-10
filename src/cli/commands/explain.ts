import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { getRepositoryInfo } from '../../core/repository/git-repository.js';
import { listRunIds } from '../../storage/local-run-store.js';
import { runFilePath } from '../../storage/paths.js';
import type { JudgeOutput } from '../../stages/judge/judge-schema.js';
import { box, brand, section, severityTint, subtle, verdictTint } from '../output/theme.js';

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
          const parsed = JSON.parse(raw) as { output?: JudgeOutput } | JudgeOutput;

          // Stage files are saved as { ...metadata, output: JudgeOutput }.
          // Handle both that shape and the legacy bare JudgeOutput.
          const judge: JudgeOutput | undefined =
            parsed && typeof parsed === 'object' && 'output' in parsed && parsed.output
              ? parsed.output
              : (parsed as JudgeOutput);

          if (!judge?.verdict) {
            console.log(`Run ${id} has no verdict yet — verification may not have completed.`);
            return;
          }

          console.log();
          for (const line of box(
            judge.verdict.toUpperCase(),
            judge.summary,
            verdictTint(judge.verdict),
          )) {
            console.log(line);
          }
          console.log(subtle(`  ${Math.round(judge.confidence * 100)}% confidence · ${id}\n`));

          if (judge.reasons.length) {
            console.log(section('reasons'));
            for (const r of judge.reasons) {
              const tint = severityTint(r.severity);
              console.log(`${tint('▊')} ${tint(r.severity.toUpperCase().padEnd(8))}${r.title}`);
            }
            console.log();
          }

          if (judge.requiredActions.length) {
            console.log(section('required actions'));
            for (const a of judge.requiredActions) console.log(`  ${brand('→')} ${a}`);
            console.log();
          }

          if (judge.dismissedFindings.length) {
            console.log(
              subtle(
                `${judge.dismissedFindings.length} finding(s) dismissed as unsupported by the Judge.\n`,
              ),
            );
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
