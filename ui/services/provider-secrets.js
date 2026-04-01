const STORAGE_KEY = "obs-ai-broadcast-graphics.provider-secrets";

const AUTO_MODELS = {
  openrouter: {
    textModel: "openai/gpt-4.1-mini",
    imageModel: "google/gemini-2.5-flash-image-preview",
  },
  groq: {
    textModel: "openai/gpt-oss-20b",
    imageModel: "",
  },
  mistral: {
    textModel: "mistral-small-latest",
    imageModel: "",
  },
  huggingface: {
    textModel: "Qwen/Qwen2.5-7B-Instruct",
    imageModel: "black-forest-labs/FLUX.1-schnell",
  },
  deepseek: {
    textModel: "deepseek-chat",
    imageModel: "",
  },
};

const DEFAULTS = Object.fromEntries(
  Object.entries(AUTO_MODELS).map(([providerId, models]) => [
    providerId,
    {
      apiKey: "",
      ...models,
    },
  ]),
);

export function loadProviderSecrets() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULTS;
    }
    const parsed = JSON.parse(raw);
    return Object.fromEntries(
      Object.keys(DEFAULTS).map((providerId) => [
        providerId,
        {
          ...DEFAULTS[providerId],
          ...(parsed?.[providerId] || {}),
          ...AUTO_MODELS[providerId],
        },
      ]),
    );
  } catch {
    return DEFAULTS;
  }
}

export function getProviderSecret(providerId) {
  return loadProviderSecrets()[providerId] || DEFAULTS[providerId] || {};
}

export function getAutoModelSelection() {
  return AUTO_MODELS;
}
