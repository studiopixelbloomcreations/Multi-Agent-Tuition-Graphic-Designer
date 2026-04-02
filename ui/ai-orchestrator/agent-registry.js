export const TASK_TYPES = {
  promptGeneration: "prompt-generation",
  imageGeneration: "image-generation",
  imageTransformation: "image-transformation",
  backgroundRemoval: "background-removal",
  seasonDetection: "season-detection",
  qualityEnhancement: "quality-enhancement",
};

export const AGENT_REGISTRY = {
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    strengths: ["coordination", "fallback", "general reasoning"],
    tasks: [TASK_TYPES.promptGeneration, TASK_TYPES.seasonDetection, TASK_TYPES.qualityEnhancement, TASK_TYPES.imageGeneration, TASK_TYPES.imageTransformation],
  },
  groq: {
    id: "groq",
    label: "Groq",
    strengths: ["fast text generation", "real-time prompt shaping"],
    tasks: [TASK_TYPES.promptGeneration, TASK_TYPES.qualityEnhancement],
  },
  mistral: {
    id: "mistral",
    label: "Mistral",
    strengths: ["high-volume text processing", "season analysis"],
    tasks: [TASK_TYPES.promptGeneration, TASK_TYPES.seasonDetection, TASK_TYPES.qualityEnhancement],
  },
  huggingface: {
    id: "huggingface",
    label: "Hugging Face",
    strengths: ["image generation", "image-to-image transformation", "background removal"],
    tasks: [TASK_TYPES.imageGeneration, TASK_TYPES.imageTransformation, TASK_TYPES.backgroundRemoval],
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    strengths: ["advanced reasoning", "prompt optimization"],
    tasks: [TASK_TYPES.promptGeneration, TASK_TYPES.qualityEnhancement, TASK_TYPES.seasonDetection],
  },
};

export const TASK_PREFERENCES = {
  [TASK_TYPES.promptGeneration]: ["deepseek", "groq", "mistral", "openrouter"],
  [TASK_TYPES.imageGeneration]: ["huggingface", "openrouter"],
  [TASK_TYPES.imageTransformation]: ["huggingface", "openrouter"],
  [TASK_TYPES.backgroundRemoval]: ["huggingface", "openrouter"],
  [TASK_TYPES.seasonDetection]: ["mistral", "openrouter", "deepseek"],
  [TASK_TYPES.qualityEnhancement]: ["deepseek", "openrouter", "groq", "mistral"],
};
