import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { PROVIDERS, PROVIDER_IDS } from './providers.js';

/**
 * Guards against provider hardcoding.
 *
 * Every one of these was a real bug found by pointing Verik at OpenAI for the
 * first time: `init` wrote Claude model ids into an OpenAI config, `doctor`
 * built an Anthropic client and told a valid OpenAI key to "generate a new key
 * at console.anthropic.com", `status` reported no key at all, and the config
 * schema filled in Claude ids for any config without a `models` block.
 *
 * They were all the same mistake in five places, which is what makes it worth a
 * test rather than five fixes. Anthropic is one of twelve providers; anything
 * that assumes it is the only one is broken for the other eleven.
 *
 * Files that legitimately name Anthropic are listed below and nothing else may.
 */

const SRC = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** Files allowed to reference Anthropic specifically, and why. */
const ALLOWED = new Set([
  'inference/providers.ts', // the registry — every provider is named here
  'inference/anthropic-provider.ts', // the Anthropic implementation itself
  'config/config-schema.ts', // schema defaults, corrected per-provider on load
  'config/defaults.ts', // the documented Anthropic default provider
  'inference/provider-neutrality.test.ts', // this file
]);

async function sourceFiles(dir: string, acc: string[] = []): Promise<string[]> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) await sourceFiles(full, acc);
    else if (e.name.endsWith('.ts')) acc.push(full);
  }
  return acc;
}

/** Strips comments so prose explaining a past bug does not trip the check. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join('\n');
}

describe('provider neutrality', () => {
  it('does not read ANTHROPIC_API_KEY outside the provider registry', async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      const rel = relative(SRC, file).replace(/\\/g, '/');
      if (ALLOWED.has(rel)) continue;
      if (/ANTHROPIC_API_KEY/.test(code(await readFile(file, 'utf8')))) offenders.push(rel);
    }
    // Resolve the key through the provider spec: resolveApiKey(PROVIDERS[config.provider]).
    expect(offenders).toEqual([]);
  });

  it('does not hardcode Claude model ids outside the registry and schema', async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      const rel = relative(SRC, file).replace(/\\/g, '/');
      if (ALLOWED.has(rel) || rel.endsWith('fake-data.ts')) continue;
      const body = code(await readFile(file, 'utf8'));
      // Anthropic's own doctor probe is fine; anything else is an assumption.
      if (/'claude-[\w.-]+'/.test(body) && !/providerId === 'anthropic'/.test(body)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('gives every provider its own default models', () => {
    for (const id of PROVIDER_IDS) {
      const spec = PROVIDERS[id];
      expect(spec.defaultModels, `${id} has no defaultModels`).toBeDefined();
      // `custom` is deliberately blank — the user supplies the endpoint and ids.
      if (id === 'custom') continue;
      for (const stage of ['scout', 'reviewer', 'judge'] as const) {
        expect(spec.defaultModels[stage], `${id}.${stage} is empty`).toBeTruthy();
      }
    }
  });

  it('never offers a Claude model id to a non-Anthropic provider', () => {
    for (const id of PROVIDER_IDS) {
      if (id === 'anthropic') continue;
      const models = Object.values(PROVIDERS[id].defaultModels);
      // OpenRouter namespaces vendors, so `anthropic/claude-...` is legitimate
      // there and only there.
      const bare = models.filter((m) => m.startsWith('claude-'));
      expect(bare, `${id} defaults to a bare Claude id`).toEqual([]);
    }
  });
});
