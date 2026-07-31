import type { RunContext } from '../../core/run/run-context.js';
import { truncateBytes } from '../../shared/tokens.js';

export interface ScoutPrompt {
  system: string;
  user: string;
}

export function buildScoutPrompt(context: RunContext): ScoutPrompt {
  const { diff, record, config } = context;
  const maxDiff = config.verification.maxDiffBytes;

  const system = `You are Scout, the first stage in the Crosscheck verification pipeline.
Your job is to understand the scope, intent, and risk profile of a code change produced by an AI coding agent.

Be factual. Cite file paths and diff evidence for your conclusions.
Do not invent business requirements.
When intent is unclear, record it in uncertainties.

For builderRecommendations: state verification goals in plain English only.
Examples of valid goals: "TypeScript compilation should be checked", "unit tests should run".
Do NOT produce shell commands. The Builder uses a deterministic allowlist to map goals to commands.

Respond ONLY with structured JSON matching the provided schema.`;

  const changedFilesList = (diff?.changedFiles ?? [])
    .map((f) => `  ${f.changeType}: ${f.path}`)
    .join('\n');

  const preExisting = diff?.preExistingChangedPaths.length
    ? `\nPRE-EXISTING CHANGES (not introduced by this command):\n${diff.preExistingChangedPaths.map((p) => `  ${p}`).join('\n')}`
    : '';

  const introduced = diff?.commandIntroducedPaths.length
    ? `\nINTRODUCED BY THIS COMMAND:\n${diff.commandIntroducedPaths.map((p) => `  ${p}`).join('\n')}`
    : '';

  const patchSection = diff?.patch
    ? `\n\nDIFF (attributable to this command only, may be truncated):\n${truncateBytes(diff.patch, Math.min(maxDiff, 40_000))}`
    : '';

  const user = `WRAPPED COMMAND: ${record.wrappedCommand.join(' ')}
REPOSITORY: ${record.repositoryPath}
BRANCH: ${record.branch}
COMMIT BEFORE: ${record.baselineCommitSha}
${context.intent ? `USER INTENT: ${context.intent}` : ''}

CHANGED FILES (${diff?.changedFiles.length ?? 0}):
${changedFilesList || '  (none)'}
${preExisting}${introduced}

DIFF STATS: +${diff?.additions ?? 0} / -${diff?.deletions ?? 0}
${diff?.truncated ? 'NOTE: Diff was truncated due to size.' : ''}
${patchSection}

Analyze this change and return structured Scout output.`;

  return { system, user };
}
