import { QUALITY_POLICY } from "../config.js";
import { executeAgentTask } from "../ai-orchestrator/orchestrator.js";
import { TASK_TYPES } from "../ai-orchestrator/agent-registry.js";

function normalizeSeason(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (value.includes("avurudu")) return "Avurudu";
  if (value.includes("vesak")) return "Vesak";
  if (value.includes("kite")) return "Kite Season";
  return "Default";
}

function extractText(result) {
  if (typeof result === "string") return result;
  if (typeof result?.text === "string") return result.text;
  if (typeof result?.message?.content === "string") return result.message.content;
  if (Array.isArray(result?.message?.content)) {
    return result.message.content
      .map((item) => item?.text || item?.content || (typeof item === "string" ? item : ""))
      .filter(Boolean)
      .join("\n");
  }
  if (Array.isArray(result?.content)) {
    return result.content
      .map((item) => item?.text || item?.content || (typeof item === "string" ? item : ""))
      .filter(Boolean)
      .join("\n");
  }
  return String(result || "");
}

function parseJsonSafely(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function inferSeasonFromSriLankanCalendar(date = new Date()) {
  const month = Number(new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    timeZone: "Asia/Colombo",
  }).format(date));
  const day = Number(new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    timeZone: "Asia/Colombo",
  }).format(date));

  if ((month === 3 && day >= 20) || (month === 4 && day <= 30)) {
    return {
      season: "Avurudu",
      reasoning: "Sri Lankan calendar guidance: late March through April is Avurudu season, peaking around April 13-14.",
    };
  }

  if (month === 5) {
    return {
      season: "Vesak",
      reasoning: "Sri Lankan calendar guidance: May is the strongest Vesak period.",
    };
  }

  if (month === 8) {
    return {
      season: "Kite Season",
      reasoning: "Sri Lankan calendar guidance: August commonly aligns with seasonal kite activity.",
    };
  }

  return null;
}

function dataUrlToFile(dataUrl, filename = "image.png") {
  if (!dataUrl?.includes(",")) return null;
  const [header, body] = dataUrl.split(",", 2);
  const mimeMatch = header.match(/data:(.*?);base64/);
  const mime = mimeMatch?.[1] || "image/png";
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new File([bytes], filename, { type: mime });
}

function clipText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}…` : text;
}

function compactJsonText(raw, maxLength = 220) {
  if (!raw) return "";
  if (typeof raw === "string") return clipText(raw, maxLength);
  try {
    return clipText(JSON.stringify(raw), maxLength);
  } catch {
    return clipText(String(raw), maxLength);
  }
}

export async function detectSeason() {
  const today = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Colombo",
  }).format(new Date());
  const calendarSeason = inferSeasonFromSriLankanCalendar(new Date());

  const prompt = [
    "You are the Season Detection System for a Sri Lankan livestream broadcast graphics plugin.",
    `Today's date in Sri Lanka is ${today}.`,
    "You must reason using the current Sri Lankan cultural calendar, not generic global season logic.",
    "Important seasonal anchors:",
    "1. Avurudu is the dominant Sri Lankan seasonal theme through late March and April, especially the lead-up to April 13-14.",
    "2. Vesak is dominant in May.",
    "3. Kite Season should only be chosen when it is stronger than Avurudu or Vesak.",
    "Identify the strongest current cultural or seasonal theme in Sri Lanka right now.",
    "Return strict JSON with keys: season, reasoning.",
    'Allowed season values: "Avurudu", "Vesak", "Kite Season", "Default".',
    "Be decisive. Use Default only if there is genuinely no strong active seasonal signal.",
    "If no strong seasonal signal exists, use Default.",
  ].join(" ");

  const completion = (await executeAgentTask(TASK_TYPES.seasonDetection, prompt, { taskLabel: "season detection" })).result;
  const parsed = parseJsonSafely(extractText(completion?.text || completion), null);
  if (parsed?.season) {
    const aiSeason = normalizeSeason(parsed.season);
    if (calendarSeason && aiSeason === "Default") {
      return {
        season: calendarSeason.season,
        reasoning: `${calendarSeason.reasoning} AI returned Default, so calendar-guided Sri Lankan seasonal override was applied.`,
      };
    }
    return {
      season: aiSeason,
      reasoning: parsed.reasoning || "AI season analysis completed.",
    };
  }

  const season = normalizeSeason(extractText(completion?.text || completion));
  if (calendarSeason && season === "Default") {
    return {
      season: calendarSeason.season,
      reasoning: `${calendarSeason.reasoning} AI fallback text normalized to Default, so calendar-guided override was applied.`,
    };
  }
  if (season !== "Default") {
    return {
      season,
      reasoning: "Season derived from fallback normalization.",
    };
  }

  const backupCompletion = (await executeAgentTask(
    TASK_TYPES.seasonDetection,
    [
      "Return only one value from this list for Sri Lanka right now:",
      "Avurudu, Vesak, Kite Season, Default.",
      `Today's date in Sri Lanka is ${today}.`,
      "No explanation, no JSON, one value only.",
    ].join(" "),
    { taskLabel: "season detection fallback" },
  )).result;
  const backupSeason = normalizeSeason(extractText(backupCompletion?.text || backupCompletion));
  if (calendarSeason && backupSeason === "Default") {
    return {
      season: calendarSeason.season,
      reasoning: `${calendarSeason.reasoning} Backup AI pass still returned Default, so calendar-guided override was applied.`,
    };
  }
  return {
    season: backupSeason,
    reasoning: backupSeason === "Default"
      ? "Fallback season detection did not find a strong current signal."
      : "Season derived from fallback single-value analysis.",
  };
}

