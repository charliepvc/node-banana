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

/**
 * Extract Vertex AI configuration from request headers or environment variables
 */
function getVertexConfig(request: Request): { project: string; location: string } {
  const DEFAULT_LOCATION = "us-central1";
  const project = request.headers.get("X-Vertex-Project-Id")
    || process.env.VERTEX_PROJECT_ID
    || "";
  const location = request.headers.get("X-Vertex-Location")
    || process.env.VERTEX_LOCATION
    || DEFAULT_LOCATION;

  if (!project) {
    throw new Error("Vertex AI not configured. Set VERTEX_PROJECT_ID in .env.local or configure in Settings.");
  }

  // Credentials are resolved by @google/genai via ADC (Application Default Credentials):
  // 1. GOOGLE_APPLICATION_CREDENTIALS env var (service account JSON)
  // 2. gcloud auth application-default login
  // 3. Default service account (if running on GCP)
  return { project, location };
}

/**
 * Some preview models are ONLY available in the "global" location on Vertex AI.
 * Returns the effective location based on the model.
 */
function getEffectiveLocation(config: { project: string; location: string }, model: string): { project: string; location: string } {
  // Preview models only support "global" location on Vertex AI
  // GA Veo models (veo-3.1-generate-001, veo-3.1-fast-generate-001) are regional (us-central1)
  const GLOBAL_LOCATION_MODELS = [
    "vertex/nano-banana-pro",             // gemini-3-pro-image-preview
    "vertex/nano-banana-2",               // gemini-3.1-flash-image-preview
  ];

  const effectiveLocation = GLOBAL_LOCATION_MODELS.includes(model) ? "global" : config.location;
  return { project: config.project, location: effectiveLocation };
}

/**
 * Map Vertex AI model types to Gemini API model IDs
 * Model IDs include the vertex/ prefix for routing
 */
const MODEL_MAP: Record<string, string> = {
  "vertex/nano-banana": "gemini-2.5-flash-image",
  "vertex/nano-banana-pro": "gemini-3-pro-image-preview",
  "vertex/nano-banana-2": "gemini-3.1-flash-image-preview",
};

