/**
 * Vertex AI Provider for Generate API Route
 *
 * Handles image generation and video generation using Google's Vertex AI API models.
 * Uses GCP ADC (Application Default Credentials): GOOGLE_APPLICATION_CREDENTIALS or gcloud auth.
 */

import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { GenerateResponse } from "@/types";
import { GenerationOutput } from "@/lib/providers/types";
import fs from "fs";
import path from "path";

/**
 * ============================================================
 * DAILY COST TRACKER
 * ============================================================
 */

const DAILY_COST_FILE = path.join(
  process.cwd(),
  "data",
  "daily-cost.json"
);

/**
 * Uses Italy local date so the daily counter resets at midnight
 * in Europe/Rome rather than at UTC midnight.
 */
function getLocalDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getDailyCost(): {
  date: string;
  total: number;
} {
  const today = getLocalDate();

  try {
    if (!fs.existsSync(DAILY_COST_FILE)) {
      return {
        date: today,
        total: 0,
      };
    }

    const data = JSON.parse(
      fs.readFileSync(DAILY_COST_FILE, "utf8")
    );

    // New day → reset
    if (data.date !== today) {
      return {
        date: today,
        total: 0,
      };
    }

    return {
      date: today,
      total: Number(data.total) || 0,
    };
  } catch {
    return {
      date: today,
      total: 0,
    };
  }
}

function addDailyCost(cost: number): number {
  const today = getLocalDate();
  const current = getDailyCost();

  const total = current.total + cost;

  const directory = path.dirname(DAILY_COST_FILE);

  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, {
      recursive: true,
    });
  }

  fs.writeFileSync(
    DAILY_COST_FILE,
    JSON.stringify(
      {
        date: today,
        total: Number(total.toFixed(6)),
      },
      null,
      2
    )
  );

  return total;
}

/**
 * ============================================================
 * VERTEX CONFIG
 * ============================================================
 */

/**
 * Extract Vertex AI configuration from request headers or environment variables
 */
function getVertexConfig(
  request: Request
): {
  project: string;
  location: string;
} {
  const DEFAULT_LOCATION = "us-central1";

  const project =
    request.headers.get("X-Vertex-Project-Id") ||
    process.env.VERTEX_PROJECT_ID ||
    "";

  const location =
    request.headers.get("X-Vertex-Location") ||
    process.env.VERTEX_LOCATION ||
    DEFAULT_LOCATION;

  if (!project) {
    throw new Error(
      "Vertex AI not configured. Set VERTEX_PROJECT_ID in .env.local or configure in Settings."
    );
  }

  return {
    project,
    location,
  };
}

/**
 * Some preview models are ONLY available in the "global" location on Vertex AI.
 * Returns the effective location based on the model.
 */
function getEffectiveLocation(
  config: {
    project: string;
    location: string;
  },
  model: string
): {
  project: string;
  location: string;
} {
  const GLOBAL_LOCATION_MODELS = [
    "vertex/nano-banana-pro",
    "vertex/nano-banana-2",
    "vertex/nano-banana-2-lite",
  ];

  if (GLOBAL_LOCATION_MODELS.includes(model)) {
    return {
      project: config.project,
      location: "global",
    };
  }

  const location =
    config.location === "global"
      ? "us-central1"
      : config.location;

  return {
    project: config.project,
    location,
  };
}

/**
 * ============================================================
 * IMAGE MODELS
 * ============================================================
 */

const MODEL_MAP: Record<string, string> = {
  "vertex/nano-banana":
    "gemini-2.5-flash-image",

  "vertex/nano-banana-pro":
    "gemini-3-pro-image",

  "vertex/nano-banana-2":
    "gemini-3.1-flash-image",

  "vertex/nano-banana-2-lite":
    "gemini-3.1-flash-lite-image",
};

