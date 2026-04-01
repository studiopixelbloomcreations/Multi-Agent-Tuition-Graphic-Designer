import { BACKGROUND_REMOVAL_POLICY, GRAPHICS } from "../config.js";
import { analyzeBackgroundRemoval } from "./ai-service.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hexToRgb(hex) {
  const normalized = String(hex || "").trim().replace("#", "");
  if (![3, 6].includes(normalized.length)) return null;
  const full = normalized.length === 3
    ? normalized.split("").map((part) => `${part}${part}`).join("")
    : normalized;
  const int = Number.parseInt(full, 16);
  if (Number.isNaN(int)) return null;
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

function colorDistanceSq(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return dr * dr + dg * dg + db * db;
}

function imageDataToDataUrl(imageData, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

async function dataUrlToImageData(dataUrl) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  return {
    imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
    width: canvas.width,
    height: canvas.height,
  };
}

function sampleBorderColor(data, width, height) {
  const samples = [];
  const pushPixel = (x, y) => {
    const index = (y * width + x) * 4;
    if (data[index + 3] < 8) return;
    samples.push([data[index], data[index + 1], data[index + 2]]);
  };

  for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 96))) {
    pushPixel(x, 0);
    pushPixel(x, height - 1);
  }
  for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 96))) {
    pushPixel(0, y);
    pushPixel(width - 1, y);
  }

  if (!samples.length) return { r: 0, g: 0, b: 0 };

  samples.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
  const median = samples[Math.floor(samples.length / 2)];
  return { r: median[0], g: median[1], b: median[2] };
}

function buildAlphaMask(data, width, height, backgroundColor, tolerance, edgeSoftness) {
  const visited = new Uint8Array(width * height);
  const mask = new Uint8Array(width * height);
  const queue = new Uint32Array(width * height);
  let head = 0;
  let tail = 0;
  const thresholdSq = tolerance * tolerance;
  const softSq = (tolerance + edgeSoftness) * (tolerance + edgeSoftness);

  const enqueue = (x, y) => {
    const offset = y * width + x;
    if (visited[offset]) return;
    visited[offset] = 1;
    queue[tail] = offset;
    tail += 1;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  while (head < tail) {
    const offset = queue[head];
    head += 1;
    const x = offset % width;
    const y = Math.floor(offset / width);
    const index = offset * 4;
    const alpha = data[index + 3];
    if (alpha < 8) {
      mask[offset] = 0;
    } else {
      const distanceSq = colorDistanceSq(
        data[index],
        data[index + 1],
        data[index + 2],
        backgroundColor.r,
        backgroundColor.g,
        backgroundColor.b,
      );
      if (distanceSq <= thresholdSq) {
        mask[offset] = 0;
        if (x > 0) enqueue(x - 1, y);
        if (x + 1 < width) enqueue(x + 1, y);
        if (y > 0) enqueue(x, y - 1);
        if (y + 1 < height) enqueue(x, y + 1);
        continue;
      }

      if (distanceSq <= softSq) {
        const fade = clamp((distanceSq - thresholdSq) / Math.max(1, softSq - thresholdSq), 0, 1);
        mask[offset] = Math.round(fade * 255);
      } else {
        mask[offset] = 255;
      }
    }
  }

  for (let offset = 0; offset < mask.length; offset += 1) {
    if (visited[offset]) continue;
    mask[offset] = 255;
  }

  return mask;
}

function smoothMask(mask, width, height, passes = 1) {
  let active = mask;
  for (let pass = 0; pass < passes; pass += 1) {
    const next = new Uint8Array(active.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        let count = 0;
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            const nx = x + ox;
            const ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            sum += active[ny * width + nx];
            count += 1;
          }
        }
        next[y * width + x] = Math.round(sum / count);
      }
    }
    active = next;
  }
  return active;
}

function applyMaskAndDespill(data, mask, backgroundColor, despillStrength) {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < mask.length; i += 1) {
    const index = i * 4;
    const alpha = mask[i] / 255;
    const baseAlpha = data[index + 3] / 255;
    const finalAlpha = clamp(alpha * baseAlpha, 0, 1);

    if (finalAlpha <= 0.001) {
      out[index] = 0;
      out[index + 1] = 0;
      out[index + 2] = 0;
      out[index + 3] = 0;
      continue;
    }

    const unmix = clamp((1 - finalAlpha) * despillStrength, 0, 0.95);
    out[index] = clamp(Math.round(data[index] + (data[index] - backgroundColor.r) * unmix), 0, 255);
    out[index + 1] = clamp(Math.round(data[index + 1] + (data[index + 1] - backgroundColor.g) * unmix), 0, 255);
    out[index + 2] = clamp(Math.round(data[index + 2] + (data[index + 2] - backgroundColor.b) * unmix), 0, 255);
    out[index + 3] = Math.round(finalAlpha * 255);
  }
  return out;
}

function sharpenRgba(data, width, height, strength) {
  if (strength <= 0) return data;
  const source = new Uint8ClampedArray(data);
  const output = new Uint8ClampedArray(data);
  const kernel = [
    0, -1, 0,
    -1, 5, -1,
    0, -1, 0,
  ];

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const center = (y * width + x) * 4;
      if (source[center + 3] < 16) continue;

      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 0;
        let ki = 0;
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            const idx = ((y + oy) * width + (x + ox)) * 4 + channel;
            sum += source[idx] * kernel[ki];
            ki += 1;
          }
        }
        output[center + channel] = clamp(
          Math.round(source[center + channel] * (1 - strength) + sum * strength),
          0,
          255,
        );
      }
    }
  }

  return output;
}

