const STORAGE_KEY = "obs-ai-broadcast-graphics.provider-secrets";

const DEFAULTS = {
  openrouter: {
    apiKey: "",
    textModel: "openai/gpt-4.1-mini",
    imageModel: "google/gemini-2.5-flash-image-preview",
  },
  groq: {
    apiKey: "",
    textModel: "openai/gpt-oss-20b",
    imageModel: "",
  },
  mistral: {
    apiKey: "",
    textModel: "mistral-small-latest",
    imageModel: "",
  },
  huggingface: {
    apiKey: "",
    textModel: "Qwen/Qwen2.5-7B-Instruct",
    imageModel: "black-forest-labs/FLUX.1-schnell",
  },
  deepseek: {
    apiKey: "",
    textModel: "deepseek-chat",
    imageModel: "",
  },
};

export function loadProviderSecrets() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function getProviderSecret(providerId) {
  return loadProviderSecrets()[providerId] || DEFAULTS[providerId] || {};
}
