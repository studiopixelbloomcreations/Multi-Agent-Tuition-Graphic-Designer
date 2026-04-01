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

    async generateText(prompt) {
      const config = ensureConfigured(providerId, "text generation");
      const payload = await withTimeout(postJson(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: config.textModel,
          messages: [{ role: "user", content: prompt }],
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
        "https://openrouter.ai/api/v1/images/generations",
        {
          model: config.imageModel,
          prompt,
          size: "1024x1024",
        },
        {
          Authorization: `Bearer ${config.apiKey}`,
        },
      ), `${providerId} generateImage`);

      const dataUrl = payload?.data?.[0]?.b64_json
        ? `data:image/png;base64,${payload.data[0].b64_json}`
        : payload?.data?.[0]?.url || "";
      if (!dataUrl) {
        throw new Error(`No image returned by ${providerId}.`);
      }
      return { dataUrl, raw: payload };
    },

    async removeBackground() {
      throw new Error(`${providerId} background analysis is not configured yet.`);
    },

    async detectSeason(prompt) {
      return this.generateText(prompt);
    },
  };
}

function buildChatOnlyProvider(providerId, urlBuilder, bodyBuilder, headersBuilder = () => ({}), extract = extractText) {
  return {
    id: providerId,

    async generateText(prompt) {
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

    async removeBackground() {
      throw new Error(`${providerId} background analysis is not configured yet.`);
    },

    async detectSeason(prompt) {
      return this.generateText(prompt);
    },
  };
}

function buildHuggingFace(providerId) {
  return {
    id: providerId,

    async generateText(prompt) {
      const config = ensureConfigured(providerId, "text generation");
      const payload = await withTimeout(postJson(
        `https://api-inference.huggingface.co/models/${config.textModel}`,
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
        `https://api-inference.huggingface.co/models/${config.imageModel}`,
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

    async removeBackground() {
      throw new Error(`${providerId} background analysis is not configured yet.`);
    },

    async detectSeason(prompt) {
      return this.generateText(prompt);
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
