/**
 * Two kinds of patch, distinguished at the type level.
 *
 * The privacy guarantee in the README ("secrets are redacted from diffs before
 * any LLM call") was previously enforced only by convention, and the convention
 * lost: the sanitiser existed but nothing called it, so the raw patch travelled
 * to the API. A brand makes that class of mistake a compile error rather than a
 * code-review responsibility — `systemPrompt: diff.patch` no longer type-checks.
 *
 *   RawPatch   the literal git output. Secrets intact. Local disk only.
 *   SafePatch  exclusion-filtered and redacted. The only patch that may leave
 *              the machine — LLM prompts, reports, anything shareable.
 *
 * Deterministic secret-detection rules deliberately consume RawPatch: a rule
 * that only ever sees `[REDACTED]` can never fire.
 */

declare const patchBrand: unique symbol;

export type RawPatch = string & { readonly [patchBrand]: 'raw' };
export type SafePatch = string & { readonly [patchBrand]: 'safe' };

/**
 * Brands git's output as raw. Free to call — asserting that a patch is
 * *unsafe* costs nothing, since RawPatch grants no privileges.
 */
export function asRawPatch(text: string): RawPatch {
  return text as RawPatch;
}

export const EMPTY_RAW_PATCH = asRawPatch('');