/**
 * Calculate image-generation cost.
 *
 * Current Google Standard pricing:
 *
 * Nano Banana 2:
 *   Input:       $0.50 / 1M tokens
 *   Text output: $3.00 / 1M tokens
 *   Image output: $60 / 1M image tokens
 *
 * Nano Banana 2 Lite:
 *   Input:       $0.25 / 1M tokens
 *   Text output: $1.50 / 1M tokens
 *   Image output: $30 / 1M image tokens
 *
 * Nano Banana Pro:
 *   Input:       $2.00 / 1M tokens
 *   Text output: $12.00 / 1M tokens
 *   Image output: $120 / 1M image tokens
 *
 * Nano Banana / Gemini 2.5 Flash Image:
 *   Input:       $0.30 / 1M tokens
 *   Text output: $2.50 / 1M tokens
 *   Image output: $30 / 1M image tokens
 */
function calculateImageGenerationCost(
  model: string,
  promptTokenCount: number,
  outputImageTokens: number,
  outputTextTokens: number
): number {
  let inputPricePerMillion = 0.50;
  let outputImagePricePerMillion = 60.00;
  let outputTextPricePerMillion = 3.00;

  switch (model) {
    case "vertex/nano-banana-2":
      inputPricePerMillion = 0.50;
      outputImagePricePerMillion = 60.00;
      outputTextPricePerMillion = 3.00;
      break;

    case "vertex/nano-banana-2-lite":
      inputPricePerMillion = 0.25;
      outputImagePricePerMillion = 30.00;
      outputTextPricePerMillion = 1.50;
      break;

    case "vertex/nano-banana-pro":
      inputPricePerMillion = 2.00;
      outputImagePricePerMillion = 120.00;
      outputTextPricePerMillion = 12.00;
      break;

    case "vertex/nano-banana":
      inputPricePerMillion = 0.30;
      outputImagePricePerMillion = 30.00;
      outputTextPricePerMillion = 2.50;
      break;

    default:
      break;
  }

  const inputCost =
    (promptTokenCount / 1_000_000) *
    inputPricePerMillion;

  const outputImageCost =
    (outputImageTokens / 1_000_000) *
    outputImagePricePerMillion;

  const outputTextCost =
    (outputTextTokens / 1_000_000) *
    outputTextPricePerMillion;

  return (
    inputCost +
    outputImageCost +
    outputTextCost
  );
}

/**
 * ============================================================
 * GENERATE IMAGE
 * ============================================================
 */

