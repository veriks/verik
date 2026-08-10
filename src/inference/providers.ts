/**
 * Known inference providers.
 *
 * Anthropic gets a native implementation because its structured output uses
 * tool_use. Everything else — OpenAI, Google, Mistral, DeepSeek, Groq, and the
 * aggregators like OpenRouter and Hugging Face — exposes an OpenAI-compatible
 * `/chat/completions` endpoint, so one implementation covers all of them and
 * `custom` covers anything not listed (including a local Ollama or LM Studio).
 *
 * Deliberately no model defaults outside Anthropic: model identifiers change
 * often and vary per host, and a wrong default fails at the first real request
 * with a confusing 404. `crosscheck init` and `crosscheck doctor` ask for them
 * instead of guessing.
 */

export type ProviderId =
  | 'anthropic'
  | 'openai'
  | 'openrouter'
  | 'google'
  | 'mistral'
  | 'deepseek'
  | 'groq'
  | 'together'
  | 'fireworks'
  | 'huggingface'
  | 'ollama'
  | 'custom';

export interface ProviderSpec {
  id: ProviderId;
  label: string;
  /** OpenAI-compatible base URL. Undefined for the native Anthropic path. */
  baseUrl?: string;
  /** Environment variable holding the key. */
  apiKeyEnv: string;
  /** Local runtimes accept any key, so an absent one is not an error. */
  keyOptional?: boolean;
  docs: string;
  /** Illustrative model ids — shown as hints, never used as defaults. */
  exampleModels?: string;
}

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    docs: 'https://console.anthropic.com/settings/keys',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    docs: 'https://platform.openai.com/api-keys',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter (many models, one key)',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    docs: 'https://openrouter.ai/keys',
    exampleModels: 'e.g. anthropic/claude-sonnet-4.5, openai/gpt-4o, deepseek/deepseek-chat',
  },
  google: {
    id: 'google',
    label: 'Google (Gemini)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnv: 'GEMINI_API_KEY',
    docs: 'https://aistudio.google.com/apikey',
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    apiKeyEnv: 'MISTRAL_API_KEY',
    docs: 'https://console.mistral.ai/api-keys',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    docs: 'https://platform.deepseek.com/api_keys',
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
    docs: 'https://console.groq.com/keys',
  },
  together: {
    id: 'together',
    label: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    apiKeyEnv: 'TOGETHER_API_KEY',
    docs: 'https://api.together.ai/settings/api-keys',
  },
  fireworks: {
    id: 'fireworks',
    label: 'Fireworks AI',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    apiKeyEnv: 'FIREWORKS_API_KEY',
    docs: 'https://fireworks.ai/account/api-keys',
  },
  huggingface: {
    id: 'huggingface',
    label: 'Hugging Face',
    baseUrl: 'https://router.huggingface.co/v1',
    apiKeyEnv: 'HF_TOKEN',
    docs: 'https://huggingface.co/settings/tokens',
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama (local, no key, no data leaves your machine)',
    baseUrl: 'http://localhost:11434/v1',
    apiKeyEnv: 'OLLAMA_API_KEY',
    keyOptional: true,
    docs: 'https://ollama.com',
  },
  custom: {
    id: 'custom',
    label: 'Custom OpenAI-compatible endpoint',
    apiKeyEnv: 'CROSSCHECK_API_KEY',
    keyOptional: true,
    docs: 'Set provider.baseUrl in .crosscheck/config.json',
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

/**
 * Resolves the API key for a provider.
 *
 * CROSSCHECK_API_KEY wins so a single variable can drive any provider in CI
 * without the workflow needing to know which one is configured.
 */
export function resolveApiKey(spec: ProviderSpec): string | undefined {
  return process.env['CROSSCHECK_API_KEY'] || process.env[spec.apiKeyEnv] || undefined;
}
