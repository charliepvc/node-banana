/**
 * API Header Builder Utilities
 *
 * Centralizes the duplicated header-building logic for API calls
 * across executeWorkflow and regenerateNode.
 */

import { ProviderType, ProviderSettings, LLMProvider } from "@/types";

/**
 * Header name mapping for each provider
 */
const PROVIDER_HEADER_MAP: Record<ProviderType, string> = {
  gemini: "X-Gemini-API-Key",
  vertex: "X-Vertex-Project-Id",
  replicate: "X-Replicate-API-Key",
  fal: "X-Fal-API-Key",
  kie: "X-Kie-Key",
  wavespeed: "X-WaveSpeed-Key",
  openai: "X-OpenAI-API-Key",
  anthropic: "X-Anthropic-API-Key",
};

/**
 * Build headers for image/video generation API calls.
 * Adds the appropriate API key header based on the provider.
 */
export function buildGenerateHeaders(
  provider: ProviderType | string,
  providerSettings: ProviderSettings
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const providerKey = provider as ProviderType;
  
  // Vertex AI: special handling - stores project+location as JSON in apiKey
  if (providerKey === "vertex") {
    const config = providerSettings.providers.vertex;
    if (config?.apiKey) {
      try {
        const parsed = JSON.parse(config.apiKey);
        if (parsed.project) headers["X-Vertex-Project-Id"] = parsed.project;
        if (parsed.location) headers["X-Vertex-Location"] = parsed.location;
      } catch {
        // If not JSON, treat apiKey as raw project ID
        headers["X-Vertex-Project-Id"] = config.apiKey;
      }
    }
    return headers;
  }
  
  const headerName = PROVIDER_HEADER_MAP[providerKey];
  if (headerName) {
    const config = providerSettings.providers[providerKey];
    if (config?.apiKey) {
      headers[headerName] = config.apiKey;
    }
  }

  return headers;
}

/**
 * Build headers for LLM API calls.
 * Maps LLM provider names ("google", "openai") to their API key headers.
 */
export function buildLlmHeaders(
  llmProvider: LLMProvider | string,
  providerSettings: ProviderSettings
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Vertex AI LLM: special handling - stores project+location as JSON in apiKey
  if (llmProvider === "vertex") {
    const vertexConfig = providerSettings.providers.vertex;
    if (vertexConfig?.apiKey) {
      try {
        const parsed = JSON.parse(vertexConfig.apiKey);
        if (parsed.project) headers["X-Vertex-Project-Id"] = parsed.project;
        if (parsed.location) headers["X-Vertex-Location"] = parsed.location;
      } catch {
        headers["X-Vertex-Project-Id"] = vertexConfig.apiKey;
      }
    }
    return headers;
  }
  
  if (llmProvider === "google") {
    const geminiConfig = providerSettings.providers.gemini;
    if (geminiConfig?.apiKey) {
      headers["X-Gemini-API-Key"] = geminiConfig.apiKey;
    }
  } else if (llmProvider === "openai") {
    const openaiConfig = providerSettings.providers.openai;
    if (openaiConfig?.apiKey) {
      headers["X-OpenAI-API-Key"] = openaiConfig.apiKey;
    }
  } else if (llmProvider === "anthropic") {
    const anthropicConfig = providerSettings.providers.anthropic;
    if (anthropicConfig?.apiKey) {
      headers["X-Anthropic-API-Key"] = anthropicConfig.apiKey;
    }
  }

  return headers;
}
