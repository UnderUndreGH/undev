import { Router } from "express";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { aiProviderKeys } from "../db/schema.js";
import { AppError } from "../lib/app-error.js";
import { seal } from "../lib/envelope-cipher.js";
import { generateText } from "ai";
import { resolveModel } from "../services/ai/providers.js";
import { randomUUID } from "node:crypto";

export const aiProvidersRouter = Router();

const providerSchema = z.object({
  provider: z.enum(["anthropic", "openai", "ollama"]),
  modelDefault: z.string().min(1),
  endpointUrl: z.string().url().nullable().optional(),
  apiKey: z.string().min(1),
  rateCardInputPerMtok: z.number().nonnegative().optional(),
  rateCardOutputPerMtok: z.number().nonnegative().optional(),
});

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
  if ((req as any).userId !== "admin") {
    throw AppError.forbidden();
  }

  const parsed = providerSchema.safeParse(req.body);
  if (!parsed.success) {
    throw AppError.badRequest(parsed.error.message);
  }

  const { apiKey, ...rest } = parsed.data;
  const sealed = seal(apiKey);
  const id = randomUUID();

  // If setting active, deactivate others for same provider
  await db.transaction(async (tx) => {
    await tx.update(aiProviderKeys)
      .set({ isActive: false })
      .where(and(eq(aiProviderKeys.provider, rest.provider), eq(aiProviderKeys.isActive, true)));

    await tx.insert(aiProviderKeys).values({
      id,
      ...rest,
      apiKeyEncrypted: JSON.stringify(sealed),
      isActive: true,
      createdAt: new Date().toISOString(),
    });
  });

  res.status(201).json({ id });
});

// DELETE /api/ai/providers/:id
aiProvidersRouter.delete("/:id", async (req, res) => {
  if ((req as any).userId !== "admin") {
    throw AppError.forbidden();
  }

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

  const model = resolveModel(providerKey);
  const start = performance.now();
    try {
      await generateText({
        model,
        prompt: 'Reply with "ok".',
      } as any);
      res.json({ ok: true, latencyMs: Math.round(performance.now() - start) });

  } catch (err) {
    res.json({ ok: false, latencyMs: Math.round(performance.now() - start), error: String(err) });
  }
});
