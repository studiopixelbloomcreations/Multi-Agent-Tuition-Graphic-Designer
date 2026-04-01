import { GRAPHICS } from "./config.js";
import { createBrowserBridge } from "./services/browser-bridge.js";
import { configureAIProviderRuntime } from "./services/ai-provider-router.js";
import { configureAIOrchestratorRuntime } from "./ai-orchestrator/orchestrator.js";
import { generateAllGraphics, generateGraphicWithQualityLoop, processAllGraphics, refreshSeasonState } from "./services/graphics-pipeline.js";

const state = {
  season: "Default",
  seasonReasoning: "Waiting for AI season detection.",
  assets: {},
  inspirationAssets: [],
  graphicInspirationAssets: {},
  bridge: null,
  testingMode: true,
  seasonRefreshMinutes: 30,
  seasonTimerId: null,
  runtimeMode: "obs",
  outputDirectoryName: "",
  promptMap: {},
  activityFeed: [],
  activeGraphicId: "",
  isBatchGenerating: false,
  lastActivityMessage: "",
  errorMessage: "",
  openPromptId: "",
  providerDebug: {
    providerId: "",
    lastFunction: "none",
    lastStatus: "idle",
    lastApiResponse: "",
    requestTimeMs: 0,
    updatedAt: "",
    orchestratorTask: "",
    currentFlow: "",
    lastOrchestratorAgent: "",
  },
  aiTeamStatus: {
    taskType: "",
    flow: [],
    currentAgent: "",
    status: "idle",
    updatedAt: "",
  },
};

const seasonValue = document.querySelector("#seasonValue");
const seasonReasoning = document.querySelector("#seasonReasoning");
const statusDot = document.querySelector("#statusDot");
const statusText = document.querySelector("#statusText");
const teamFlow = document.querySelector("#teamFlow");
const errorBanner = document.querySelector("#errorBanner");
const logBox = document.querySelector("#logBox");
const activityNow = document.querySelector("#activityNow");
const activityFeed = document.querySelector("#activityFeed");
const promptStatus = document.querySelector("#promptStatus");
const promptList = document.querySelector("#promptList");
const previewGrid = document.querySelector("#previewGrid");
const previewCardTemplate = document.querySelector("#previewCardTemplate");
const testingModeToggle = document.querySelector("#testingModeToggle");
const seasonRefreshSelect = document.querySelector("#seasonRefreshSelect");
const modeBadge = document.querySelector("#modeBadge");
const runtimeBadge = document.querySelector("#runtimeBadge");
const chooseOutputBtn = document.querySelector("#chooseOutputBtn");
const generateBtn = document.querySelector("#generateBtn");
const processBackgroundsBtn = document.querySelector("#processBackgroundsBtn");
const debugProvider = document.querySelector("#debugProvider");
const debugFunction = document.querySelector("#debugFunction");
const debugStatus = document.querySelector("#debugStatus");
const debugTime = document.querySelector("#debugTime");
const debugResponse = document.querySelector("#debugResponse");

function appendLog(message) {
  const stamp = new Date().toLocaleTimeString();
  logBox.textContent = `[${stamp}] ${message}\n${logBox.textContent}`.trim();
}

function setError(message = "") {
  state.errorMessage = message;
  errorBanner.hidden = !message;
  errorBanner.textContent = message;
}

function pushActivity(message) {
  if (!message || state.lastActivityMessage === message) {
    return;
  }
  state.lastActivityMessage = message;
  state.activityFeed.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    message,
  });
  state.activityFeed = state.activityFeed.slice(0, 14);
  renderActivity();
}

function renderActivity() {
  activityNow.textContent = state.activeGraphicId
    ? `Generating ${GRAPHICS.find((g) => g.id === state.activeGraphicId)?.label || "graphic"}...`
    : (state.isBatchGenerating ? "Generation in progress..." : "No generation running.");

  activityFeed.innerHTML = "";
  for (const item of state.activityFeed) {
    const row = document.createElement("div");
    row.className = "activity-item";
    row.textContent = item.message;
    activityFeed.appendChild(row);
  }
}

