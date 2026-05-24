import { Router } from "express";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { aiProviderKeys } from "../db/schema.js";
import { AppError } from "../lib/app-error.js";
import { seal } from "../lib/envelope-cipher.js";
import { generateText } from "ai";
import { resolveModel } from "../services/ai/providers.js";
import { getOperatorId } from "../lib/get-operator-id.js";
import { randomUUID } from "node:crypto";
import { validateEndpointUrl } from "../lib/url-validator.js";

export const aiProvidersRouter = Router();

const providerSchema = z.union([
  z.object({
    provider: z.enum(["anthropic", "openai", "ollama"]),
    modelDefault: z.string().min(1),
    endpointUrl: z.string().url().nullable().optional(),
    apiKey: z.string().min(1),
    rateCardInputPerMtok: z.number().nonnegative().optional(),
    rateCardOutputPerMtok: z.number().nonnegative().optional(),
  }),
  z.object({
    provider: z.literal("openai-compatible"),
    modelDefault: z.string().min(1),
    endpointUrl: z.string().url(),
    apiKey: z.string().optional(),
    rateCardInputPerMtok: z.number().nonnegative().optional(),
    rateCardOutputPerMtok: z.number().nonnegative().optional(),
  }),
]);

// GET /api/ai/providers
aiProvidersRouter.get("/", async (req, res) => {
  const rows = await db.select({
    id: aiProviderKeys.id,
    provider: aiProviderKeys.provider,
    modelDefault: aiProviderKeys.modelDefault,
    endpointUrl: aiProviderKeys.endpointUrl,
    isActive: aiProviderKeys.isActive,
    rateCardInputPerMtok: aiProviderKeys.rateCardInputPerMtok,
    rateCardOutputPerMtok: aiProviderKeys.rateCardOutputPerMtok,
    createdAt: aiProviderKeys.createdAt,
    rotatedAt: aiProviderKeys.rotatedAt,
  }).from(aiProviderKeys);
  res.json(rows);
});

// POST /api/ai/providers
aiProvidersRouter.post("/", async (req, res) => {
  const userId = getOperatorId(req);

  const parsed = providerSchema.safeParse(req.body);
  if (!parsed.success) {
    throw AppError.badRequest(parsed.error.message);
  }

  const { apiKey, ...rest } = parsed.data;

  if (rest.endpointUrl) {
    await validateEndpointUrl(rest.endpointUrl);
  }

  const id = randomUUID();
  const apiKeyEncrypted = apiKey ? JSON.stringify(seal(apiKey)) : null;

  await db.transaction(async (tx) => {
    await tx.update(aiProviderKeys)
      .set({ isActive: false })
      .where(and(eq(aiProviderKeys.provider, rest.provider), eq(aiProviderKeys.isActive, true)));

    await tx.insert(aiProviderKeys).values({
      id,
      ...rest,
      apiKeyEncrypted,
      isActive: true,
      createdAt: new Date().toISOString(),
    });
  });

  res.status(201).json({ id });
});

// DELETE /api/ai/providers/:id
aiProvidersRouter.delete("/:id", async (req, res) => {
  const userId = getOperatorId(req);

  await db.update(aiProviderKeys)
    .set({ isActive: false })
    .where(eq(aiProviderKeys.id, req.params.id));

  res.status(204).end();
});

// POST /api/ai/providers/:id/test
aiProvidersRouter.post("/:id/test", async (req, res) => {
  const [providerKey] = await db
    .select()
    .from(aiProviderKeys)
    .where(eq(aiProviderKeys.id, req.params.id))
    .limit(1);

  if (!providerKey) {
    throw AppError.notFound();
  }

  const model = await resolveModel(providerKey);
  const start = performance.now();
  try {
    await generateText({
      model,
      prompt: 'Reply with "ok".',
    });
    res.json({ ok: true, latencyMs: Math.round(performance.now() - start) });

  } catch (err) {
    res.json({ ok: false, latencyMs: Math.round(performance.now() - start), error: String(err) });
  }
});
