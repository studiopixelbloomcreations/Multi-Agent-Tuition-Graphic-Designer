const STORAGE_KEY = "obs-ai-broadcast-graphics.manifest";
const IDB_NAME = "obs-ai-broadcast-graphics-db";
const STORE_NAME = "handles";
const ASSET_STORE_NAME = "asset-payloads";
const OUTPUT_HANDLE_KEY = "output-directory";
const INSPIRATION_ASSETS_KEY = "inspiration-assets";
const GRAPHIC_INSPIRATION_ASSETS_KEY = "graphic-inspiration-assets";
const AI_PROVIDER_DEBUG_KEY = "ai-provider-debug";
const AI_PROVIDER_LOG_KEY = "ai-provider-log";
const AI_PERFORMANCE_KEY = "ai-performance";
const AI_TEAM_STATUS_KEY = "ai-team-status";

function defaultManifest() {
  return {
    season: "Default",
    seasonReasoning: "No season analysis yet.",
    seasonCheckedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    testingMode: true,
    seasonRefreshMinutes: 30,
    assets: {},
    outputDirectoryName: "",
    lastCompletedGraphicId: "",
  };
}

function defaultAIProviderDebug() {
  return {
    providerId: "",
    lastFunction: "none",
    lastStatus: "idle",
    lastApiResponse: "",
    requestTimeMs: 0,
    updatedAt: "",
    orchestratorTask: "",
    currentFlow: "",
    lastOrchestratorAgent: "",
  };
}

function defaultAIPerformance() {
  return {
    tasks: {},
    updatedAt: "",
  };
}

function defaultAITeamStatus() {
  return {
    taskType: "",
    flow: [],
    currentAgent: "",
    status: "idle",
    updatedAt: "",
  };
}

function loadManifest() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : defaultManifest();
  } catch {
    return defaultManifest();
  }
}

function saveManifest(manifest) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stripAssetPayloads(manifest)));
}

function loadJsonFromStorage(key, fallbackFactory) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallbackFactory();
  } catch {
    return fallbackFactory();
  }
}

function saveJsonToStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function toResponse(ok, message, payload = {}) {
  return { ok, message, payload };
}

function slotFileName(graphicId) {
  return `${graphicId}.png`;
}

function assetPayloadKey(graphicId, kind) {
  return `asset:${graphicId}:${kind}`;
}

function stripAssetPayloads(manifest) {
  const cleanAssets = {};
  for (const [graphicId, asset] of Object.entries(manifest.assets || {})) {
    cleanAssets[graphicId] = {
      ...asset,
      dataUrl: "",
      rawDataUrl: "",
      processedDataUrl: "",
    };
  }
  return {
    ...manifest,
    assets: cleanAssets,
  };
}