function setStatus(message, live = false) {
  statusText.textContent = message;
  statusDot.classList.toggle("live", live);
}

function setButtonLoading(button, loading) {
  button.classList.toggle("is-loading", loading);
}

function graphicNotes(asset) {
  if (!asset?.savedAt) return "Waiting for generation";
  const parts = [
    new Date(asset.savedAt).toLocaleString(),
    `v${asset.version || 1}`,
    `attempt ${asset.generationAttempt || 1}`,
    typeof asset.reviewScore === "number" ? `score ${asset.reviewScore}` : null,
    asset.backgroundRemoved ? "background removed" : "raw only",
    asset.processingNotes || null,
    asset.qualityNotes || null,
  ].filter(Boolean);
  return parts.join(" | ");
}

function unwrapPayload(response) {
  return response?.payload || {};
}

function applyRuntimeUi() {
  testingModeToggle.checked = state.testingMode;
  seasonRefreshSelect.value = String(state.seasonRefreshMinutes);
  modeBadge.textContent = state.testingMode ? "Testing Mode: Static Generation Only" : "Production Generation Enabled";
  const outputName = state.outputDirectoryName || "No output folder selected";
  runtimeBadge.textContent = state.runtimeMode === "browser" ? `Browser Local Test Mode | ${outputName}` : "OBS Plugin Mode";
  promptStatus.textContent = Object.keys(state.promptMap).length ? "Prompt System Active" : "Waiting";
  teamFlow.textContent = state.aiTeamStatus.flow?.length ? state.aiTeamStatus.flow.join(" -> ") : "Idle";
  debugProvider.textContent = state.aiTeamStatus.currentAgent || state.providerDebug.providerId || "none";
  debugFunction.textContent = state.providerDebug.orchestratorTask || state.providerDebug.lastFunction || "none";
  debugStatus.textContent = state.providerDebug.lastStatus || "idle";
  debugTime.textContent = `${state.providerDebug.requestTimeMs || 0} ms`;
  debugResponse.textContent = state.providerDebug.lastApiResponse || "No provider response yet.";
}

function scheduleSeasonRefresh() {
  if (state.seasonTimerId) {
    clearInterval(state.seasonTimerId);
  }

  state.seasonTimerId = window.setInterval(async () => {
    try {
      pushActivity("Running scheduled season refresh.");
      await refreshSeasonState(state, appendLog, handlePipelineEvent);
      renderState();
    } catch (error) {
      appendLog(`Scheduled season refresh failed: ${error.message || String(error)}`);
      setError(`Season refresh failed: ${error.message || String(error)}`);
    }
  }, state.seasonRefreshMinutes * 60 * 1000);
}

function renderPrompts() {
  promptList.innerHTML = "";
  for (const graphic of GRAPHICS) {
    const promptValue = state.promptMap[graphic.id] || state.assets[graphic.id]?.prompt || "Waiting for prompt generation.";
    const details = document.createElement("details");
    details.className = "prompt-item";
    details.open = state.openPromptId === graphic.id;
    details.addEventListener("toggle", () => {
      state.openPromptId = details.open ? graphic.id : (state.openPromptId === graphic.id ? "" : state.openPromptId);
    });

    const summary = document.createElement("summary");
    const title = document.createElement("h3");
    title.textContent = graphic.label;
    const meta = document.createElement("span");
    meta.className = "prompt-folder-meta";
    meta.textContent = promptValue.startsWith("Waiting") ? "Folder empty" : "Open category";
    summary.append(title, meta);

    const body = document.createElement("p");
    body.textContent = promptValue;
    details.append(summary, body);
    promptList.appendChild(details);
  }
}

function renderState() {
  seasonValue.textContent = state.season;
  seasonReasoning.textContent = state.seasonReasoning;
  applyRuntimeUi();
  renderPrompts();
  renderActivity();
  renderPreviews();
}

