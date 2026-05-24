import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { open } from "../../lib/envelope-cipher.js";
import { AppError } from "../../lib/app-error.js";
import { aiProviderKeys } from "../../db/schema.js";
import { validateEndpointUrl } from "../../lib/url-validator.js";

export async function resolveModel(providerKey: typeof aiProviderKeys.$inferSelect) {
  if (providerKey.endpointUrl) {
    await validateEndpointUrl(providerKey.endpointUrl);
  }

  let apiKey: string | undefined;
  if (providerKey.apiKeyEncrypted) {
    try {
      const blob = JSON.parse(providerKey.apiKeyEncrypted);
      apiKey = open(blob);
    } catch (err) {
      throw AppError.masterKeyUnavailable();
    }
  }

  switch (providerKey.provider) {
    case "anthropic": {
      const opts: Parameters<typeof anthropic>[1] = {};
      if (apiKey) opts.apiKey = apiKey;
      if (providerKey.endpointUrl) opts.baseURL = providerKey.endpointUrl;
      return anthropic(providerKey.modelDefault, opts);
    }
    case "openai": {
      const opts: Parameters<typeof openai>[1] = {};
      if (apiKey) opts.apiKey = apiKey;
      if (providerKey.endpointUrl) opts.baseURL = providerKey.endpointUrl;
      return openai(providerKey.modelDefault, opts);
    }
    case "ollama":
      return createOpenAICompatible({
        name: "ollama",
        baseURL: providerKey.endpointUrl ?? "http://localhost:11434/v1",
      }).chatModel(providerKey.modelDefault);
    case "openai-compatible":
      return createOpenAICompatible({
        name: "openai-compatible",
        baseURL: providerKey.endpointUrl ?? "",
        ...(apiKey ? { apiKey } : {}),
      }).chatModel(providerKey.modelDefault);
    default:
      throw AppError.badRequest(`Unknown provider: ${providerKey.provider}`);
  }
}
