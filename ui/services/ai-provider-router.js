import deepseek from "../ai-providers/deepseek.js";
import groq from "../ai-providers/groq.js";
import huggingface from "../ai-providers/huggingface.js";
import mistral from "../ai-providers/mistral.js";
import openrouter from "../ai-providers/openrouter.js";

const providers = {
  openrouter,
  groq,
  mistral,
  huggingface,
  deepseek,
};

let runtime = {
  appendLog: async () => {},
  saveDebug: async () => {},
  onDebug: () => {},
};

function nowMs() {
  if (typeof globalThis.performance?.now === "function") {
    return globalThis.performance.now();
  }
  return Date.now();
}

export function configureAIProviderRuntime(overrides = {}) {
  runtime = {
    ...runtime,
    ...overrides,
  };
}

function summarizeResponse(response) {
  if (!response) return "";
  if (typeof response === "string") return response.slice(0, 500);
  if (typeof response?.text === "string") return response.text.slice(0, 500);
  if (typeof response?.dataUrl === "string") return response.dataUrl ? "[image-data-url]" : "";
  if (typeof response?.message === "string") return response.message.slice(0, 500);
  if (typeof response?.error === "string") return response.error.slice(0, 500);
  try {
    return JSON.stringify(response).slice(0, 500);
  } catch {
    return String(response).slice(0, 500);
  }
}

function extractErrorMessage(error) {
  if (!error) return "Unknown provider error.";
  if (typeof error === "string") return error;
  if (typeof error?.message === "string") return error.message;
  if (typeof error?.error === "string") return error.error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function getProviderModule(providerId) {
  const provider = providers[providerId];
  if (!provider) {
    throw new Error(`Unsupported AI provider: ${providerId}`);
  }
  return provider;
}

export async function callSpecificAIProvider(providerId, functionName, ...args) {
  const startedAt = nowMs();
  const module = getProviderModule(providerId);
  const target = module?.[functionName];
  if (typeof target !== "function") {
    throw new Error(`AI provider "${providerId}" does not implement ${functionName}().`);
  }

  try {
    const response = await target.call(module, ...args);
    const requestTimeMs = Math.round(nowMs() - startedAt);
    const debug = {
      providerId,
      lastFunction: functionName,
      lastStatus: "success",
      lastApiResponse: summarizeResponse(response),
      requestTimeMs,
      updatedAt: new Date().toISOString(),
    };
    await runtime.appendLog(`${debug.updatedAt} | provider=${providerId} | fn=${functionName} | status=success | ms=${requestTimeMs}`);
    await runtime.saveDebug(debug);
    runtime.onDebug(debug);
    return response;
  } catch (error) {
    const requestTimeMs = Math.round(nowMs() - startedAt);
    const message = extractErrorMessage(error);
    const debug = {
      providerId,
      lastFunction: functionName,
      lastStatus: "failure",
      lastApiResponse: message,
      requestTimeMs,
      updatedAt: new Date().toISOString(),
    };
    await runtime.appendLog(`${debug.updatedAt} | provider=${providerId} | fn=${functionName} | status=failure | ms=${requestTimeMs} | error=${message}`);
    await runtime.saveDebug(debug);
    runtime.onDebug(debug);
    throw new Error(message);
  }
}
