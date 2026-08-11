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
 * with a confusing 404. `verik init` and `verik doctor` ask for them
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
  /**
   * Models used when the provider is selected and none are configured.
   *
   * Without this, `init` wrote Anthropic ids whatever provider you chose, so
   * picking OpenAI sent `claude-opus-5` to api.openai.com and every stage
   * failed. These are starting points, not endorsements — ids move, and
   * VERIK_MODEL_{SCOUT,REVIEWER,JUDGE} overrides any of them.
   */
  defaultModels: { scout: string; reviewer: string; judge: string };
}

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  anthropic: {
    id: 'anthropic',
    defaultModels: {
      scout: 'claude-haiku-4-5',
      reviewer: 'claude-sonnet-5',
      judge: 'claude-opus-5',
    },
    label: 'Anthropic',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    docs: 'https://console.anthropic.com/settings/keys',
  },
  openai: {
    id: 'openai',
    defaultModels: { scout: 'gpt-4o-mini', reviewer: 'gpt-4o', judge: 'gpt-4o' },
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    docs: 'https://platform.openai.com/api-keys',
  },
  openrouter: {
    id: 'openrouter',
    defaultModels: {
      scout: 'openai/gpt-4o-mini',
      reviewer: 'anthropic/claude-sonnet-4.5',
      judge: 'anthropic/claude-sonnet-4.5',
    },
    label: 'OpenRouter (many models, one key)',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    docs: 'https://openrouter.ai/keys',
    exampleModels: 'e.g. anthropic/claude-sonnet-4.5, openai/gpt-4o, deepseek/deepseek-chat',
  },
  google: {
    id: 'google',
    defaultModels: {
      scout: 'gemini-2.0-flash',
      reviewer: 'gemini-2.0-flash',
      judge: 'gemini-2.0-flash',
    },
    label: 'Google (Gemini)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnv: 'GEMINI_API_KEY',
    docs: 'https://aistudio.google.com/apikey',
  },
  mistral: {
    id: 'mistral',
    defaultModels: {
      scout: 'mistral-small-latest',
      reviewer: 'mistral-large-latest',
      judge: 'mistral-large-latest',
    },
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    apiKeyEnv: 'MISTRAL_API_KEY',
    docs: 'https://console.mistral.ai/api-keys',
  },
  deepseek: {
    id: 'deepseek',
    defaultModels: {
      scout: 'deepseek-chat',
      reviewer: 'deepseek-chat',
      judge: 'deepseek-reasoner',
    },
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    docs: 'https://platform.deepseek.com/api_keys',
  },
  groq: {
    id: 'groq',
    defaultModels: {
      scout: 'llama-3.3-70b-versatile',
      reviewer: 'llama-3.3-70b-versatile',
      judge: 'llama-3.3-70b-versatile',
    },
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
    docs: 'https://console.groq.com/keys',
  },
  together: {
    id: 'together',
    defaultModels: {
      scout: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      reviewer: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      judge: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    },
    label: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    apiKeyEnv: 'TOGETHER_API_KEY',
    docs: 'https://api.together.ai/settings/api-keys',
  },
  fireworks: {
    id: 'fireworks',
    defaultModels: {
      scout: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
      reviewer: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
      judge: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
    },
    label: 'Fireworks AI',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    apiKeyEnv: 'FIREWORKS_API_KEY',
    docs: 'https://fireworks.ai/account/api-keys',
  },
  huggingface: {
    id: 'huggingface',
    defaultModels: {
      scout: 'meta-llama/Llama-3.3-70B-Instruct',
      reviewer: 'meta-llama/Llama-3.3-70B-Instruct',
      judge: 'meta-llama/Llama-3.3-70B-Instruct',
    },
    label: 'Hugging Face',
    baseUrl: 'https://router.huggingface.co/v1',
    apiKeyEnv: 'HF_TOKEN',
    docs: 'https://huggingface.co/settings/tokens',
  },
  ollama: {
    id: 'ollama',
    defaultModels: { scout: 'llama3.2', reviewer: 'llama3.2', judge: 'llama3.2' },
    label: 'Ollama (local, no key, no data leaves your machine)',
    baseUrl: 'http://localhost:11434/v1',
    apiKeyEnv: 'OLLAMA_API_KEY',
    keyOptional: true,
    docs: 'https://ollama.com',
  },
  custom: {
    id: 'custom',
    defaultModels: { scout: '', reviewer: '', judge: '' },
    label: 'Custom OpenAI-compatible endpoint',
    apiKeyEnv: 'VERIK_API_KEY',
    keyOptional: true,
    docs: 'Set provider.baseUrl in .verik/config.json',
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

/**
 * Resolves the API key for a provider.
 *
 * VERIK_API_KEY wins so a single variable can drive any provider in CI
 * without the workflow needing to know which one is configured.
 */
export function resolveApiKey(spec: ProviderSpec): string | undefined {
  return process.env['VERIK_API_KEY'] || process.env[spec.apiKeyEnv] || undefined;
}
