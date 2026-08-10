import type { RunContext } from '../../core/run/run-context.js';
import type { Override } from '../../core/memory/memory-schema.js';
import { getActiveOverrides } from '../../core/memory/memory-store.js';
import {
  applyOverridesToDeterministic,
  type SuppressedFinding,
} from '../../core/policy/override-engine.js';
import { runDeterministicRules, type DeterministicFinding } from './deterministic-rules/index.js';
import { logger } from '../../shared/logger.js';

/**
 * The deterministic rules, run as their own pipeline step rather than inside the
 * Reviewer.
 *
 * They used to run inside ReviewerStage and only ever appear as prose in the
 * Reviewer's prompt: `ReviewerOutput.findings` carried LLM findings alone. So a
 * fired secret-leak rule vanished entirely whenever the Reviewer's LLM call
 * failed, and the Judge — which is supposed to treat deterministic evidence as
 * outranking model opinion — never saw one.
 *
 * Running here means the findings survive Reviewer failure and reach the Judge,
 * the report and memory on their own footing.
 */
export interface DeterministicPass {
  findings: DeterministicFinding[];
  suppressed: SuppressedFinding[];
  overrides: Override[];
}

export async function runDeterministicPass(context: RunContext): Promise<DeterministicPass> {
  let overrides: Override[] = [];
  try {
    overrides = await getActiveOverrides(context.repoRoot);
    if (overrides.length) logger.debug(`${overrides.length} active override(s) loaded`);
  } catch (err) {
    logger.debug(`Could not load overrides: ${String(err)}`);
  }

  const { diff } = context;
  // Rules read the RAW patch deliberately: redaction would replace the very
  // strings the secret-leak rule exists to detect. These run in-process and
  // emit nothing to the network.
  const raw = diff ? await runDeterministicRules({ diff, patch: diff.patch }) : [];

  const { kept, suppressed } = applyOverridesToDeterministic(raw, overrides);
  if (suppressed.length) {
    logger.debug(`Suppressed ${suppressed.length} deterministic finding(s) via overrides`);
  }

  return { findings: kept, suppressed, overrides };
}