async function ensureSubdirectory(directoryHandle, folderName) {
  if (!directoryHandle) return null;
  return directoryHandle.getDirectoryHandle(folderName, { create: true });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 3);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains(ASSET_STORE_NAME)) {
        db.createObjectStore(ASSET_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putValue(key, value) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function putAssetValue(key, value) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(ASSET_STORE_NAME, "readwrite");
    tx.objectStore(ASSET_STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function getValue(key) {
  const db = await openDb();
  const result = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}

async function getAssetValue(key) {
  const db = await openDb();
  const result = await new Promise((resolve, reject) => {
    const tx = db.transaction(ASSET_STORE_NAME, "readonly");
    const request = tx.objectStore(ASSET_STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}

async function hydrateAssetPayloads(manifest) {
  const hydrated = {
    ...manifest,
    assets: { ...(manifest.assets || {}) },
  };

  for (const [graphicId, asset] of Object.entries(hydrated.assets)) {
    const [rawDataUrl, processedDataUrl] = await Promise.all([
      getAssetValue(assetPayloadKey(graphicId, "raw")),
      getAssetValue(assetPayloadKey(graphicId, "processed")),
    ]);

    hydrated.assets[graphicId] = {
      ...asset,
      rawDataUrl: rawDataUrl || "",
      processedDataUrl: processedDataUrl || "",
      dataUrl: processedDataUrl || rawDataUrl || asset.dataUrl || "",
    };
  }

  return hydrated;
}

async function saveToDirectory(directoryHandle, fileName, dataUrl, folderName = "") {
  if (!directoryHandle) return null;
  const permission = await directoryHandle.queryPermission({ mode: "readwrite" });
  let granted = permission === "granted";
  if (!granted) {
    granted = (await directoryHandle.requestPermission({ mode: "readwrite" })) === "granted";
  }
  if (!granted) {
    return null;
  }

  const targetDirectory = folderName ? await ensureSubdirectory(directoryHandle, folderName) : directoryHandle;
  const fileHandle = await targetDirectory.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  await writable.write(blob);
  await writable.close();
  return `${directoryHandle.name}${folderName ? `/${folderName}` : ""}/${fileName}`;
}

async function saveTextToDirectory(directoryHandle, fileName, content, folderName = "") {
  if (!directoryHandle) return null;
  const permission = await directoryHandle.queryPermission({ mode: "readwrite" });
  let granted = permission === "granted";
  if (!granted) {
    granted = (await directoryHandle.requestPermission({ mode: "readwrite" })) === "granted";
  }
  if (!granted) {
    return null;
  }

  const targetDirectory = folderName ? await ensureSubdirectory(directoryHandle, folderName) : directoryHandle;
  const fileHandle = await targetDirectory.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
  return `${directoryHandle.name}${folderName ? `/${folderName}` : ""}/${fileName}`;
}

export class BrowserBridge {
  constructor() {
    this.outputDirectoryHandle = null;
    this.inspirationAssets = [];
    this.graphicInspirationAssets = {};
  }

  async bootstrap() {
    try {
      this.outputDirectoryHandle = await getValue(OUTPUT_HANDLE_KEY);
      this.inspirationAssets = (await getValue(INSPIRATION_ASSETS_KEY)) || [];
      this.graphicInspirationAssets = (await getValue(GRAPHIC_INSPIRATION_ASSETS_KEY)) || {};
    } catch {
      this.outputDirectoryHandle = null;
      this.inspirationAssets = [];
      this.graphicInspirationAssets = {};
    }

    const manifest = await hydrateAssetPayloads(loadManifest());
    saveManifest(manifest);

    if (this.outputDirectoryHandle?.name) {
      manifest.outputDirectoryName = this.outputDirectoryHandle.name;
      saveManifest(manifest);
    }

    return {
      moduleDataPath: "browser-local-mode",
      generatedGraphicsDir: manifest.outputDirectoryName || "browser-local-storage",
      state: toResponse(true, "State loaded.", manifest),
      inspirationAssets: this.inspirationAssets,
      graphicInspirationAssets: this.graphicInspirationAssets,
      runtimeMode: "browser",
      aiProviderDebug: this.loadAIProviderDebug(),
      aiPerformance: this.loadAIPerformance(),
      aiTeamStatus: this.loadAITeamStatus(),
    };
  }

  async loadState() {
    return toResponse(true, "State loaded.", await hydrateAssetPayloads(loadManifest()));
  }

  async saveRuntimeConfig(testingMode, seasonRefreshMinutes) {
    const manifest = loadManifest();
    manifest.testingMode = testingMode;
    manifest.seasonRefreshMinutes = seasonRefreshMinutes;
    manifest.updatedAt = new Date().toISOString();
    saveManifest(manifest);
    return toResponse(true, "Runtime config saved.", manifest);
  }

  async saveGeneratedGraphic(graphicId, dataUrl, prompt, season, qualityNotes, visible, generationAttempt, reviewScore) {
    const manifest = loadManifest();
    const previous = manifest.assets[graphicId] || {};
    const savedPath = await saveToDirectory(this.outputDirectoryHandle, slotFileName(graphicId), dataUrl, "raw");
    await putAssetValue(assetPayloadKey(graphicId, "raw"), dataUrl);

    manifest.season = season;
    manifest.updatedAt = new Date().toISOString();
    manifest.lastCompletedGraphicId = graphicId;
    manifest.assets[graphicId] = {
      id: graphicId,
      rawPath: savedPath || "",
      path: previous.path || savedPath || "",
      dataUrl: "",
      prompt,
      qualityNotes,
      visible,
      savedAt: new Date().toISOString(),
      width: previous.width || 0,
      height: previous.height || 0,
      generationAttempt,
      reviewScore,
      backgroundRemoved: previous.backgroundRemoved || false,
      overwriteMode: true,
      version: (previous.version || 0) + 1,
    };

    saveManifest(manifest);
    return toResponse(
      true,
      savedPath ? `Raw graphic saved and written to ${savedPath}.` : "Raw graphic saved in browser mode.",
      await hydrateAssetPayloads(manifest),
    );
  }

  async saveProcessedGraphic(graphicId, dataUrl, processingNotes, width = 0, height = 0) {
    const manifest = loadManifest();
    const previous = manifest.assets[graphicId] || {};
    const savedPath = await saveToDirectory(this.outputDirectoryHandle, slotFileName(graphicId), dataUrl, "processed");
    await putAssetValue(assetPayloadKey(graphicId, "processed"), dataUrl);

    manifest.updatedAt = new Date().toISOString();
    manifest.assets[graphicId] = {
      ...previous,
      id: graphicId,
      path: savedPath || previous.path || "",
      dataUrl: "",
      processedDataUrl: "",
      processedPath: savedPath || previous.processedPath || "",
      backgroundRemoved: true,
      processingNotes,
      width: width || previous.width || 0,
      height: height || previous.height || 0,
    };

    saveManifest(manifest);
    return toResponse(
      true,
      savedPath ? `Processed graphic saved and written to ${savedPath}.` : "Processed graphic saved in browser mode.",
      await hydrateAssetPayloads(manifest),
    );
  }

  async finalizeGraphic(graphicId, dataUrl, prompt, season, qualityNotes, visible, generationAttempt, reviewScore, width = 0, height = 0) {
    const manifest = loadManifest();
    const previous = manifest.assets[graphicId] || {};
    await putAssetValue(assetPayloadKey(graphicId, "processed"), dataUrl);

    manifest.season = season;
    manifest.updatedAt = new Date().toISOString();
    manifest.lastCompletedGraphicId = graphicId;
    manifest.assets[graphicId] = {
      ...previous,
      id: graphicId,
      dataUrl: "",
      processedDataUrl: "",
      prompt,
      qualityNotes,
      visible,
      savedAt: new Date().toISOString(),
      width: width || previous.width || 0,
      height: height || previous.height || 0,
      generationAttempt,
      reviewScore,
      backgroundRemoved: true,
      overwriteMode: true,
    };

    saveManifest(manifest);
    return toResponse(true, "Graphic finalized successfully.", await hydrateAssetPayloads(manifest));
  }

  async saveSeason(season, reasoning) {
    const manifest = loadManifest();
    manifest.season = season;
    manifest.seasonReasoning = reasoning;
    manifest.seasonCheckedAt = new Date().toISOString();
    manifest.updatedAt = new Date().toISOString();
    saveManifest(manifest);
    return toResponse(true, "Season saved.", manifest);
  }

  async applyToScene() {
    return toResponse(true, "Web app mode: generated graphics are ready in the output folder and preview cards for manual use in OBS.");
  }

  async setGraphicVisibility(graphicId, visible) {
    const manifest = loadManifest();
    manifest.assets[graphicId] = {
      ...(manifest.assets[graphicId] || {}),
      visible,
    };
    saveManifest(manifest);
    return toResponse(true, "Visibility updated.", await hydrateAssetPayloads(manifest));
  }

  async setInspirationAssets(assets) {
    this.inspirationAssets = assets;
    await putValue(INSPIRATION_ASSETS_KEY, assets);
    return { ok: true };
  }

  async setGraphicInspirationAssets(graphicId, assets) {
    this.graphicInspirationAssets = {
      ...(this.graphicInspirationAssets || {}),
      [graphicId]: assets,
    };
    await putValue(GRAPHIC_INSPIRATION_ASSETS_KEY, this.graphicInspirationAssets);
    return { ok: true };
  }

  async chooseOutputDirectory() {
    if (!window.showDirectoryPicker) {
      return toResponse(false, "This browser does not support folder picking. Use recent Chrome or Edge.");
    }

    this.outputDirectoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    await putValue(OUTPUT_HANDLE_KEY, this.outputDirectoryHandle);

    const manifest = loadManifest();
    manifest.outputDirectoryName = this.outputDirectoryHandle.name;
    manifest.updatedAt = new Date().toISOString();
    saveManifest(manifest);

    return toResponse(true, `Output folder selected: ${this.outputDirectoryHandle.name}`, await hydrateAssetPayloads(manifest));
  }

  loadAIProviderDebug() {
    return loadJsonFromStorage(AI_PROVIDER_DEBUG_KEY, defaultAIProviderDebug);
  }

  async saveAIProviderDebug(debug) {
    const nextDebug = {
      ...defaultAIProviderDebug(),
      ...debug,
    };
    saveJsonToStorage(AI_PROVIDER_DEBUG_KEY, nextDebug);
    return toResponse(true, "AI provider debug updated.", nextDebug);
  }

  async appendAIProviderLog(line) {
    const existing = loadJsonFromStorage(AI_PROVIDER_LOG_KEY, () => ({ lines: [] }));
    const lines = [...(existing.lines || []), line].slice(-200);
    const payload = { lines };
    saveJsonToStorage(AI_PROVIDER_LOG_KEY, payload);
    await saveTextToDirectory(this.outputDirectoryHandle, "ai-provider.log", `${lines.join("\n")}\n`, "logs");
    return toResponse(true, "AI provider log updated.", payload);
  }

  loadAIProviderLog() {
    return loadJsonFromStorage(AI_PROVIDER_LOG_KEY, () => ({ lines: [] }));
  }

  loadAIPerformance() {
    return loadJsonFromStorage(AI_PERFORMANCE_KEY, defaultAIPerformance);
  }

  async saveAIPerformance(performance) {
    saveJsonToStorage(AI_PERFORMANCE_KEY, performance);
    await saveTextToDirectory(this.outputDirectoryHandle, "ai-performance.json", JSON.stringify(performance, null, 2), "config");
    return toResponse(true, "AI performance updated.", performance);
  }

  loadAITeamStatus() {
    return loadJsonFromStorage(AI_TEAM_STATUS_KEY, defaultAITeamStatus);
  }

  async saveAITeamStatus(teamStatus) {
    saveJsonToStorage(AI_TEAM_STATUS_KEY, teamStatus);
    return toResponse(true, "AI team status updated.", teamStatus);
  }
}

export async function createBrowserBridge() {
  return new BrowserBridge();
}
