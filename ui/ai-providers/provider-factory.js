import { getProviderSecret } from "../services/provider-secrets.js";

const NETLIFY_PROXY_PATH = "/.netlify/functions/ai-provider";

function withTimeout(promise, label, ms = 45000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000} seconds.`)), ms);
    }),
  ]);
}

function extractText(result) {
  if (typeof result === "string") return result;
  if (typeof result?.text === "string") return result.text;
  if (Array.isArray(result?.choices) && typeof result.choices[0]?.message?.content === "string") {
    return result.choices[0].message.content;
  }
  if (Array.isArray(result?.choices) && typeof result.choices[0]?.text === "string") {
    return result.choices[0].text;
  }
  if (Array.isArray(result?.content) && typeof result.content[0]?.text === "string") {
    return result.content.map((item) => item?.text || "").join("\n");
  }
  return "";
}

function extractOpenRouterImageDataUrl(payload) {
  const message = payload?.choices?.[0]?.message || {};
  const image =
    message?.images?.[0]?.image_url?.url
    || message?.images?.[0]?.imageUrl?.url
    || message?.content?.find?.((item) => item?.type === "image_url")?.image_url?.url
    || "";
  return image || "";
}

function buildImageContentParts(prompt, imageDataUrl) {
  return [
    { type: "text", text: prompt },
    {
      type: "image_url",
      image_url: {
        url: imageDataUrl,
      },
    },
  ];
}

function mediaDataUrlFromOptions(options = {}) {
  const media = options?.media;
  if (!media) return "";
  if (typeof media === "string") return media;
  if (typeof media?.dataUrl === "string") return media.dataUrl;
  return "";
}

function summarizeUnknown(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value?.message === "string") return value.message;
  if (typeof value?.error === "string") return value.error;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

let hfInferenceModulePromise = null;

async function getHFInferenceModule() {
  if (!hfInferenceModulePromise) {
    hfInferenceModulePromise = import("https://cdn.jsdelivr.net/npm/@huggingface/inference@4.13.15/+esm");
  }
  return hfInferenceModulePromise;
}

function ensureConfigured(providerId, capability) {
  const config = getProviderSecret(providerId);
  if (!config?.apiKey) {
    throw new Error(`${providerId} is not configured for ${capability}. Add its API key in provider secrets before testing.`);
  }
  return config;
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { rawText: text };
  }

  if (!response.ok) {
    throw new Error(`${response.status} ${summarizeUnknown(payload)}`);
  }

  return payload;
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function serializeProviderOptions(options = {}) {
  const next = { ...options };
  if (next.media instanceof File) {
    next.mediaName = next.media.name;
    next.mediaType = next.media.type;
    next.media = await fileToDataUrl(next.media);
  }
  return next;
}

async function tryProxy(providerId, functionName, payload, options = {}) {
  const serializedOptions = await serializeProviderOptions(options);
  let response;
  try {
    response = await fetch(NETLIFY_PROXY_PATH, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        providerId,
        functionName,
        payload,
        options: serializedOptions,
      }),
    });
  } catch (error) {
    const proxyError = new Error(`Proxy unavailable: ${error.message || String(error)}`);
    proxyError.code = "PROXY_UNAVAILABLE";
    throw proxyError;
  }

  if (response.status === 404) {
    const proxyError = new Error("Proxy unavailable: Netlify function not found.");
    proxyError.code = "PROXY_UNAVAILABLE";
    throw proxyError;
  }

  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text || "Unknown proxy response." };
  }

  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error || body?.message || `${response.status} ${text}`);
  }

  return body.result;
}

function buildOpenRouter(providerId) {
  return {
    id: providerId,

    async generateText(prompt, options = {}) {
      const config = ensureConfigured(providerId, "text generation");
      const mediaDataUrl = mediaDataUrlFromOptions(options);
      const messages = [{
        role: "user",
        content: mediaDataUrl ? buildImageContentParts(prompt, mediaDataUrl) : prompt,
      }];
      const payload = await withTimeout(postJson(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: config.textModel,
          messages,
        },
        {
          Authorization: `Bearer ${config.apiKey}`,
        },
      ), `${providerId} generateText`);
      return {
        text: extractText(payload).trim(),
        raw: payload,
      };
    },

    async generateImage(prompt) {
      const config = ensureConfigured(providerId, "image generation");
      if (!config.imageModel) {
        throw new Error(`${providerId} image generation is not configured.`);
      }
      const payload = await withTimeout(postJson(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: config.imageModel,
          messages: [{ role: "user", content: prompt }],
          modalities: ["image", "text"],
          image_config: {
            image_size: "1K",
            aspect_ratio: "16:9",
          },
        },
        {
          Authorization: `Bearer ${config.apiKey}`,
        },
      ), `${providerId} generateImage`);

      const dataUrl = extractOpenRouterImageDataUrl(payload);
      if (!dataUrl) {
        throw new Error(`No image returned by ${providerId}.`);
      }
      return { dataUrl, raw: payload };
    },

    async transformImage() {
      const config = ensureConfigured(providerId, "image-to-image transformation");
      const payload = arguments[0] || {};
      const imageDataUrl = String(payload?.imageDataUrl || "").trim();
      const prompt = String(payload?.prompt || "").trim();
      const modelId = config.imageTransformModel || config.imageModel;
      if (!imageDataUrl) {
        throw new Error(`${providerId} image-to-image transformation requires an input image.`);
      }
      if (!modelId) {
        throw new Error(`${providerId} image-to-image transformation is not configured yet.`);
      }
      const response = await withTimeout(postJson(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: modelId,
          messages: [{ role: "user", content: buildImageContentParts(prompt, imageDataUrl) }],
          modalities: ["image", "text"],
          image_config: {
            image_size: "1K",
            aspect_ratio: "16:9",
          },
        },
        {
          Authorization: `Bearer ${config.apiKey}`,
        },
      ), `${providerId} transformImage`);
      const dataUrl = extractOpenRouterImageDataUrl(response);
      if (!dataUrl) {
        throw new Error(`No edited image returned by ${providerId}.`);
      }
      return {
        dataUrl,
        raw: { mode: "image-to-image", modelId, provider: providerId },
      };
    },

    async removeBackground() {
      throw new Error(`${providerId} background analysis is not configured yet.`);
    },

    async detectSeason(prompt, options = {}) {
      return this.generateText(prompt, options);
    },
  };
}

function buildChatOnlyProvider(providerId, urlBuilder, bodyBuilder, headersBuilder = () => ({}), extract = extractText) {
  return {
    id: providerId,

    async generateText(prompt, options = {}) {
      if (options?.media) {
        throw new Error(`${providerId} does not support image-assisted text generation.`);
      }
      const config = ensureConfigured(providerId, "text generation");
      const payload = await withTimeout(postJson(
        urlBuilder(config),
        bodyBuilder(config, prompt),
        headersBuilder(config),
      ), `${providerId} generateText`);
      return {
        text: extract(payload).trim(),
        raw: payload,
      };
    },

    async generateImage() {
      throw new Error(`${providerId} image generation is not configured yet.`);
    },

    async transformImage() {
      throw new Error(`${providerId} image-to-image transformation is not configured yet.`);
    },

    async removeBackground() {
      throw new Error(`${providerId} background analysis is not configured yet.`);
    },

    async detectSeason(prompt, options = {}) {
      return this.generateText(prompt, options);
    },
  };
}

function buildHuggingFace(providerId) {
  return {
    id: providerId,

    async generateText(prompt, options = {}) {
      if (options?.media) {
        throw new Error(`${providerId} does not support image-assisted text generation.`);
      }
      const config = ensureConfigured(providerId, "text generation");
      const payload = await withTimeout(postJson(
        `https://router.huggingface.co/hf-inference/models/${config.textModel}`,
        {
          inputs: prompt,
        },
        {
          Authorization: `Bearer ${config.apiKey}`,
        },
      ), `${providerId} generateText`);
      const text = Array.isArray(payload)
        ? payload.map((item) => item?.generated_text || "").join("\n")
        : summarizeUnknown(payload);
      return { text: text.trim(), raw: payload };
    },

    async generateImage(prompt) {
      const config = ensureConfigured(providerId, "image generation");
      if (!config.imageModel) {
        throw new Error(`${providerId} image generation is not configured yet.`);
      }
      const response = await withTimeout(fetch(
        `https://router.huggingface.co/hf-inference/models/${config.imageModel}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ inputs: prompt }),
        },
      ), `${providerId} generateImage`);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status} ${text}`);
      }
      const blob = await response.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      return { dataUrl, raw: { size: blob.size, type: blob.type } };
    },

    async transformImage(payload) {
      const config = ensureConfigured(providerId, "image-to-image transformation");
      const inputImage = payload?.imageDataUrl || "";
      const prompt = String(payload?.prompt || "").trim();
      if (!inputImage) {
        throw new Error(`${providerId} image-to-image transformation requires an input image.`);
      }
      const modelId = config.imageTransformModel || config.imageModel;
      if (!modelId) {
        throw new Error(`${providerId} image-to-image transformation is not configured yet.`);
      }
      const { InferenceClient } = await getHFInferenceModule();
      const client = new InferenceClient(config.apiKey);
      const blob = await withTimeout(client.imageToImage({
        provider: "fal-ai",
        model: modelId,
        inputs: await (await fetch(inputImage)).blob(),
        parameters: {
          prompt,
          negative_prompt: payload?.negativePrompt || "do not alter layout, do not move elements, do not distort shapes, no warped text, no broken alignment, no extra objects",
          guidance_scale: Number(payload?.guidanceScale) || 5,
          num_inference_steps: Number(payload?.numInferenceSteps) || 28,
        },
      }), `${providerId} transformImage`);
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      return {
        dataUrl,
        raw: { size: blob.size, type: blob.type, mode: "image-to-image", modelId, provider: "fal-ai" },
      };
    },

    async removeBackground() {
      throw new Error(`${providerId} background analysis is not configured yet.`);
    },

    async detectSeason(prompt, options = {}) {
      return this.generateText(prompt, options);
    },
  };
}