export async function summarizeInspirationStyle(graphic, inspirationAssets) {
  if (!inspirationAssets.length) {
    return {
      styleSummary: "modern premium broadcast overlay, clean hierarchy, balanced spacing",
      layoutBlueprint: `${graphic.label}: text-safe structure only, preserve clean title and subtitle zones, no baked text in final output`,
      extractedFields: "name, subtitle, optional phone/whatsapp field if relevant",
      exactVisibleText: "",
    };
  }

  const mediaFiles = inspirationAssets
    .map((asset) => asset.file || (asset.dataUrl ? dataUrlToFile(asset.dataUrl, asset.name || "reference.png") : null))
    .filter(Boolean)
    .slice(0, 4);

  if (!mediaFiles.length) {
    return {
      styleSummary: "modern premium broadcast overlay, clean hierarchy, balanced spacing",
      layoutBlueprint: `${graphic.label}: text-safe structure only, preserve clean title and subtitle zones, no baked text in final output`,
      extractedFields: "name, subtitle, optional phone/whatsapp field if relevant",
      exactVisibleText: "",
    };
  }

  const primaryReference = mediaFiles[0];
  const completion = (await executeAgentTask(
    TASK_TYPES.promptGeneration,
    [
      `Analyze this reference for a ${graphic.type} OBS broadcast graphic.`,
      "Do not copy decorative artwork directly, but do capture the exact visible content structure and wording.",
      "Return strict JSON with keys: styleSummary, layoutBlueprint, extractedFields, exactVisibleText.",
      "styleSummary: max 18 words about visual treatment only.",
      "layoutBlueprint: max 55 words about text placements, hierarchy, alignment, and content block arrangement from the reference.",
      "extractedFields: max 18 words naming visible field types from the reference such as name, subtitle, phone, whatsapp, role, institution.",
      "exactVisibleText: max 160 words containing the exact visible wording from the reference image, including names, subtitles, phone numbers, whatsapp numbers, and labels when readable.",
    ].join(" "),
    { taskLabel: `${graphic.label} prompt blueprint`, providerOptions: { media: primaryReference } },
  )).result;

  const parsed = parseJsonSafely(extractText(completion?.text || completion), {});
  return {
    styleSummary: clipText(parsed?.styleSummary || "modern premium broadcast overlay, clean hierarchy, balanced spacing", 180),
    layoutBlueprint: clipText(
      parsed?.layoutBlueprint || `${graphic.label}: preserve the same title, subtitle, and contact/info block layout structure from the reference`,
      280,
    ),
    extractedFields: clipText(
      parsed?.extractedFields || "name, subtitle, optional phone or whatsapp field, institutional identifier",
      140,
    ),
    exactVisibleText: clipText(parsed?.exactVisibleText || "", 420),
  };
}