function hydrateFromManifest(manifest) {
  state.season = manifest.season || "Default";
  state.seasonReasoning = manifest.seasonReasoning || "Waiting for AI season detection.";
  state.testingMode = manifest.testingMode ?? true;
  state.seasonRefreshMinutes = manifest.seasonRefreshMinutes || 30;
  state.outputDirectoryName = manifest.outputDirectoryName || "";
  state.assets = manifest.assets || {};
  for (const graphic of GRAPHICS) {
    const prompt = state.assets[graphic.id]?.prompt;
    if (prompt) {
      state.promptMap[graphic.id] = prompt;
    }
  }
  renderState();
}

function referenceMetaFor(graphicId) {
  const assets = state.graphicInspirationAssets[graphicId] || [];
  if (!assets.length) return "No reference uploaded";
  if (assets.length === 1) return assets[0].name || "1 reference uploaded";
  return `${assets.length} references uploaded`;
}

async function hydrateProviderState() {
  if (typeof state.bridge.loadAIProviderDebug === "function") {
    state.providerDebug = {
      ...state.providerDebug,
      ...(await state.bridge.loadAIProviderDebug()),
    };
  }
  if (typeof state.bridge.loadAITeamStatus === "function") {
    state.aiTeamStatus = {
      ...state.aiTeamStatus,
      ...(await state.bridge.loadAITeamStatus()),
    };
  }
}

function renderPreviews() {
  previewGrid.innerHTML = "";
  for (const graphic of GRAPHICS) {
    const asset = state.assets[graphic.id];
    const hasGraphic = Boolean(asset?.savedAt && (asset?.dataUrl || asset?.path));
    const isActive = state.activeGraphicId === graphic.id;
    const node = previewCardTemplate.content.firstElementChild.cloneNode(true);
    const media = node.querySelector(".preview-media");
    const actionButton = node.querySelector(".regenerate-btn");
    const loadingText = node.querySelector(".card-loading");
    const compareStrip = node.querySelector(".compare-strip");
    const compareBefore = node.querySelector(".compare-before");
    const compareAfter = node.querySelector(".compare-after");
    const referenceInput = node.querySelector(".reference-input");
    const referenceMeta = node.querySelector(".reference-meta");

    node.querySelector(".preview-title").textContent = graphic.label;
    if (hasGraphic) {
      media.src = asset.dataUrl || `file:///${asset.path.replaceAll("\\", "/")}?t=${Date.now()}`;
      media.classList.remove("is-empty");
    } else {
      media.removeAttribute("src");
      media.classList.add("is-empty");
    }

    media.alt = graphic.label;
    node.querySelector(".preview-meta").textContent = graphicNotes(asset);

    const showCompare = Boolean(asset?.rawDataUrl && asset?.dataUrl && asset.rawDataUrl !== asset.dataUrl);
    compareStrip.hidden = !showCompare;
    if (showCompare) {
      compareBefore.src = asset.rawDataUrl;
      compareBefore.alt = `${graphic.label} raw`;
      compareAfter.src = asset.dataUrl;
      compareAfter.alt = `${graphic.label} processed`;
    } else {
      compareBefore.removeAttribute("src");
      compareAfter.removeAttribute("src");
    }

    const toggle = node.querySelector(".visible-toggle");
    toggle.checked = asset?.visible ?? true;
    toggle.addEventListener("change", async () => {
      const result = await state.bridge.setGraphicVisibility(graphic.id, toggle.checked);
      if (!result.ok) {
        appendLog(result.message);
      }
    });

    actionButton.textContent = hasGraphic ? "Regenerate" : "Generate";
    referenceMeta.textContent = referenceMetaFor(graphic.id);
    referenceInput.addEventListener("change", async (event) => {
      if (!event.target.files?.length) return;
      try {
        setError("");
        await handleGraphicReferenceFiles(graphic.id, event.target.files);
        renderPreviews();
      } catch (error) {
        appendLog(`Failed to load ${graphic.label} reference: ${error.message || String(error)}`);
        setError(`Failed to load ${graphic.label} reference: ${error.message || String(error)}`);
      }
    });
    setButtonLoading(actionButton, isActive);
    loadingText.hidden = !isActive;
    actionButton.addEventListener("click", async () => {
      try {
        setError("");
        state.activeGraphicId = graphic.id;
        renderPreviews();
        setStatus(`${hasGraphic ? "Regenerating" : "Generating"} ${graphic.label}`, true);
        pushActivity(`Assigning ${graphic.label} to the AI team.`);
        const result = await generateGraphicWithQualityLoop(graphic, state, appendLog, handlePipelineEvent);
        hydrateFromManifest(unwrapPayload(result));
        appendLog(`${graphic.label} finished generating and was saved successfully.`);
        setStatus(`${graphic.label} ready`, true);
      } catch (error) {
        setStatus("Generation failed");
        appendLog(error.message || String(error));
        setError(`Generation failed for ${graphic.label}: ${error.message || String(error)}`);
      } finally {
        state.activeGraphicId = "";
        renderPreviews();
      }
    });

    previewGrid.appendChild(node);
  }
}

