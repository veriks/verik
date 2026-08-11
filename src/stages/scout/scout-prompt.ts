import type { RunContext } from '../../core/run/run-context.js';
import { redactCommandLine } from '../../shared/redaction.js';

export interface ScoutPrompt {
  system: string;
  user: string;
}

export function buildScoutPrompt(context: RunContext): ScoutPrompt {
  const { diff, record, selectedContext } = context;

  const system = `You are Scout, the first stage in the Verik verification pipeline.
Your job is to understand the scope, intent, and risk profile of a code change produced by an AI coding agent.

Be factual. Cite file paths and diff evidence for your conclusions.
Do not invent business requirements.
When intent is unclear, record it in uncertainties.

For builderRecommendations: state verification goals in plain English only.
Examples of valid goals: "TypeScript compilation should be checked", "unit tests should run".
Do NOT produce shell commands. The Builder uses a deterministic allowlist to map goals to commands.

Respond ONLY with structured JSON matching the provided schema.`;

  // Falls back to safePatch, never patch: an absent selectedContext must not
  // silently downgrade to the unredacted diff.
  const patch = selectedContext?.diff ?? diff?.safePatch ?? '';
  const changedFiles = diff?.changedFiles ?? [];

  const changedFilesList = changedFiles.map((f) => `  ${f.changeType}: ${f.path}`).join('\n');

  const preExisting = diff?.preExistingChangedPaths.length
    ? `\nPRE-EXISTING CHANGES (not introduced by this command):\n${diff.preExistingChangedPaths.map((p) => `  ${p}`).join('\n')}`
    : '';

  const introduced = diff?.commandIntroducedPaths.length
    ? `\nINTRODUCED BY THIS COMMAND:\n${diff.commandIntroducedPaths.map((p) => `  ${p}`).join('\n')}`
    : '';

  const fileContents = selectedContext?.changedFiles.length
    ? '\n\nCHANGED FILE CONTENTS:\n' +
      selectedContext.changedFiles
        .map(
          (f) =>
            `--- ${f.path} (lines ${f.startLine}-${f.endLine}${f.truncated ? ', truncated' : ''}) ---\n${f.content}`,
        )
        .join('\n\n')
    : '';

  const manifests = selectedContext?.manifestFiles.length
    ? '\n\nPROJECT MANIFESTS:\n' +
      selectedContext.manifestFiles.map((f) => `--- ${f.path} ---\n${f.content}`).join('\n\n')
    : '';

  const limitations = selectedContext?.limitations.length
    ? `\nCONTEXT LIMITATIONS: ${selectedContext.limitations.join('; ')}`
    : '';

  const user = `WRAPPED COMMAND: ${redactCommandLine(record.wrappedCommand)}
REPOSITORY: ${record.repositoryPath}
BRANCH: ${record.branch}
COMMIT BEFORE: ${record.baselineCommitSha}
${context.intent ? `USER INTENT: ${context.intent}` : ''}

CHANGED FILES (${changedFiles.length}):
${changedFilesList || '  (none)'}
${preExisting}${introduced}

DIFF STATS: +${diff?.additions ?? 0} / -${diff?.deletions ?? 0}
${diff?.truncated ? 'NOTE: Diff was truncated due to size.' : ''}${limitations}

DIFF:
${patch}
${fileContents}${manifests}

Analyze this change and return structured Scout output.`;

  return { system, user };
}
