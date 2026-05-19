import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { open } from "../../lib/envelope-cipher.js";
import { AppError } from "../../lib/app-error.js";
import { aiProviderKeys } from "../../db/schema.js";

/**
 * Maps a stored provider key configuration to a Vercel AI SDK model instance.
 * Decrypts the API key using envelope-cipher.
 */
export function resolveModel(providerKey: typeof aiProviderKeys.$inferSelect) {
  let apiKey: string;
  try {
    const blob = JSON.parse(providerKey.apiKeyEncrypted);
    apiKey = open(blob);
  } catch (err) {
    throw AppError.masterKeyUnavailable();
  }

  switch (providerKey.provider) {
    case "anthropic":
      return anthropic(providerKey.modelDefault);
    case "openai":
      return openai(providerKey.modelDefault);
    case "ollama":
      return createOpenAICompatible({
        name: "ollama",
        baseURL: providerKey.endpointUrl ?? "http://localhost:11434/v1",
      }).chatModel(providerKey.modelDefault);
    default:
      throw AppError.badRequest(`Unknown provider: ${providerKey.provider}`);
  }
}