function handlePipelineEvent(event) {
  if (!event) return;

  if (event.graphicId) {
    state.activeGraphicId = event.graphicId;
  }

  if (event.kind === "prompt_done" && event.prompt) {
    state.promptMap[event.graphicId] = event.prompt;
    if (!state.openPromptId) {
      state.openPromptId = event.graphicId;
    }
  }

  if (event.message) {
    pushActivity(event.message);
  }

  renderState();
}

function handleProviderDebug(debug) {
  state.providerDebug = {
    ...state.providerDebug,
    ...debug,
  };
  renderState();
}

function handleTeamFlow(update) {
  if (!update) return;
  state.aiTeamStatus = {
    ...state.aiTeamStatus,
    taskType: update.taskType || state.aiTeamStatus.taskType,
    flow: update.currentFlow || state.aiTeamStatus.flow,
    currentAgent: update.currentAgent || (update.currentFlow?.length ? update.currentFlow[update.currentFlow.length - 1] : state.aiTeamStatus.currentAgent),
    status: update.status || state.aiTeamStatus.status,
    updatedAt: new Date().toISOString(),
  };
  if (update.message) {
    pushActivity(update.message);
  }
  renderState();
}

async function persistRuntimeConfig() {
  const result = await state.bridge.saveRuntimeConfig(state.testingMode, state.seasonRefreshMinutes);
  if (result.ok) {
    hydrateFromManifest(unwrapPayload(result));
    scheduleSeasonRefresh();
  } else {
    appendLog(result.message);
  }
}

async function filesToAssets(files) {
  const assets = await Promise.all(
    [...files].map((file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({
        name: file.name,
        path: file.name,
        url: "",
        file,
        dataUrl: String(reader.result || ""),
      });
      reader.onerror = reject;
      reader.readAsDataURL(file);
    })),
  );
  return assets;
}

async function handleGraphicReferenceFiles(graphicId, files) {
  const assets = await filesToAssets(files);
  state.graphicInspirationAssets = {
    ...state.graphicInspirationAssets,
    [graphicId]: assets,
  };
  if (typeof state.bridge.setGraphicInspirationAssets === "function") {
    await state.bridge.setGraphicInspirationAssets(graphicId, assets);
  }
  const label = GRAPHICS.find((graphic) => graphic.id === graphicId)?.label || graphicId;
  appendLog(`Loaded ${assets.length} reference file(s) for ${label}.`);
  pushActivity(`Loaded ${assets.length} reference file(s) for ${label}.`);
}