export async function generateWithVertex(
  requestId: string,
  request: Request,
  prompt: string,
  images: string[],
  model: string,
  aspectRatio?: string,
  resolution?: string,
  useGoogleSearch?: boolean,
  useImageSearch?: boolean
): Promise<NextResponse<GenerateResponse>> {
  console.log(
    `[API:${requestId}] Vertex AI generation - Model: ${model}, Images: ${images?.length || 0}, Prompt: ${prompt?.length || 0} chars`
  );

  // Extract base64 data and MIME types from data URLs
  const imageData = (images || []).map((image, idx) => {
    if (image.includes("base64,")) {
      const [header, data] = image.split("base64,");

      const mimeMatch = header.match(
        /data:([^;]+)/
      );

      const mimeType = mimeMatch
        ? mimeMatch[1]
        : "image/png";

      console.log(
        `[API:${requestId}]   Image ${idx + 1}: ${mimeType}, ${(data.length / 1024).toFixed(1)}KB`
      );

      return {
        data,
        mimeType,
      };
    }

    console.log(
      `[API:${requestId}]   Image ${idx + 1}: raw, ${(image.length / 1024).toFixed(1)}KB`
    );

    return {
      data: image,
      mimeType: "image/png",
    };
  });

  // Initialize Vertex AI client
  const vertexConfig = getVertexConfig(request);

  const effectiveConfig = getEffectiveLocation(
    vertexConfig,
    model
  );

  const ai = new GoogleGenAI({
    vertexai: true,
    project: effectiveConfig.project,
    location: effectiveConfig.location,
  });

  // Build request parts
  const requestParts: Array<
    | { text: string }
    | {
        inlineData: {
          mimeType: string;
          data: string;
        };
      }
  > = [
    {
      text: prompt,
    },
    ...imageData.map(({ data, mimeType }) => ({
      inlineData: {
        mimeType,
        data,
      },
    })),
  ];

  // Build config
  const config: Record<string, unknown> = {
    responseModalities: ["IMAGE", "TEXT"],
  };

  if (aspectRatio) {
    config.imageConfig = {
      aspectRatio,
    };
  }

  if (
    (model === "vertex/nano-banana-pro" ||
      model === "vertex/nano-banana-2") &&
    resolution
  ) {
    if (!config.imageConfig) {
      config.imageConfig = {};
    }

    (
      config.imageConfig as Record<string, unknown>
    ).imageSize = resolution;
  }

  // Search tools
  const tools = [];

  if (
    model === "vertex/nano-banana-2" &&
    (useGoogleSearch || useImageSearch)
  ) {
    const searchTypes: Record<
      string,
      Record<string, never>
    > = {};

    if (useGoogleSearch) {
      searchTypes.webSearch = {};
    }

    if (useImageSearch) {
      searchTypes.imageSearch = {};
    }

    tools.push({
      googleSearch: {
        searchTypes,
      },
    });
  } else if (
    model === "vertex/nano-banana-pro" &&
    useGoogleSearch
  ) {
    tools.push({
      googleSearch: {},
    });
  }

  console.log(
    `[API:${requestId}] Config: ${JSON.stringify(config)}`
  );

  // Map model ID
  const apiModelId = MODEL_MAP[model];

  if (!apiModelId) {
    console.error(
      `[API:${requestId}] Unknown Vertex AI model: ${model}`
    );

    return NextResponse.json<GenerateResponse>(
      {
        success: false,
        error: `Unknown Vertex AI model: ${model}`,
      },
      {
        status: 500,
      }
    );
  }

  // ==========================================================
  // MAKE REQUEST
  // ==========================================================

  const vertexStartTime = Date.now();

  let response;

  try {
    response = await ai.models.generateContent({
      model: apiModelId,
      contents: [
        {
          role: "user",
          parts: requestParts,
        },
      ],
      config,
      ...(tools.length > 0 && { tools }),
    });
  } catch (error) {
    const msg =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      `[API:${requestId}] Vertex AI request failed: ${msg}`
    );

    return NextResponse.json<GenerateResponse>(
      {
        success: false,
        error: `Vertex AI request failed: ${msg}`,
      },
      {
        status: 500,
      }
    );
  }

  const vertexDuration =
    Date.now() - vertexStartTime;

  console.log(
    `[API:${requestId}] Vertex AI API completed in ${vertexDuration}ms`
  );

  // ==========================================================
  // RESPONSE INFO
  // ==========================================================

  const usage = response.usageMetadata;

  const promptTokenCount =
    usage?.promptTokenCount ?? 0;

  const candidatesTokenCount =
    usage?.candidatesTokenCount ?? 0;

  const totalTokenCount =
    usage?.totalTokenCount ?? 0;

  const promptTokensDetails =
    usage?.promptTokensDetails ?? [];

  const candidatesTokensDetails =
    usage?.candidatesTokensDetails ?? [];

  const inputImageTokens =
    promptTokensDetails
      .filter(
        (item) => item.modality === "IMAGE"
      )
      .reduce(
        (sum, item) =>
          sum + (item.tokenCount ?? 0),
        0
      );

  const inputTextTokens =
    promptTokensDetails
      .filter(
        (item) => item.modality === "TEXT"
      )
      .reduce(
        (sum, item) =>
          sum + (item.tokenCount ?? 0),
        0
      );

  const outputImageTokens =
    candidatesTokensDetails
      .filter(
        (item) => item.modality === "IMAGE"
      )
      .reduce(
        (sum, item) =>
          sum + (item.tokenCount ?? 0),
        0
      );

  const outputTextTokens =
    candidatesTokensDetails
      .filter(
        (item) => item.modality === "TEXT"
      )
      .reduce(
        (sum, item) =>
          sum + (item.tokenCount ?? 0),
        0
      );

  // ==========================================================
  // COST
  // ==========================================================

  const totalGenerationCost =
    calculateImageGenerationCost(
      model,
      promptTokenCount,
      outputImageTokens,
      outputTextTokens
    );

  // ==========================================================
  // CLEAN LOG
  // ==========================================================

  console.log(
    `[API:${requestId}] ─────────────────────────────────────`
  );

  console.log(
    `[API:${requestId}] Model: ${response.modelVersion ?? apiModelId}`
  );

  console.log(
    `[API:${requestId}] Response ID: ${response.responseId ?? "N/A"}`
  );

  console.log(
    `[API:${requestId}] Duration: ${(vertexDuration / 1000).toFixed(2)}s`
  );

  console.log(
    `[API:${requestId}] Tokens: ${totalTokenCount.toLocaleString()} total`
  );

  console.log(
    `[API:${requestId}]   Input:  ${promptTokenCount.toLocaleString()}`
  );

  console.log(
    `[API:${requestId}]     Text:  ${inputTextTokens.toLocaleString()}`
  );

  console.log(
    `[API:${requestId}]     Image: ${inputImageTokens.toLocaleString()}`
  );

  console.log(
    `[API:${requestId}]   Output: ${candidatesTokenCount.toLocaleString()}`
  );

  console.log(
    `[API:${requestId}]     Text:  ${outputTextTokens.toLocaleString()}`
  );

  console.log(
    `[API:${requestId}]     Image: ${outputImageTokens.toLocaleString()}`
  );

  console.log(
    `[API:${requestId}] Cost: $${totalGenerationCost.toFixed(4)}`
  );

  // ==========================================================
  // SAFETY / RESPONSE CHECK
  // ==========================================================

  const candidates = response.candidates;

  if (
    !candidates ||
    candidates.length === 0
  ) {
    console.error(
      `[API:${requestId}] No candidates in Vertex AI response`
    );

    if (response.promptFeedback) {
      console.error(
        `[API:${requestId}] Prompt feedback:`,
        response.promptFeedback
      );
    }

    return NextResponse.json<GenerateResponse>(
      {
        success: false,
        error: "No response from AI model",
      },
      {
        status: 500,
      }
    );
  }

  const parts =
    candidates[0].content?.parts;

  console.log(
    `[API:${requestId}] Response parts: ${parts?.length || 0}`
  );

  if (!parts) {
    console.error(
      `[API:${requestId}] No parts in Vertex AI candidate content`
    );

    return NextResponse.json<GenerateResponse>(
      {
        success: false,
        error: "No content in response",
      },
      {
        status: 500,
      }
    );
  }

  // ==========================================================
  // FIND IMAGE
  // ==========================================================

  for (const part of parts) {
    if (
      part.inlineData &&
      part.inlineData.data
    ) {
      const mimeType =
        part.inlineData.mimeType ||
        "image/png";

      const imgData =
        part.inlineData.data;

      const imageSizeKB =
        (imgData.length / 1024).toFixed(1);

      console.log(
        `[API:${requestId}] Output image: ${mimeType}, ${imageSizeKB}KB`
      );

      const dataUrl =
        `data:${mimeType};base64,${imgData}`;

      const responsePayload = {
        success: true,
        image: dataUrl,
      };

      const responseSize =
        JSON.stringify(responsePayload).length;

      const responseSizeMB =
        (
          responseSize /
          (1024 * 1024)
        ).toFixed(2);

      if (
        responseSize >
        4.5 * 1024 * 1024
      ) {
        console.warn(
          `[API:${requestId}] Response size (${responseSizeMB}MB) approaching Next.js 5MB limit`
        );
      }

      // ========================================================
      // DAILY COST
      // Only count successful generations
      // ========================================================

      const dailyTotal =
        addDailyCost(
          totalGenerationCost
        );

      console.log(
        `[API:${requestId}] Today: $${dailyTotal.toFixed(4)}`
      );

      console.log(
        `[API:${requestId}] ─────────────────────────────────────`
      );

      console.log(
        `[API:${requestId}] SUCCESS - Returning ${responseSizeMB}MB payload`
      );

      return NextResponse.json<GenerateResponse>(
        responsePayload
      );
    }
  }

  // ==========================================================
  // TEXT ERROR
  // ==========================================================

  for (const part of parts) {
    if (part.text) {
      console.error(
        `[API:${requestId}] Vertex AI returned text instead of image: ${part.text.substring(0, 100)}`
      );

      return NextResponse.json<GenerateResponse>(
        {
          success: false,
          error: `Model returned text instead of image: ${part.text.substring(0, 200)}`,
        },
        {
          status: 500,
        }
      );
    }
  }

  console.error(
    `[API:${requestId}] No image or text found in Vertex AI response`
  );

  return NextResponse.json<GenerateResponse>(
    {
      success: false,
      error: "No image in response",
    },
    {
      status: 500,
    }
  );
}

