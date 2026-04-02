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

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(payload),
  };
}

function parseEnvSecrets() {
  const raw = process.env.AI_PROVIDER_KEYS_JSON || "{}";
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function getProviderConfig(providerId) {
  const secrets = parseEnvSecrets();
  return {
    apiKey: secrets?.[providerId]?.apiKey || "",
    ...(AUTO_MODELS[providerId] || {}),
  };
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
    hfInferenceModulePromise = import("@huggingface/inference");
  }
  return hfInferenceModulePromise;
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

function ensureConfigured(providerId, capability) {
  const config = getProviderConfig(providerId);
  if (!config.apiKey) {
    throw new Error(`${providerId} is not configured for ${capability}. Set it in AI_PROVIDER_KEYS_JSON.`);
  }
  return config;
}

async function openrouterGenerateText(prompt, options = {}) {
  const config = ensureConfigured("openrouter", "text generation");
  const mediaDataUrl = mediaDataUrlFromOptions(options);
  const payload = await postJson(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: config.textModel,
      messages: [{
        role: "user",
        content: mediaDataUrl ? buildImageContentParts(prompt, mediaDataUrl) : prompt,
      }],
    },
    {
      Authorization: `Bearer ${config.apiKey}`,
    },
  );
  return {
    text: extractText(payload).trim(),
    raw: payload,
  };
}

async function openrouterGenerateImage(prompt) {
  const config = ensureConfigured("openrouter", "image generation");
  if (!config.imageModel) {
    throw new Error("openrouter image generation is not configured.");
  }
  const payload = await postJson(
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
  );
  const dataUrl = extractOpenRouterImageDataUrl(payload);
  if (!dataUrl) {
    throw new Error("No image returned by openrouter.");
  }
  return { dataUrl, raw: payload };
}

async function openrouterTransformImage(payload) {
  const config = ensureConfigured("openrouter", "image-to-image transformation");
  const imageDataUrl = String(payload?.imageDataUrl || "").trim();
  const prompt = String(payload?.prompt || "").trim();
  const modelId = config.imageTransformModel || config.imageModel;
  if (!imageDataUrl) {
    throw new Error("openrouter image-to-image transformation requires an input image.");
  }
  if (!modelId) {
    throw new Error("openrouter image-to-image transformation is not configured.");
  }
  const response = await postJson(
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
  );
  const dataUrl = extractOpenRouterImageDataUrl(response);
  if (!dataUrl) {
    throw new Error("No edited image returned by openrouter.");
  }
  return {
    dataUrl,
    raw: { mode: "image-to-image", modelId, provider: "openrouter" },
  };
}

async function chatProviderText(providerId, url) {
  const config = ensureConfigured(providerId, "text generation");
  return async (prompt, options = {}) => {
    if (options?.media) {
      throw new Error(`${providerId} does not support image-assisted text generation.`);
    }
    const payload = await postJson(
      url,
      {
        model: config.textModel,
        messages: [{ role: "user", content: prompt }],
      },
      {
        Authorization: `Bearer ${config.apiKey}`,
      },
    );
    return {
      text: extractText(payload).trim(),
      raw: payload,
    };
  };
}

async function huggingFaceGenerateText(prompt, options = {}) {
  if (options?.media) {
    throw new Error("huggingface does not support image-assisted text generation in this review path.");
  }
  const config = ensureConfigured("huggingface", "text generation");
  const payload = await postJson(
    `https://router.huggingface.co/hf-inference/models/${config.textModel}`,
    {
      inputs: prompt,
    },
    {
      Authorization: `Bearer ${config.apiKey}`,
    },
  );
  const text = Array.isArray(payload)
    ? payload.map((item) => item?.generated_text || "").join("\n")
    : summarizeUnknown(payload);
  return { text: text.trim(), raw: payload };
}

