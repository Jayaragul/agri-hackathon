/**
 * Server-side AI proxy routes, mounted under `/api` by `server/src/index.ts`.
 *
 * This is the security upgrade over calling Gemini directly from the browser: the frontend's
 * `ServerProxyTransport` posts a prompt here; this route reads `GEMINI_API_KEY` from the
 * server's own environment and makes the actual call. No API key ever reaches client code or
 * the built JS bundle when the app is deployed this way (`VITE_AI_TRANSPORT=server`, no
 * `VITE_GEMINI_API_KEY` needed at all).
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { generateViaGemini, ProxyError } from "../services/geminiProxy";
import { resolveGeminiApiKey } from "../services/env";

const DEFAULT_MODEL = "gemini-3.6-flash";
const MAX_PROMPT_CHARS = 20_000;
const MAX_IMAGES = 4;

const ImageSchema = z.object({
  mimeType: z.string().min(1),
  base64Data: z.string().min(1),
});

const ToolDeclarationSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  parameters: z.unknown(),
});

const GenerateRequestSchema = z.object({
  system: z.string().max(MAX_PROMPT_CHARS).optional(),
  user: z.string().min(1).max(MAX_PROMPT_CHARS),
  images: z.array(ImageSchema).max(MAX_IMAGES).optional(),
  useSearchGrounding: z.boolean().optional(),
  tools: z.array(ToolDeclarationSchema).max(10).optional(),
  modelChain: z.array(z.string().min(1)).min(1).max(5),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().positive().max(8192).optional(),
  responseSchema: z.unknown().optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
});

export function createAiRoutes(): Router {
  const router = Router();

  router.get("/ai/status", (_req: Request, res: Response) => {
    res.status(200).json({
      configured: resolveGeminiApiKey().length > 0,
      model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
    });
  });

  router.post("/ai/generate", async (req: Request, res: Response) => {
    const parsed = GenerateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_body" });
    }

    try {
      const reply = await generateViaGemini(resolveGeminiApiKey(), parsed.data);
      return res.status(200).json(reply);
    } catch (err) {
      const status = err instanceof ProxyError ? err.status : 500;
      const message = err instanceof Error ? err.message : "Unexpected proxy error.";
      if (status >= 500) console.error("[aiRoutes] generate failed:", message);
      return res.status(status).json({ error: message });
    }
  });

  return router;
}