/**
 * ============================================================
 * VEO MODELS
 * ============================================================
 */

const VEO_MODEL_MAP: Record<string, string> = {
  "vertex/veo-3.1/text-to-video":
    "veo-3.1-generate-001",

  "vertex/veo-3.1/image-to-video":
    "veo-3.1-generate-001",

  "vertex/veo-3.1-fast/text-to-video":
    "veo-3.1-fast-generate-001",

  "vertex/veo-3.1-fast/image-to-video":
    "veo-3.1-fast-generate-001",
};

/**
 * Calculate Veo generation cost.
 *
 * Google Standard pricing is charged per generated video second.
 *
 * Veo 3.1:
 *   Video:
 *     720p / 1080p = $0.20/sec
 *     4K            = $0.40/sec
 *
 *   Video + Audio:
 *     720p / 1080p = $0.40/sec
 *     4K            = $0.60/sec
 *
 * Veo 3.1 Fast:
 *   Video:
 *     720p = $0.08/sec
 *     1080p = $0.10/sec
 *     4K = $0.25/sec
 *
 *   Video + Audio:
 *     720p = $0.10/sec
 *     1080p = $0.12/sec
 *     4K = $0.30/sec
 */
function calculateVeoCost(
  modelId: string,
  durationSeconds: number,
  resolution: string | undefined,
  generateAudio: boolean
): number {
  const isFast =
    modelId.includes("veo-3.1-fast");

  const normalizedResolution =
    String(resolution || "1080p")
      .toLowerCase()
      .replace(" ", "");

  const is4K =
    normalizedResolution.includes("4k") ||
    normalizedResolution.includes("2160");

  const is1080 =
    normalizedResolution.includes("1080");

  let pricePerSecond = 0;

  if (isFast) {
    if (generateAudio) {
      if (is4K) {
        pricePerSecond = 0.30;
      } else if (is1080) {
        pricePerSecond = 0.12;
      } else {
        pricePerSecond = 0.10;
      }
    } else {
      if (is4K) {
        pricePerSecond = 0.25;
      } else if (is1080) {
        pricePerSecond = 0.10;
      } else {
        pricePerSecond = 0.08;
      }
    }
  } else {
    if (generateAudio) {
      if (is4K) {
        pricePerSecond = 0.60;
      } else {
        pricePerSecond = 0.40;
      }
    } else {
      if (is4K) {
        pricePerSecond = 0.40;
      } else {
        pricePerSecond = 0.20;
      }
    }
  }

  return durationSeconds * pricePerSecond;
}