function bindUi() {
  generateBtn.addEventListener("click", async () => {
    try {
      setError("");
      state.isBatchGenerating = true;
      state.activeGraphicId = "";
      setButtonLoading(generateBtn, true);
      renderState();
      setStatus("Generating graphics", true);
      pushActivity("Starting full AI team graphics generation pipeline.");
      await generateAllGraphics(
        state,
        appendLog,
        async (graphic, response) => {
          hydrateFromManifest(unwrapPayload(response));
          appendLog(`${graphic.label} finished generating and was saved successfully.`);
          setStatus(`${graphic.label} ready`, true);
        },
        handlePipelineEvent,
      );
      const response = await state.bridge.loadState();
      hydrateFromManifest(unwrapPayload(response));
      appendLog("All graphics generated and saved successfully.");
      pushActivity("Full graphics generation pipeline completed.");
      setStatus("Generation complete", true);
    } catch (error) {
      setStatus("Generation failed");
      appendLog(error.message || String(error));
      pushActivity(`Generation failed: ${error.message || String(error)}`);
      setError(`Batch generation failed: ${error.message || String(error)}`);
    } finally {
      state.isBatchGenerating = false;
      state.activeGraphicId = "";
      setButtonLoading(generateBtn, false);
      renderState();
    }
  });

  document.querySelector("#applyBtn").addEventListener("click", async () => {
    try {
      setStatus("Applying to scene", true);
      const result = await state.bridge.applyToScene();
      appendLog(result.message);
      pushActivity(result.message);
      setStatus(result.ok ? "Apply step completed" : "Apply failed", result.ok);
    } catch (error) {
      setStatus("Apply failed");
      appendLog(error.message || String(error));
      setError(`Apply failed: ${error.message || String(error)}`);
    }
  });

  document.querySelector("#refreshSeasonBtn").addEventListener("click", async () => {
    try {
      setError("");
      setStatus("Detecting season", true);
      pushActivity("Running season detection with the AI team.");
      await refreshSeasonState(state, appendLog, handlePipelineEvent);
      renderState();
      setStatus("Season refreshed", true);
    } catch (error) {
      setStatus("Season refresh failed");
      appendLog(error.message || String(error));
      setError(`Season refresh failed: ${error.message || String(error)}`);
    }
  });

  processBackgroundsBtn.addEventListener("click", async () => {
    try {
      setError("");
      setButtonLoading(processBackgroundsBtn, true);
      setStatus("Processing backgrounds", true);
      pushActivity("Processing backgrounds with the AI team.");
      await processAllGraphics(
        state,
        appendLog,
        async (_graphic, response) => {
          hydrateFromManifest(unwrapPayload(response));
        },
        handlePipelineEvent,
      );
      const response = await state.bridge.loadState();
      hydrateFromManifest(unwrapPayload(response));
      pushActivity("Background processing completed for available graphics.");
      appendLog("Background processing completed.");
      setStatus("Background processing complete", true);
    } catch (error) {
      setStatus("Background processing failed");
      appendLog(error.message || String(error));
      setError(`Background processing failed: ${error.message || String(error)}`);
    } finally {
      setButtonLoading(processBackgroundsBtn, false);
      renderState();
    }
  });

  document.querySelector("#reloadBtn").addEventListener("click", async () => {
    try {
      const response = await state.bridge.loadState();
      hydrateFromManifest(unwrapPayload(response));
      appendLog("Loaded saved graphics manifest.");
      pushActivity("Reloaded saved graphics state.");
      setStatus("Ready", true);
    } catch (error) {
      setStatus("Reload failed");
      appendLog(error.message || String(error));
      setError(`Reload failed: ${error.message || String(error)}`);
    }
  });

  testingModeToggle.addEventListener("change", async () => {
    state.testingMode = testingModeToggle.checked;
    await persistRuntimeConfig();
  });

  seasonRefreshSelect.addEventListener("change", async () => {
    state.seasonRefreshMinutes = Number(seasonRefreshSelect.value);
    await persistRuntimeConfig();
  });

  chooseOutputBtn.addEventListener("click", async () => {
    if (typeof state.bridge.chooseOutputDirectory !== "function") {
      appendLog("Output folder picking is only available in browser mode.");
      return;
    }

    try {
      setError("");
      const result = await state.bridge.chooseOutputDirectory();
      if (result.payload) {
        hydrateFromManifest(unwrapPayload(result));
      }
      appendLog(result.message);
      pushActivity(result.message);
    } catch (error) {
      appendLog(`Output folder selection failed: ${error.message || String(error)}`);
      setError(`Output folder selection failed: ${error.message || String(error)}`);
    }
  });

}

