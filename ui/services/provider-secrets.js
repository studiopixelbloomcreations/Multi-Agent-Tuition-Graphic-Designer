const STORAGE_KEY = "obs-ai-broadcast-graphics.provider-secrets";
const ENV_BLOB_KEY = "AI_PROVIDER_KEYS_JSON";

const AUTO_MODELS = {
  openrouter: {
    textModel: "openai/gpt-4.1-mini",
    imageModel: "google/gemini-2.5-flash-image",
    imageTransformModel: "google/gemini-2.5-flash-image",
  },
  groq: {
    textModel: "openai/gpt-oss-20b",
    imageModel: "",
    imageTransformModel: "",
  },
  mistral: {
    textModel: "mistral-small-latest",
    imageModel: "",
    imageTransformModel: "",
  },
  huggingface: {
    textModel: "Qwen/Qwen2.5-7B-Instruct",
    imageModel: "black-forest-labs/FLUX.1-schnell",
    imageTransformModel: "Qwen/Qwen-Image-Edit",
  },
  deepseek: {
    textModel: "deepseek-chat",
    imageModel: "",
    imageTransformModel: "",
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

function parseSecretsBlob(raw) {
  if (!raw) return {};
  if (typeof raw === "object") {
    return raw;
  }
  if (typeof raw !== "string") {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function loadProviderSecretsFromEnvironment() {
  const globalRaw =
    globalThis.__AI_PROVIDER_KEYS_JSON__
    || globalThis[ENV_BLOB_KEY]
    || globalThis.__APP_CONFIG__?.AI_PROVIDER_KEYS_JSON
    || globalThis.__APP_CONFIG__?.aiProviderKeysJson
    || "";
  return parseSecretsBlob(globalRaw);
}

export function loadProviderSecrets() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const envParsed = loadProviderSecretsFromEnvironment();
    return Object.fromEntries(
      Object.keys(DEFAULTS).map((providerId) => [
        providerId,
        {
          ...DEFAULTS[providerId],
          ...(parsed?.[providerId] || {}),
          ...(envParsed?.[providerId] || {}),
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