export async function generatePrompt(graphic, season, referenceAnalysis) {
  const prompt = [
    `Professional broadcast ${graphic.type}, 4K, transparent background, no background, professional broadcast design.`,
    `Seasonal direction: ${clipText(season, 32)}.`,
    `Style: ${compactJsonText(referenceAnalysis?.styleSummary, 180)}.`,
    `Layout blueprint: ${compactJsonText(referenceAnalysis?.layoutBlueprint, 260)}.`,
    `Reference fields detected: ${compactJsonText(referenceAnalysis?.extractedFields, 120)}.`,
    `Exact visible content to preserve from reference: ${compactJsonText(referenceAnalysis?.exactVisibleText, 260)}.`,
    "Match the reference content layout, text placement logic, wording hierarchy, and visible content blocks as closely as possible while adapting colors, motifs, or accents to the current season.",
    "Ultra-modern 2026 TV look, sharp metallic finish, disciplined spacing, cinematic lighting, no visual distortions, no broken glyphs, no unwanted substitutions.",
  ].join(" ");

  return clipText(prompt, 900);
}

export async function generateImage(prompt, testingMode = true) {
  const image = (await executeAgentTask(
    TASK_TYPES.imageGeneration,
    prompt,
    { taskLabel: "image generation", providerOptions: { testingMode } },
  )).result;
  return {
    dataUrl: image?.dataUrl || "",
    modelUsed: "agent-controlled",
  };
}

export async function analyzeBackgroundRemoval(graphic, season, imageDataUrl) {
  const parsed = (await executeAgentTask(TASK_TYPES.backgroundRemoval, {
    graphic,
    season,
    imageDataUrl,
    file: dataUrlToFile(imageDataUrl, `${graphic.id}-raw.png`),
  }, { taskLabel: `${graphic.label} background removal` })).result;

  return {
    backgroundType: parsed?.backgroundType || "unknown",
    dominantBackgroundHex: parsed?.dominantBackgroundHex || "",
    tolerance: Number(parsed?.tolerance) || null,
    edgeSoftness: Number(parsed?.edgeSoftness) || null,
    preserveGlow: parsed?.preserveGlow !== false,
    notes: parsed?.notes || "AI background analysis completed.",
  };
}

export async function reviewGeneratedGraphic(graphic, season, prompt, imageDataUrl) {
  const imageFile = dataUrlToFile(imageDataUrl, `${graphic.id}.png`);
  const reviewPrompt = [
    "You are the quality control system for AI-generated TV broadcast graphics.",
    `Graphic type: ${graphic.label}.`,
    `Season: ${season}.`,
    `Prompt used: ${prompt}.`,
    "Review the generated overlay image for these exact criteria:",
    "1. premium broadcast quality",
    "2. text content should match the reference-driven prompt rather than being blank",
    "3. no distorted pseudo-text or broken glyphs",
    "4. no weird artifacts",
    "5. not cartoonish",
    "6. visually suitable for professional livestream overlays and structurally close to the reference",
    "Return strict JSON with keys: pass, score, notes.",
    `Use pass=true only when the score is at least ${QUALITY_POLICY.minimumScore}.`,
  ].join(" ");

  const completion = (await executeAgentTask(
    TASK_TYPES.qualityEnhancement,
    reviewPrompt,
    { taskLabel: `${graphic.label} quality review`, providerOptions: { media: imageFile || imageDataUrl } },
  )).result;
  const parsed = parseJsonSafely(extractText(completion?.text || completion), null);
  if (parsed && typeof parsed.score === "number") {
    return {
      pass: Boolean(parsed.pass),
      score: parsed.score,
      notes: parsed.notes || "AI quality review completed.",
    };
  }

  return {
    pass: false,
    score: 0,
    notes: "Quality review returned an unreadable response.",
  };
}