function loadQWebChannelScript() {
  return new Promise((resolve, reject) => {
    if (typeof QWebChannel !== "undefined") {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "qrc:///qtwebchannel/qwebchannel.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load OBS QWebChannel script."));
    document.head.appendChild(script);
  });
}

async function connectBridge() {
  if (!window.qt?.webChannelTransport) {
    state.runtimeMode = "browser";
    state.bridge = await createBrowserBridge();
    return;
  }

  await loadQWebChannelScript();
  return new Promise((resolve) => {
    new QWebChannel(qt.webChannelTransport, (channel) => {
      state.bridge = channel.objects.obsBridge;
      state.runtimeMode = "obs";
      resolve();
    });
  });
}

async function bootstrap() {
  await connectBridge();
  const payload = await state.bridge.bootstrap();
  state.inspirationAssets = payload.inspirationAssets || [];
  state.graphicInspirationAssets = payload.graphicInspirationAssets || {};
  state.runtimeMode = payload.runtimeMode || state.runtimeMode;
  hydrateFromManifest(unwrapPayload(payload.state));
  state.providerDebug = {
    ...state.providerDebug,
    ...(payload.aiProviderDebug || {}),
  };
  state.aiTeamStatus = {
    ...state.aiTeamStatus,
    ...(payload.aiTeamStatus || {}),
  };
  configureAIProviderRuntime({
    appendLog: async (line) => {
      if (typeof state.bridge.appendAIProviderLog === "function") {
        await state.bridge.appendAIProviderLog(line);
      }
    },
    saveDebug: async (debug) => {
      state.providerDebug = {
        ...state.providerDebug,
        ...debug,
      };
      if (typeof state.bridge.saveAIProviderDebug === "function") {
        await state.bridge.saveAIProviderDebug(state.providerDebug);
      }
    },
    onDebug: handleProviderDebug,
  });
  configureAIOrchestratorRuntime({
    appendLog: async (line) => {
      if (typeof state.bridge.appendAIProviderLog === "function") {
        await state.bridge.appendAIProviderLog(line);
      }
    },
    saveDebug: async (debug) => {
      state.providerDebug = {
        ...state.providerDebug,
        ...debug,
      };
      if (typeof state.bridge.saveAIProviderDebug === "function") {
        await state.bridge.saveAIProviderDebug(state.providerDebug);
      }
    },
    onFlow: handleTeamFlow,
    saveTeamStatus: async (teamStatus) => {
      state.aiTeamStatus = {
        ...state.aiTeamStatus,
        ...teamStatus,
      };
      if (typeof state.bridge.saveAITeamStatus === "function") {
        await state.bridge.saveAITeamStatus(state.aiTeamStatus);
      }
    },
    loadPerformance: async () => (typeof state.bridge.loadAIPerformance === "function"
      ? state.bridge.loadAIPerformance()
      : { tasks: {}, updatedAt: "" }),
    savePerformance: async (performance) => {
      if (typeof state.bridge.saveAIPerformance === "function") {
        await state.bridge.saveAIPerformance(performance);
      }
    },
  });
  await hydrateProviderState();
  scheduleSeasonRefresh();
  bindUi();
  pushActivity(`Bridge initialized in ${state.runtimeMode} mode.`);
  pushActivity("AI Harmony System initialized. Specialist agents will coordinate tasks automatically.");
  appendLog(`Bridge initialized in ${state.runtimeMode} mode. The AI Harmony System is ready for coordinated multi-agent routing.`);
  pushActivity("Attempting automatic season detection on startup.");
  try {
    await refreshSeasonState(state, appendLog, handlePipelineEvent);
  } catch (error) {
    appendLog(`Startup season detection skipped: ${error.message || String(error)}`);
  }
  setStatus("Ready", true);
}

bootstrap().catch((error) => {
  setStatus("Initialization failed");
  appendLog(error.message || String(error));
  setError(`Initialization failed: ${error.message || String(error)}`);
});