/**
 * Generate image using Vertex AI
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
  console.log(`[API:${requestId}] Vertex AI generation - Model: ${model}, Images: ${images?.length || 0}, Prompt: ${prompt?.length || 0} chars`);

  // Extract base64 data and MIME types from data URLs
  const imageData = (images || []).map((image, idx) => {
    if (image.includes("base64,")) {
      const [header, data] = image.split("base64,");
      // Extract MIME type from header (e.g., "data:image/png;" -> "image/png")
      const mimeMatch = header.match(/data:([^;]+)/);
      const mimeType = mimeMatch ? mimeMatch[1] : "image/png";
      console.log(`[API:${requestId}]   Image ${idx + 1}: ${mimeType}, ${(data.length / 1024).toFixed(1)}KB`);
      return { data, mimeType };
    }
    console.log(`[API:${requestId}]   Image ${idx + 1}: raw, ${(image.length / 1024).toFixed(1)}KB`);
    return { data: image, mimeType: "image/png" };
  });

  // Initialize Vertex AI client with model-aware location
  const vertexConfig = getVertexConfig(request);
  const effectiveConfig = getEffectiveLocation(vertexConfig, model);
  const ai = new GoogleGenAI({
    vertexai: true,
    project: effectiveConfig.project,
    location: effectiveConfig.location,
  });

  // Build request parts array with prompt and all images
  const requestParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: prompt },
    ...imageData.map(({ data, mimeType }) => ({
      inlineData: {
        mimeType,
        data,
      },
    })),
  ];

  // Build config object based on model capabilities
  const config: Record<string, unknown> = {
    responseModalities: ["IMAGE", "TEXT"],
  };

  // Add imageConfig for both models (both support aspect ratio)
  if (aspectRatio) {
    config.imageConfig = {
      aspectRatio,
    };
  }

  // Add resolution for Nano Banana Pro and Nano Banana 2
  if ((model === "vertex/nano-banana-pro" || model === "vertex/nano-banana-2") && resolution) {
    if (!config.imageConfig) {
      config.imageConfig = {};
    }
    (config.imageConfig as Record<string, unknown>).imageSize = resolution;
  }

  // Add tools array for Google Search (Nano Banana Pro and Nano Banana 2)
  const tools = [];
  if (model === "vertex/nano-banana-2" && (useGoogleSearch || useImageSearch)) {
    // Nano Banana 2 uses searchTypes to enable web and/or image search independently
    const searchTypes: Record<string, Record<string, never>> = {};
    if (useGoogleSearch) searchTypes.webSearch = {};
    if (useImageSearch) searchTypes.imageSearch = {};
    tools.push({ googleSearch: { searchTypes } });
  } else if (model === "vertex/nano-banana-pro" && useGoogleSearch) {
    tools.push({ googleSearch: {} });
  }

  console.log(`[API:${requestId}] Config: ${JSON.stringify(config)}`);

  // Map model ID to API model ID
  const apiModelId = MODEL_MAP[model];
  if (!apiModelId) {
    console.error(`[API:${requestId}] Unknown Vertex AI model: ${model}`);
    return NextResponse.json<GenerateResponse>(
      {
        success: false,
        error: `Unknown Vertex AI model: ${model}`,
      },
      { status: 500 }
    );
  }

  // Make request to Vertex AI
  const vertexStartTime = Date.now();

  const response = await ai.models.generateContent({
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

  const vertexDuration = Date.now() - vertexStartTime;
  console.log(`[API:${requestId}] Vertex AI API completed in ${vertexDuration}ms`);

  // Extract image from response
  const candidates = response.candidates;

  if (!candidates || candidates.length === 0) {
    console.error(`[API:${requestId}] No candidates in Vertex AI response`);
    return NextResponse.json<GenerateResponse>(
      {
        success: false,
        error: "No response from AI model",
      },
      { status: 500 }
    );
  }

  const parts = candidates[0].content?.parts;
  console.log(`[API:${requestId}] Response parts: ${parts?.length || 0}`);

  if (!parts) {
    console.error(`[API:${requestId}] No parts in Vertex AI candidate content`);
    return NextResponse.json<GenerateResponse>(
      {
        success: false,
        error: "No content in response",
      },
      { status: 500 }
    );
  }

  // Find image part in response
  for (const part of parts) {
    if (part.inlineData && part.inlineData.data) {
      const mimeType = part.inlineData.mimeType || "image/png";
      const imgData = part.inlineData.data;
      const imageSizeKB = (imgData.length / 1024).toFixed(1);

      console.log(`[API:${requestId}] Output image: ${mimeType}, ${imageSizeKB}KB`);

      const dataUrl = `data:${mimeType};base64,${imgData}`;

      const responsePayload = { success: true, image: dataUrl };
      const responseSize = JSON.stringify(responsePayload).length;
      const responseSizeMB = (responseSize / (1024 * 1024)).toFixed(2);

      if (responseSize > 4.5 * 1024 * 1024) {
        console.warn(`[API:${requestId}] Response size (${responseSizeMB}MB) approaching Next.js 5MB limit`);
      }

      console.log(`[API:${requestId}] SUCCESS - Returning ${responseSizeMB}MB payload`);

      return NextResponse.json<GenerateResponse>(responsePayload);
    }
  }

  // If no image found, check for text error
  for (const part of parts) {
    if (part.text) {
      console.error(`[API:${requestId}] Vertex AI returned text instead of image: ${part.text.substring(0, 100)}`);
      return NextResponse.json<GenerateResponse>(
        {
          success: false,
          error: `Model returned text instead of image: ${part.text.substring(0, 200)}`,
        },
        { status: 500 }
      );
    }
  }

  console.error(`[API:${requestId}] No image or text found in Vertex AI response`);
  return NextResponse.json<GenerateResponse>(
    {
      success: false,
      error: "No image in response",
    },
    { status: 500 }
  );
}

/**
 * Map Vertex AI Veo model IDs to Gemini API model IDs
 */
const VEO_MODEL_MAP: Record<string, string> = {
  "vertex/veo-3.1/text-to-video": "veo-3.1-generate-001",
  "vertex/veo-3.1/image-to-video": "veo-3.1-generate-001",
  "vertex/veo-3.1-fast/text-to-video": "veo-3.1-fast-generate-001",
  "vertex/veo-3.1-fast/image-to-video": "veo-3.1-fast-generate-001",
};

/**
 * Generate video using Vertex AI (Veo models)
 */