async function huggingFaceGenerateImage(prompt) {
  const config = ensureConfigured("huggingface", "image generation");
  if (!config.imageModel) {
    throw new Error("huggingface image generation is not configured.");
  }
  const response = await fetch(`https://router.huggingface.co/hf-inference/models/${config.imageModel}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ inputs: prompt }),
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    dataUrl: `data:${response.headers.get("content-type") || "image/png"};base64,${buffer.toString("base64")}`,
    raw: { size: buffer.length, type: response.headers.get("content-type") || "image/png" },
  };
}

async function huggingFaceTransformImage(payload) {
  const config = ensureConfigured("huggingface", "image-to-image transformation");
  const inputImage = payload?.imageDataUrl || "";
  const prompt = String(payload?.prompt || "").trim();
  if (!inputImage) {
    throw new Error("huggingface image-to-image transformation requires an input image.");
  }
  const modelId = config.imageTransformModel || config.imageModel;
  if (!modelId) {
    throw new Error("huggingface image-to-image transformation is not configured.");
  }
  const { InferenceClient } = await getHFInferenceModule();
  const client = new InferenceClient(config.apiKey);
  const response = await client.imageToImage({
    provider: "fal-ai",
    model: modelId,
    inputs: await (await fetch(inputImage)).blob(),
    parameters: {
      prompt,
      negative_prompt: payload?.negativePrompt || "do not alter layout, do not move elements, do not distort shapes, no warped text, no broken alignment, no extra objects",
      guidance_scale: Number(payload?.guidanceScale) || 5,
      num_inference_steps: Number(payload?.numInferenceSteps) || 28,
    },
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    dataUrl: `data:${response.type || "image/png"};base64,${buffer.toString("base64")}`,
    raw: { size: buffer.length, type: response.type || "image/png", mode: "image-to-image", modelId, provider: "fal-ai" },
  };
}

async function dispatch(providerId, functionName, payload, options = {}) {
  if (providerId === "openrouter") {
    if (functionName === "generateText" || functionName === "detectSeason") return openrouterGenerateText(payload, options);
    if (functionName === "generateImage") return openrouterGenerateImage(payload);
    if (functionName === "transformImage") return openrouterTransformImage(payload);
  }

  if (providerId === "groq") {
    const fn = await chatProviderText("groq", "https://api.groq.com/openai/v1/chat/completions");
    if (functionName === "generateText" || functionName === "detectSeason") return fn(payload, options);
  }

  if (providerId === "mistral") {
    const fn = await chatProviderText("mistral", "https://api.mistral.ai/v1/chat/completions");
    if (functionName === "generateText" || functionName === "detectSeason") return fn(payload, options);
  }

  if (providerId === "deepseek") {
    const fn = await chatProviderText("deepseek", "https://api.deepseek.com/chat/completions");
    if (functionName === "generateText" || functionName === "detectSeason") return fn(payload, options);
  }

  if (providerId === "huggingface") {
    if (functionName === "generateText" || functionName === "detectSeason") return huggingFaceGenerateText(payload, options);
    if (functionName === "generateImage") return huggingFaceGenerateImage(payload);
    if (functionName === "transformImage") return huggingFaceTransformImage(payload);
  }

  if (functionName === "removeBackground") {
    throw new Error(`${providerId} background analysis is not configured yet.`);
  }

  if (functionName === "generateImage") {
    throw new Error(`${providerId} image generation is not configured yet.`);
  }

  if (functionName === "transformImage") {
    throw new Error(`${providerId} image-to-image transformation is not configured yet.`);
  }

  throw new Error(`Unsupported provider/function combination: ${providerId}.${functionName}`);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Method not allowed." });
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const providerId = body.providerId;
    const functionName = body.functionName;
    const payload = body.payload;
    const options = body.options || {};

    if (!providerId || !functionName) {
      return json(400, { ok: false, error: "providerId and functionName are required." });
    }

    const result = await dispatch(providerId, functionName, payload, options);
    return json(200, { ok: true, result });
  } catch (error) {
    return json(500, {
      ok: false,
      error: error.message || String(error),
    });
  }
};
