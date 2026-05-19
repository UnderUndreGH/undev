import { eq, gte, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { aiConversations, aiProviderKeys, aiSettings } from "../../db/schema.js";
import { AppError } from "../../lib/app-error.js";
import { logger } from "../../lib/logger.js";

// ---------------------------------------------------------------------------
// checkMonthlyBudget
// ---------------------------------------------------------------------------
export async function checkMonthlyBudget(): Promise<{
  allowed: boolean;
  usedIn: number;
  usedOut: number;
  budgetIn: number;
  budgetOut: number;
}> {
  const now = new Date();
  const monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01T00:00:00.000Z`;

  const [settings] = await db
    .select({
      budgetIn: aiSettings.monthlyTokenBudgetIn,
      budgetOut: aiSettings.monthlyTokenBudgetOut,
    })
    .from(aiSettings)
    .where(eq(aiSettings.id, 1));

  const budgetIn = settings?.budgetIn ?? 5_000_000;
  const budgetOut = settings?.budgetOut ?? 1_000_000;

  const [usage] = await db
    .select({
      totalIn: sql<number>`coalesce(sum(${aiConversations.tokensIn} + ${aiConversations.tokensReserved}), 0)`,
      totalOut: sql<number>`coalesce(sum(${aiConversations.tokensOut}), 0)`,
    })
    .from(aiConversations)
    .where(gte(aiConversations.createdAt, monthStart));

  const usedIn = Number(usage?.totalIn ?? 0);
  const usedOut = Number(usage?.totalOut ?? 0);
  const allowed = usedIn < budgetIn && usedOut < budgetOut;

  if (!allowed) {
    logger.info(
      { ctx: "budget-enforcer", usedIn, usedOut, budgetIn, budgetOut },
      "Monthly token budget exhausted",
    );
  }

  return { allowed, usedIn, usedOut, budgetIn, budgetOut };
}

// ---------------------------------------------------------------------------
// reserveTokens
// ---------------------------------------------------------------------------
export async function reserveTokens(
  conversationId: string,
  tokens: number,
): Promise<void> {
  await db
    .update(aiConversations)
    .set({ tokensReserved: tokens })
    .where(eq(aiConversations.id, conversationId));

  logger.info(
    { ctx: "budget-enforcer", conversationId, tokens },
    "Tokens reserved",
  );
}

// ---------------------------------------------------------------------------
// reconcileTokens
// ---------------------------------------------------------------------------
export async function reconcileTokens(
  conversationId: string,
  actualTokensIn: number,
  actualTokensOut: number,
): Promise<void> {
  // Look up the provider key to compute cost
  const [row] = await db
    .select({
      rateInput: aiProviderKeys.rateCardInputPerMtok,
      rateOutput: aiProviderKeys.rateCardOutputPerMtok,
    })
    .from(aiConversations)
    .innerJoin(aiProviderKeys, eq(aiConversations.providerKeyId, aiProviderKeys.id))
    .where(eq(aiConversations.id, conversationId));

  let estCostUsd = 0;
  if (row) {
    const rateInput = row.rateInput ?? 0;
    const rateOutput = row.rateOutput ?? 0;
    estCostUsd =
      (actualTokensIn / 1_000_000) * rateInput +
      (actualTokensOut / 1_000_000) * rateOutput;
  }

  await db
    .update(aiConversations)
    .set({
      tokensIn: actualTokensIn,
      tokensOut: actualTokensOut,
      tokensReserved: 0,
      estCostUsd,
    })
    .where(eq(aiConversations.id, conversationId));

  logger.info(
    {
      ctx: "budget-enforcer",
      conversationId,
      actualTokensIn,
      actualTokensOut,
      estCostUsd,
    },
    "Tokens reconciled",
  );
}