function createDirectProvider(providerId) {
  if (providerId === "openrouter") {
    return buildOpenRouter(providerId);
  }
  if (providerId === "groq") {
    return buildChatOnlyProvider(
      providerId,
      () => "https://api.groq.com/openai/v1/chat/completions",
      (config, prompt) => ({
        model: config.textModel,
        messages: [{ role: "user", content: prompt }],
      }),
      (config) => ({ Authorization: `Bearer ${config.apiKey}` }),
    );
  }
  if (providerId === "mistral") {
    return buildChatOnlyProvider(
      providerId,
      () => "https://api.mistral.ai/v1/chat/completions",
      (config, prompt) => ({
        model: config.textModel,
        messages: [{ role: "user", content: prompt }],
      }),
      (config) => ({ Authorization: `Bearer ${config.apiKey}` }),
    );
  }
  if (providerId === "huggingface") {
    return buildHuggingFace(providerId);
  }
  if (providerId === "deepseek") {
    return buildChatOnlyProvider(
      providerId,
      () => "https://api.deepseek.com/chat/completions",
      (config, prompt) => ({
        model: config.textModel,
        messages: [{ role: "user", content: prompt }],
      }),
      (config) => ({ Authorization: `Bearer ${config.apiKey}` }),
    );
  }

  throw new Error(`Unsupported provider: ${providerId}`);
}

function createProxyFirstProvider(providerId) {
  const directProvider = createDirectProvider(providerId);

  async function run(functionName, payload, options = {}) {
    try {
      return await withTimeout(
        tryProxy(providerId, functionName, payload, options),
        `${providerId} ${functionName} proxy`,
      );
    } catch (error) {
      if (error?.code !== "PROXY_UNAVAILABLE") {
        throw error;
      }
      const directTarget = directProvider[functionName];
      return directTarget.call(directProvider, payload, options);
    }
  }

  return {
    id: providerId,
    async generateText(prompt, options = {}) {
      return run("generateText", prompt, options);
    },
    async generateImage(prompt, options = {}) {
      return run("generateImage", prompt, options);
    },
    async transformImage(payload, options = {}) {
      return run("transformImage", payload, options);
    },
    async removeBackground(payload, options = {}) {
      return run("removeBackground", payload, options);
    },
    async detectSeason(prompt, options = {}) {
      return run("detectSeason", prompt, options);
    },
  };
}

export function createProviderModule(providerId) {
  return createProxyFirstProvider(providerId);
}
