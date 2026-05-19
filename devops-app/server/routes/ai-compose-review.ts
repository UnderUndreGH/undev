import { Router } from "express";
import { z } from "zod";
import { db } from "../db/index.js";
import { AppError } from "../lib/app-error.js";
import { lintCompose } from "../lib/compose-static-lint.js";
import { reviewComposeContent } from "../services/ai/compose-reviewer.js";

export const aiComposeReviewRouter = Router();

// POST /api/ai/compose-lint (Static only)
aiComposeReviewRouter.post("/lint", async (req, res) => {
  const { content } = req.body;
  if (typeof content !== 'string') throw AppError.badRequest("Content must be a string");
  
  const findings = lintCompose(content);
  res.json({ findings });
});

// POST /api/ai/compose-review (Static + LLM)
aiComposeReviewRouter.post("/review", async (req, res) => {
  const { appId, content } = req.body;
  if (!appId || typeof content !== 'string') throw AppError.badRequest("AppId and content are required");
  
  const result = await reviewComposeContent(appId, content);
  res.json(result);
});


// POST /api/ai/compose-review (Static + LLM)
aiComposeReviewRouter.post("/review", async (req, res) => {
  const { appId, content } = req.body;
  if (!appId || typeof content !== 'string') throw AppError.badRequest("AppId and content are required");
  
  const result = await reviewComposeContent(appId, content);
  res.json(result);
});
