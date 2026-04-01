export const PROVIDER_ORDER = [
  "openrouter",
  "groq",
  "mistral",
  "huggingface",
  "deepseek",
];

export function normalizeProvider(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return PROVIDER_ORDER.includes(normalized) ? normalized : "openrouter";
}

export function getNextProvider(currentProvider) {
  const current = normalizeProvider(currentProvider);
  const index = PROVIDER_ORDER.indexOf(current);
  return PROVIDER_ORDER[(index + 1) % PROVIDER_ORDER.length];
}
