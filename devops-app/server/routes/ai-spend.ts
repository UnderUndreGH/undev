import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { aiConversations } from "../db/schema.js";

export const aiSpendRouter = Router();

// GET /api/ai/spend
aiSpendRouter.get("/", async (req, res) => {
  const now = new Date();
  const monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01T00:00:00.000Z`;

  const [usage] = await db
    .select({
      totalIn: sql<number>`coalesce(sum(${aiConversations.tokensIn}), 0)`,
      totalOut: sql<number>`coalesce(sum(${aiConversations.tokensOut}), 0)`,
      totalCost: sql<number>`coalesce(sum(${aiConversations.estCostUsd}), 0)`,
    })
    .from(aiConversations)
    .where(sql`${aiConversations.createdAt} >= ${monthStart}`);

  res.json({
    monthStart,
    tokensIn: Number(usage?.totalIn ?? 0),
    tokensOut: Number(usage?.totalOut ?? 0),
    estCostUsd: Number(usage?.totalCost ?? 0),
  });
});

// GET /api/ai/spend/conversations
aiSpendRouter.get("/conversations", async (req, res) => {
  const rows = await db
    .select()
    .from(aiConversations)
    .orderBy(sql`${aiConversations.createdAt} DESC`)
    .limit(50);
  res.json(rows);
});
