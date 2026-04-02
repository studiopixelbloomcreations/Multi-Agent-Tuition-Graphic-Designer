import { GRAPHICS, QUALITY_POLICY } from "../config.js";
import {
  detectSeason,
  summarizeInspirationStyle,
  generatePrompt,
  generateImage,
  generateSeasonalTransformationPrompt,
  transformImageToSeason,
  reviewGeneratedGraphic,
} from "./ai-service.js";
import { processAllGraphics } from "./background-removal.js";

export async function refreshSeasonState(state, log, onEvent = null) {
  onEvent?.({ kind: "season_start", message: "Checking current Sri Lankan season." });
  const seasonResult = await detectSeason();
  state.season = seasonResult.season;
  state.seasonReasoning = seasonResult.reasoning;
  await state.bridge.saveSeason(seasonResult.season, seasonResult.reasoning);
  log(`Season updated to ${seasonResult.season}.`);
  onEvent?.({ kind: "season_done", message: `Season detected as ${seasonResult.season}.`, seasonResult });
  return seasonResult;
}

export async function generateGraphicWithQualityLoop(graphic, state, log, onEvent = null) {
  onEvent?.({ kind: "style_start", graphicId: graphic.id, message: `Analyzing inspiration style for ${graphic.label}.` });
  const referenceAssets = state.graphicInspirationAssets?.[graphic.id] || [];
  const referenceAnalysis = await summarizeInspirationStyle(graphic, referenceAssets);
  const seasonalSourceAsset = referenceAssets[0] || null;
  const useIAS = Boolean(seasonalSourceAsset?.dataUrl || seasonalSourceAsset?.file);
  onEvent?.({ kind: "style_done", graphicId: graphic.id, message: `Style extraction ready for ${graphic.label}.`, styleSummary: referenceAnalysis });
  let lastFailure = "Generation did not complete.";

  for (let attempt = 1; attempt <= QUALITY_POLICY.maxAttempts; attempt += 1) {
    log(`Prompting ${graphic.label}, attempt ${attempt}/${QUALITY_POLICY.maxAttempts}.`);
    let prompt = "";
    let imageResult;

    if (useIAS) {
      onEvent?.({ kind: "prompt_start", graphicId: graphic.id, attempt, message: `Generating IAS transformation prompt for ${graphic.label}.` });
      prompt = await generateSeasonalTransformationPrompt(graphic, state.season, referenceAnalysis);
      onEvent?.({ kind: "prompt_done", graphicId: graphic.id, attempt, message: `IAS prompt ready for ${graphic.label}.`, prompt });
      onEvent?.({ kind: "image_start", graphicId: graphic.id, attempt, message: `Transforming uploaded reference for ${graphic.label}.` });
      imageResult = await transformImageToSeason(
        graphic,
        state.season,
        seasonalSourceAsset.dataUrl || "",
        referenceAnalysis,
        state.testingMode,
        prompt,
      );
    } else {
      onEvent?.({ kind: "prompt_start", graphicId: graphic.id, attempt, message: `Generating prompt for ${graphic.label}.` });
      prompt = await generatePrompt(graphic, state.season, referenceAnalysis);
      onEvent?.({ kind: "prompt_done", graphicId: graphic.id, attempt, message: `Prompt ready for ${graphic.label}.`, prompt });
      onEvent?.({ kind: "image_start", graphicId: graphic.id, attempt, message: `Generating image for ${graphic.label}.` });
      imageResult = await generateImage(prompt, state.testingMode);
    }

    if (!imageResult.dataUrl) {
      lastFailure = `No image returned for ${graphic.label}.`;
      onEvent?.({ kind: "image_fail", graphicId: graphic.id, attempt, message: lastFailure });
      continue;
    }

    onEvent?.({ kind: "raw_save_start", graphicId: graphic.id, attempt, message: `Saving raw output for ${graphic.label}.` });
    const rawSaveResponse = await state.bridge.saveGeneratedGraphic(
      graphic.id,
      imageResult.dataUrl,
      prompt,
      state.season,
      `${useIAS ? "IAS raw transformation output" : "Raw generation output"} | model=${imageResult.modelUsed}${imageResult.fallbackReason ? ` | fallback=${imageResult.fallbackReason}` : ""}`,
      true,
      attempt,
      null,
    );
    onEvent?.({ kind: "raw_save_done", graphicId: graphic.id, attempt, message: `Raw output saved for ${graphic.label}.`, response: rawSaveResponse });

    onEvent?.({ kind: "review_start", graphicId: graphic.id, attempt, message: `Reviewing ${graphic.label} for quality.` });
    const review = await reviewGeneratedGraphic(graphic, state.season, prompt, imageResult.dataUrl);
    log(`${graphic.label} reviewed at score ${review.score} using ${imageResult.modelUsed}.`);
    onEvent?.({ kind: "review_done", graphicId: graphic.id, attempt, message: `${graphic.label} reviewed at score ${review.score}.`, review, modelUsed: imageResult.modelUsed });

    if (review.pass) {
      onEvent?.({ kind: "save_start", graphicId: graphic.id, attempt, message: `Saving approved ${graphic.label}.` });
      const saveResponse = await state.bridge.finalizeGraphic(
        graphic.id,
        imageResult.dataUrl,
        prompt,
        state.season,
        `${review.notes} | mode=${useIAS ? "ias" : "gcs"} | model=${imageResult.modelUsed}${imageResult.fallbackReason ? ` | fallback=${imageResult.fallbackReason}` : ""}`,
        true,
        attempt,
        review.score,
        3840,
        2160,
      );
      onEvent?.({ kind: "save_done", graphicId: graphic.id, attempt, message: `${graphic.label} saved successfully.`, response: saveResponse });
      return saveResponse;
    }

    lastFailure = review.notes || "Graphic quality gate failed.";
    onEvent?.({ kind: "retry", graphicId: graphic.id, attempt, message: `${graphic.label} failed review. Retrying.` });
  }

  throw new Error(`${graphic.label} failed quality review after ${QUALITY_POLICY.maxAttempts} attempts. ${lastFailure}`);
}

export async function generateAllGraphics(state, log, onGraphicSaved = null, onEvent = null) {
  for (const graphic of GRAPHICS) {
    const response = await generateGraphicWithQualityLoop(graphic, state, log, onEvent);
    if (!response.ok) {
      throw new Error(response.message);
    }
    if (onGraphicSaved) {
      await onGraphicSaved(graphic, response);
    }
  }
}

export { processAllGraphics };