/**
 * ============================================================
 * GENERATE VIDEO
 * ============================================================
 */

export async function generateWithVertexVideo(
  requestId: string,
  request: Request,
  modelId: string,
  prompt: string,
  images: string[],
  parameters: Record<string, unknown> = {},
): Promise<GenerationOutput> {
  const apiModelId =
    VEO_MODEL_MAP[modelId];

  if (!apiModelId) {
    return {
      success: false,
      error: `Unknown Veo model: ${modelId}`,
    };
  }

  console.log(
    `[API:${requestId}] Vertex AI video generation - Model: ${apiModelId}, Prompt: ${prompt?.length || 0} chars, Images: ${images?.length || 0}`
  );

  // Initialize Vertex AI client
  const vertexConfig =
    getVertexConfig(request);

  const effectiveConfig =
    getEffectiveLocation(
      vertexConfig,
      modelId
    );

  const ai = new GoogleGenAI({
    vertexai: true,
    project: effectiveConfig.project,
    location: effectiveConfig.location,
  });

  // ==========================================================
  // BUILD CONFIG
  // ==========================================================

  const config: Record<string, unknown> = {
    numberOfVideos: 1,
  };

  if (parameters.aspectRatio) {
    config.aspectRatio =
      parameters.aspectRatio;
  }

  if (parameters.durationSeconds) {
    config.durationSeconds =
      Number(parameters.durationSeconds);
  }

  if (parameters.resolution) {
    config.resolution =
      parameters.resolution;
  }

  if (parameters.negativePrompt) {
    config.negativePrompt =
      parameters.negativePrompt;
  }

  if (
    parameters.seed !== undefined &&
    parameters.seed !== null &&
    parameters.seed !== ""
  ) {
    config.seed =
      Number(parameters.seed);
  }

  // Preserve generateAudio if the caller provides it.
  if (
    parameters.generateAudio !==
      undefined &&
    parameters.generateAudio !== null
  ) {
    config.generateAudio =
      Boolean(parameters.generateAudio);
  }

  // ==========================================================
  // BUILD REQUEST
  // ==========================================================

  const requestArgs: Record<string, unknown> = {
    model: apiModelId,
    prompt,
    config,
  };

  // Validate image-to-video
  if (
    modelId.includes("image-to-video") &&
    (!images ||
      images.length === 0)
  ) {
    console.error(
      `[API:${requestId}] Image required for image-to-video model: ${modelId}`
    );

    return {
      success: false,
      error:
        "Image required for image-to-video model",
    };
  }

  // Add image
  if (
    images &&
    images.length > 0 &&
    modelId.includes("image-to-video")
  ) {
    const imageInput = images[0];

    if (imageInput.includes("base64,")) {
      const [
        header,
        data,
      ] = imageInput.split("base64,");

      const mimeMatch =
        header.match(/data:([^;]+)/);

      const mimeType =
        mimeMatch
          ? mimeMatch[1]
          : "image/png";

      requestArgs.image = {
        imageBytes: data,
        mimeType,
      };
    } else {
      requestArgs.image = {
        imageBytes: imageInput,
        mimeType: "image/png",
      };
    }
  }

  console.log(
    `[API:${requestId}] Veo config: ${JSON.stringify(config)}`
  );

  // ==========================================================
  // START GENERATION
  // ==========================================================

  const startTime = Date.now();

  let operation;

  try {
    operation =
      await ai.models.generateVideos(
        requestArgs as unknown as Parameters<
          typeof ai.models.generateVideos
        >[0]
      );

    const POLL_INTERVAL =
      10_000;

    const TIMEOUT =
      5 * 60 * 1000;

    while (!operation.done) {
      const elapsed =
        Date.now() - startTime;

      if (elapsed > TIMEOUT) {
        console.error(
          `[API:${requestId}] Veo generation timed out after ${(elapsed / 1000).toFixed(0)}s`
        );

        return {
          success: false,
          error:
            "Video generation timed out after 5 minutes",
        };
      }

      console.log(
        `[API:${requestId}] Veo polling... (${(elapsed / 1000).toFixed(0)}s elapsed)`
      );

      await new Promise(
        (resolve) =>
          setTimeout(
            resolve,
            POLL_INTERVAL
          )
      );

      operation =
        await ai.operations.getVideosOperation(
          {
            operation,
          }
        );
    }
  } catch (error) {
    const msg =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      `[API:${requestId}] Veo generation failed: ${msg}`
    );

    return {
      success: false,
      error: `Video generation failed: ${msg}`,
    };
  }

  const duration =
    Date.now() - startTime;

  console.log(
    `[API:${requestId}] Veo generation completed in ${(duration / 1000).toFixed(1)}s`
  );

  // ==========================================================
  // EXTRACT VIDEO
  // ==========================================================

  const generatedVideos =
    operation.response
      ?.generatedVideos;

  if (
    !generatedVideos ||
    generatedVideos.length === 0
  ) {
    console.error(
      `[API:${requestId}] No generated videos in Veo response`
    );

    return {
      success: false,
      error:
        "No video generated. The content may have been filtered by safety policies.",
    };
  }

  const video =
    generatedVideos[0]?.video;

  if (!video) {
    console.error(
      `[API:${requestId}] No video object in Veo response`
    );

    return {
      success: false,
      error: "No video in response",
    };
  }

  // ==========================================================
  // COST CALCULATION
  // ==========================================================

  const videoDurationSeconds =
    Number(
      parameters.durationSeconds ||
        8
    );

  const videoResolution =
    parameters.resolution
      ? String(parameters.resolution)
      : "1080p";

  const generateAudio =
    parameters.generateAudio === true;

  const videoCost =
    calculateVeoCost(
      modelId,
      videoDurationSeconds,
      videoResolution,
      generateAudio
    );

  console.log(
    `[API:${requestId}] ─────────────────────────────────────`
  );

  console.log(
    `[API:${requestId}] Model: ${apiModelId}`
  );

  console.log(
    `[API:${requestId}] Duration: ${videoDurationSeconds}s`
  );

  console.log(
    `[API:${requestId}] Resolution: ${videoResolution}`
  );

  console.log(
    `[API:${requestId}] Audio: ${generateAudio ? "ON" : "OFF"}`
  );

  console.log(
    `[API:${requestId}] Cost: $${videoCost.toFixed(4)}`
  );

  // ==========================================================
  // VIDEO AS BASE64
  // ==========================================================

  if (video.videoBytes) {
    const mimeType =
      video.mimeType ||
      "video/mp4";

    const dataUrl =
      `data:${mimeType};base64,${video.videoBytes}`;

    const sizeKB =
      (
        video.videoBytes.length /
        1024
      ).toFixed(1);

    console.log(
      `[API:${requestId}] Video received as base64: ${sizeKB}KB`
    );

    // Successful generation → update daily total
    const dailyTotal =
      addDailyCost(videoCost);

    console.log(
      `[API:${requestId}] Today: $${dailyTotal.toFixed(4)}`
    );

    console.log(
      `[API:${requestId}] ─────────────────────────────────────`
    );

    return {
      success: true,
      outputs: [
        {
          type: "video",
          data: dataUrl,
        },
      ],
    };
  }

  // ==========================================================
  // VIDEO AS GCS URI
  // ==========================================================

  const videoUri =
    video.uri;

  if (!videoUri) {
    console.error(
      `[API:${requestId}] No video URI or bytes in Veo response`
    );

    return {
      success: false,
      error:
        "No video data in response",
    };
  }

  console.log(
    `[API:${requestId}] Fetching video from GCS URI...`
  );

  const controller =
    new AbortController();

  const fetchTimeout =
    setTimeout(
      () => controller.abort(),
      60_000
    );

  try {
    const videoResponse =
      await fetch(
        videoUri,
        {
          signal:
            controller.signal,
        }
      );

    if (!videoResponse.ok) {
      console.error(
        `[API:${requestId}] Failed to fetch video: ${videoResponse.status}`
      );

      return {
        success: false,
        error: `Failed to download generated video: ${videoResponse.status}`,
      };
    }

    const videoBuffer =
      await videoResponse.arrayBuffer();

    const videoSizeMB =
      (
        videoBuffer.byteLength /
        (1024 * 1024)
      ).toFixed(2);

    console.log(
      `[API:${requestId}] Video downloaded: ${videoSizeMB}MB`
    );

    const base64Video =
      Buffer.from(
        videoBuffer
      ).toString("base64");

    const dataUrl =
      `data:video/mp4;base64,${base64Video}`;

    // Successful generation → update daily total
    const dailyTotal =
      addDailyCost(videoCost);

    console.log(
      `[API:${requestId}] Today: $${dailyTotal.toFixed(4)}`
    );

    console.log(
      `[API:${requestId}] ─────────────────────────────────────`
    );

    console.log(
      `[API:${requestId}] SUCCESS - Returning ${videoSizeMB}MB video`
    );

    return {
      success: true,
      outputs: [
        {
          type: "video",
          data: dataUrl,
        },
      ],
    };
  } catch (error) {
    console.error(
      `[API:${requestId}] Failed to download video: ${error}`
    );

    return {
      success: false,
      error:
        "Failed to download generated video",
    };
  } finally {
    clearTimeout(fetchTimeout);
  }
}