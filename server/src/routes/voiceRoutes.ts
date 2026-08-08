/**
 * Audio Mode's speech routes, mounted under `/api` by `server/src/index.ts`. Sarvam counterpart
 * to `aiRoutes.ts`'s Gemini proxy: the frontend posts raw audio/text here, this route holds
 * `SARVAM_API_KEY`, and the actual Sarvam call happens server-side (see `sarvamProxy.ts`).
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { speechToText, textToSpeech, SarvamProxyError } from "../services/sarvamProxy";
import { resolveSarvamApiKey, resolveSarvamLanguage } from "../services/env";

const MAX_TEXT_CHARS = 2_000;

const AudioSchema = z.object({
  mimeType: z.string().min(1),
  base64Data: z.string().min(1),
});

const SpeechToTextRequestSchema = z.object({
  audio: AudioSchema,
  languageCode: z.string().min(2).max(10).optional(),
});

const TextToSpeechRequestSchema = z.object({
  text: z.string().min(1).max(MAX_TEXT_CHARS),
  languageCode: z.string().min(2).max(10).optional(),
});

export function createVoiceRoutes(): Router {
  const router = Router();

  router.get("/voice/status", (_req: Request, res: Response) => {
    res.status(200).json({
      configured: resolveSarvamApiKey().length > 0,
      languageCode: resolveSarvamLanguage(),
    });
  });

  router.post("/voice/speech-to-text", async (req: Request, res: Response) => {
    const parsed = SpeechToTextRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_body" });
    }

    try {
      const transcript = await speechToText(
        resolveSarvamApiKey(),
        parsed.data.audio,
        parsed.data.languageCode || resolveSarvamLanguage()
      );
      return res.status(200).json({ transcript });
    } catch (err) {
      const status = err instanceof SarvamProxyError ? err.status : 500;
      const message = err instanceof Error ? err.message : "Unexpected error transcribing audio.";
      if (status >= 500) console.error("[voiceRoutes] speech-to-text failed:", message);
      return res.status(status).json({ error: message });
    }
  });

  router.post("/voice/text-to-speech", async (req: Request, res: Response) => {
    const parsed = TextToSpeechRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_body" });
    }

    try {
      const base64Data = await textToSpeech(
        resolveSarvamApiKey(),
        parsed.data.text,
        parsed.data.languageCode || resolveSarvamLanguage()
      );
      return res.status(200).json({ audio: { mimeType: "audio/wav", base64Data } });
    } catch (err) {
      const status = err instanceof SarvamProxyError ? err.status : 500;
      const message = err instanceof Error ? err.message : "Unexpected error synthesising speech.";
      if (status >= 500) console.error("[voiceRoutes] text-to-speech failed:", message);
      return res.status(status).json({ error: message });
    }
  });

  return router;
}