function fallbackStrategy(imageData, width, height) {
  const border = sampleBorderColor(imageData.data, width, height);
  return {
    backgroundType: "fallback-edge-sampled",
    dominantBackgroundHex: "",
    tolerance: BACKGROUND_REMOVAL_POLICY.baseTolerance,
    edgeSoftness: BACKGROUND_REMOVAL_POLICY.edgeSoftness,
    preserveGlow: true,
    notes: "Fallback edge-sampled background strategy applied.",
    sampledColor: border,
  };
}

export async function removeBackground(graphic, season, imageDataUrl, log = () => {}, onEvent = null) {
  const { imageData, width, height } = await dataUrlToImageData(imageDataUrl);
  let lastError = null;

  for (let attempt = 1; attempt <= BACKGROUND_REMOVAL_POLICY.maxAttempts; attempt += 1) {
    try {
      onEvent?.({ kind: "background_start", graphicId: graphic.id, attempt, message: `Removing background for ${graphic.label}.` });
      const analysis = await analyzeBackgroundRemoval(graphic, season, imageDataUrl);
      const backgroundColor = hexToRgb(analysis.dominantBackgroundHex) || sampleBorderColor(imageData.data, width, height);
      const tolerance = clamp(
        analysis.tolerance || BACKGROUND_REMOVAL_POLICY.baseTolerance,
        12,
        96,
      );
      const edgeSoftness = clamp(
        analysis.edgeSoftness || BACKGROUND_REMOVAL_POLICY.edgeSoftness,
        4,
        48,
      );
      const mask = smoothMask(
        buildAlphaMask(imageData.data, width, height, backgroundColor, tolerance, edgeSoftness),
        width,
        height,
        1,
      );
      const despilled = applyMaskAndDespill(
        imageData.data,
        mask,
        backgroundColor,
        BACKGROUND_REMOVAL_POLICY.despillStrength,
      );
      const sharpened = sharpenRgba(despilled, width, height, BACKGROUND_REMOVAL_POLICY.sharpenStrength);
      const resultData = new ImageData(sharpened, width, height);
      const processedDataUrl = imageDataToDataUrl(resultData, width, height);
      const notes = `${analysis.notes} | tolerance=${tolerance} | edgeSoftness=${edgeSoftness} | preserveGlow=${analysis.preserveGlow !== false}`;
      onEvent?.({
        kind: "background_done",
        graphicId: graphic.id,
        attempt,
        message: `${graphic.label} background removed successfully.`,
        notes,
      });
      return {
        dataUrl: processedDataUrl,
        notes,
        width,
        height,
      };
    } catch (error) {
      lastError = error;
      log(`Background removal retry ${attempt}/${BACKGROUND_REMOVAL_POLICY.maxAttempts} failed for ${graphic.label}: ${error.message || String(error)}`);
      onEvent?.({
        kind: "background_retry",
        graphicId: graphic.id,
        attempt,
        message: `${graphic.label} background removal retry ${attempt} failed.`,
      });
    }
  }

  const fallback = fallbackStrategy(imageData, width, height);
  const mask = smoothMask(
    buildAlphaMask(
      imageData.data,
      width,
      height,
      fallback.sampledColor,
      fallback.tolerance,
      fallback.edgeSoftness,
    ),
    width,
    height,
    1,
  );
  const despilled = applyMaskAndDespill(
    imageData.data,
    mask,
    fallback.sampledColor,
    BACKGROUND_REMOVAL_POLICY.despillStrength,
  );
  const sharpened = sharpenRgba(despilled, width, height, BACKGROUND_REMOVAL_POLICY.sharpenStrength);
  const resultData = new ImageData(sharpened, width, height);
  const processedDataUrl = imageDataToDataUrl(resultData, width, height);
  const notes = `${fallback.notes} | fallback=true${lastError ? ` | error=${lastError.message || String(lastError)}` : ""}`;
  onEvent?.({
    kind: "background_done",
    graphicId: graphic.id,
    attempt: BACKGROUND_REMOVAL_POLICY.maxAttempts,
    message: `${graphic.label} background removed with fallback cleanup.`,
    notes,
  });
  return {
    dataUrl: processedDataUrl,
    notes,
    width,
    height,
  };
}

export async function processAllGraphics(state, log = () => {}, onGraphicProcessed = null, onEvent = null) {
  for (const graphic of GRAPHICS) {
    const asset = state.assets[graphic.id];
    const rawDataUrl = asset?.rawDataUrl || asset?.dataUrl;
    if (!rawDataUrl) continue;

    const processed = await removeBackground(graphic, state.season, rawDataUrl, log, onEvent);
    const response = await state.bridge.saveProcessedGraphic(
      graphic.id,
      processed.dataUrl,
      processed.notes,
      processed.width,
      processed.height,
    );
    if (!response.ok) {
      throw new Error(response.message || `Failed to save processed ${graphic.label}.`);
    }
    if (onGraphicProcessed) {
      await onGraphicProcessed(graphic, response);
    }
  }
}
