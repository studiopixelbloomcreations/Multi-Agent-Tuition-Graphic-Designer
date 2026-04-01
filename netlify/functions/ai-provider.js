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

async function openrouterGenerateText(prompt) {
  const config = ensureConfigured("openrouter", "text generation");
  const payload = await postJson(
    "https://openrouter.ai/api/v1/chat/completions",
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
}

async function openrouterGenerateImage(prompt) {
  const config = ensureConfigured("openrouter", "image generation");
  if (!config.imageModel) {
    throw new Error("openrouter image generation is not configured.");
  }
  const payload = await postJson(
    "https://openrouter.ai/api/v1/images/generations",
    {
      model: config.imageModel,
      prompt,
      size: "1024x1024",
    },
    {
      Authorization: `Bearer ${config.apiKey}`,
    },
  );
  const dataUrl = payload?.data?.[0]?.b64_json
    ? `data:image/png;base64,${payload.data[0].b64_json}`
    : payload?.data?.[0]?.url || "";
  if (!dataUrl) {
    throw new Error("No image returned by openrouter.");
  }
  return { dataUrl, raw: payload };
}

async function chatProviderText(providerId, url) {
  const config = ensureConfigured(providerId, "text generation");
  return async (prompt) => {
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

async function huggingFaceGenerateText(prompt) {
  const config = ensureConfigured("huggingface", "text generation");
  const payload = await postJson(
    `https://api-inference.huggingface.co/models/${config.textModel}`,
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
  const response = await fetch(`https://api-inference.huggingface.co/models/${config.imageModel}`, {
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

async function dispatch(providerId, functionName, payload) {
  if (providerId === "openrouter") {
    if (functionName === "generateText" || functionName === "detectSeason") return openrouterGenerateText(payload);
    if (functionName === "generateImage") return openrouterGenerateImage(payload);
  }

  if (providerId === "groq") {
    const fn = await chatProviderText("groq", "https://api.groq.com/openai/v1/chat/completions");
    if (functionName === "generateText" || functionName === "detectSeason") return fn(payload);
  }

  if (providerId === "mistral") {
    const fn = await chatProviderText("mistral", "https://api.mistral.ai/v1/chat/completions");
    if (functionName === "generateText" || functionName === "detectSeason") return fn(payload);
  }

  if (providerId === "deepseek") {
    const fn = await chatProviderText("deepseek", "https://api.deepseek.com/chat/completions");
    if (functionName === "generateText" || functionName === "detectSeason") return fn(payload);
  }

  if (providerId === "huggingface") {
    if (functionName === "generateText" || functionName === "detectSeason") return huggingFaceGenerateText(payload);
    if (functionName === "generateImage") return huggingFaceGenerateImage(payload);
  }

  if (functionName === "removeBackground") {
    throw new Error(`${providerId} background analysis is not configured yet.`);
  }

  if (functionName === "generateImage") {
    throw new Error(`${providerId} image generation is not configured yet.`);
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

    if (!providerId || !functionName) {
      return json(400, { ok: false, error: "providerId and functionName are required." });
    }

    const result = await dispatch(providerId, functionName, payload);
    return json(200, { ok: true, result });
  } catch (error) {
    return json(500, {
      ok: false,
      error: error.message || String(error),
    });
  }
};