export async function generateWithVertexVideo(
  requestId: string,
  request: Request,
  modelId: string,
  prompt: string,
  images: string[],
  parameters: Record<string, unknown> = {},
): Promise<GenerationOutput> {
  const apiModelId = VEO_MODEL_MAP[modelId];
  if (!apiModelId) {
    return { success: false, error: `Unknown Veo model: ${modelId}` };
  }

  console.log(`[API:${requestId}] Vertex AI video generation - Model: ${apiModelId}, Prompt: ${prompt?.length || 0} chars, Images: ${images?.length || 0}`);

  // Initialize Vertex AI client with model-aware location
  const vertexConfig = getVertexConfig(request);
  const effectiveConfig = getEffectiveLocation(vertexConfig, modelId);
  const ai = new GoogleGenAI({
    vertexai: true,
    project: effectiveConfig.project,
    location: effectiveConfig.location,
  });

  // Build config from parameters
  const config: Record<string, unknown> = {
    numberOfVideos: 1,
  };

  if (parameters.aspectRatio) {
    config.aspectRatio = parameters.aspectRatio;
  }
  if (parameters.durationSeconds) {
    config.durationSeconds = Number(parameters.durationSeconds);
  }
  if (parameters.resolution) {
    config.resolution = parameters.resolution;
  }
  if (parameters.negativePrompt) {
    config.negativePrompt = parameters.negativePrompt;
  }
  if (parameters.seed !== undefined && parameters.seed !== null && parameters.seed !== "") {
    config.seed = Number(parameters.seed);
  }

  // Build request args
  const requestArgs: Record<string, unknown> = {
    model: apiModelId,
    prompt,
    config,
  };

  // Validate image-to-video models have an image
  if (modelId.includes("image-to-video") && (!images || images.length === 0)) {
    console.error(`[API:${requestId}] Image required for image-to-video model: ${modelId}`);
    return { success: false, error: "Image required for image-to-video model" };
  }

  // Add image for image-to-video models
  if (images && images.length > 0 && modelId.includes("image-to-video")) {
    const imageInput = images[0];
    if (imageInput.includes("base64,")) {
      const [header, data] = imageInput.split("base64,");
      const mimeMatch = header.match(/data:([^;]+)/);
      const mimeType = mimeMatch ? mimeMatch[1] : "image/png";
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

  console.log(`[API:${requestId}] Veo config: ${JSON.stringify(config)}`);

  // Start video generation (async operation)
  const startTime = Date.now();

  let operation;
  try {
    operation = await ai.models.generateVideos(requestArgs as unknown as Parameters<typeof ai.models.generateVideos>[0]);

    // Poll for completion (10s intervals, 5min timeout)
    const POLL_INTERVAL = 10_000;
    const TIMEOUT = 5 * 60 * 1000;

    while (!operation.done) {
      const elapsed = Date.now() - startTime;
      if (elapsed > TIMEOUT) {
        console.error(`[API:${requestId}] Veo generation timed out after ${(elapsed / 1000).toFixed(0)}s`);
        return { success: false, error: "Video generation timed out after 5 minutes" };
      }

      console.log(`[API:${requestId}] Veo polling... (${(elapsed / 1000).toFixed(0)}s elapsed)`);
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
      operation = await ai.operations.getVideosOperation({ operation });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[API:${requestId}] Veo generation failed: ${msg}`);
    return { success: false, error: `Video generation failed: ${msg}` };
  }

  const duration = Date.now() - startTime;
  console.log(`[API:${requestId}] Veo generation completed in ${(duration / 1000).toFixed(1)}s`);

  // Extract generated video
  const generatedVideos = operation.response?.generatedVideos;
  if (!generatedVideos || generatedVideos.length === 0) {
    console.error(`[API:${requestId}] No generated videos in Veo response`);
    return { success: false, error: "No video generated. The content may have been filtered by safety policies." };
  }

  const videoUri = generatedVideos[0]?.video?.uri;
  if (!videoUri) {
    console.error(`[API:${requestId}] No video URI in Veo response`);
    return { success: false, error: "No video URI in response" };
  }

  // Fetch the video (uses GCP credentials from environment - no API key needed for Vertex AI)
  console.log(`[API:${requestId}] Fetching video from URI...`);

  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const videoResponse = await fetch(videoUri, { signal: controller.signal });
    if (!videoResponse.ok) {
      console.error(`[API:${requestId}] Failed to fetch video: ${videoResponse.status}`);
      return { success: false, error: `Failed to download generated video: ${videoResponse.status}` };
    }

    const videoBuffer = await videoResponse.arrayBuffer();
    const videoSizeMB = (videoBuffer.byteLength / (1024 * 1024)).toFixed(2);
    console.log(`[API:${requestId}] Video downloaded: ${videoSizeMB}MB`);

    const base64Video = Buffer.from(videoBuffer).toString("base64");
    const dataUrl = `data:video/mp4;base64,${base64Video}`;

    console.log(`[API:${requestId}] SUCCESS - Returning ${videoSizeMB}MB video`);

    return {
      success: true,
      outputs: [{ type: "video", data: dataUrl }],
    };
  } catch (error) {
    console.error(`[API:${requestId}] Failed to download video: ${error}`);
    return { success: false, error: "Failed to download generated video" };
  } finally {
    clearTimeout(fetchTimeout);
  }
}
