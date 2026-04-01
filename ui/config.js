export const GRAPHICS = [
  { id: "intro-lower-third", label: "Intro Lower Third", type: "intro lower third" },
  { id: "always-on-lower-third", label: "Always-On Lower Third", type: "always-on lower third" },
  { id: "live-badge", label: "Live Badge", type: "live badge" },
  { id: "institution-banner", label: "Institution Banner", type: "institution banner" },
];

export const AI_MODELS = {
  season: "gpt-5.4-nano",
  prompts: "gpt-5.4-nano",
  imagePrimary: "gemini-2.5-flash-image-preview",
  imageFallback: "gemini-2.5-flash-image-preview",
  review: "gpt-5.4-nano",
  backgroundAnalysis: "gpt-5.4-nano",
};

export const QUALITY_POLICY = {
  minimumScore: 80,
  maxAttempts: 3,
};

export const BACKGROUND_REMOVAL_POLICY = {
  maxAttempts: 3,
  baseTolerance: 42,
  edgeSoftness: 22,
  despillStrength: 0.72,
  sharpenStrength: 0.18,
};
