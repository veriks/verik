import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PROVIDERS, PROVIDER_IDS } from './providers.js';

/**
 * Keeps the README's provider table honest.
 *
 * It listed xAI and Cohere, neither of which Verik supports — a claim nobody
 * would question until someone set XAI_API_KEY and found nothing happened. A
 * table of integrations is a promise, and this is the cheapest way to keep it
 * one that holds.
 */
const README = new URL('../../README.md', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

describe('README provider table', () => {
  it('names the environment variable of every real provider', async () => {
    const text = await readFile(README, 'utf8');
    const missing = PROVIDER_IDS.filter((id) => {
      const spec = PROVIDERS[id];
      // Ollama needs no key and `custom` is described in prose, not the table.
      if (id === 'custom' || spec.keyOptional) return false;
      return !text.includes(spec.apiKeyEnv);
    });
    expect(missing, `README omits: ${missing.join(', ')}`).toEqual([]);
  });

  it('does not advertise providers that do not exist', async () => {
    const text = await readFile(README, 'utf8');
    const real = new Set(PROVIDER_IDS.map((id) => PROVIDERS[id].apiKeyEnv));
    const advertised = [...text.matchAll(/`([A-Z][A-Z0-9_]*_(?:API_KEY|TOKEN))`/g)].map(
      (m) => m[1]!,
    );
    const invented = [...new Set(advertised)].filter(
      (v) => !real.has(v) && !v.startsWith('VERIK_'),
    );
    expect(invented, `README claims unsupported: ${invented.join(', ')}`).toEqual([]);
  });
});
