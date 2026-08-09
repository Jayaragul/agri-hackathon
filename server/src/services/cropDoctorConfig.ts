/**
 * The Crop Doctor live-session persona and tool contract — built server-side and baked into
 * the ephemeral token's `liveConnectConstraints`, so a farmer's browser can never override the
 * system instruction or the tool declaration once the token is minted.
 *
 * Same discipline as `src/services/ai/prompts/identifyPestPrompt.ts` on the frontend (which this
 * mirrors deliberately): the model is given a CLOSED list of the crop's verified pests — names
 * and symptoms only, never treatment text — and its only job is to pick the best-matching id (or
 * none) via the `reportPestObservation` tool. The client resolves that id against the same
 * verified dataset and hands back the actual biological/chemical control text for the model to
 * relay; the model never invents a treatment itself. Live video is a faster perception channel
 * into the same constrained-classification pipeline, not a new unconstrained oracle.
 */
import { Type, type FunctionDeclaration } from "@google/genai";

export const CROP_DOCTOR_TOOL_NAME = "reportPestObservation";

export interface PestCandidateSummary {
  id: string;
  pestName: string;
  symptoms: string;
}

function formatCandidateList(candidates: PestCandidateSummary[]): string {
  if (candidates.length === 0) return "(no verified pest records exist for this crop)";
  return candidates.map((c) => `- id "${c.id}": ${c.pestName} — ${c.symptoms}`).join("\n");
}

/**
 * Optional farmer identity/situation, assembled by the frontend's `services/context/farmContext.ts`
 * — the same context every other agent in this app receives, so Video mode never has to ask the
 * farmer to repeat themselves. Mirrored by hand in `src/services/ai/live/ephemeralToken.ts`
 * (frontend) — there is no shared module between the frontend and `server/`.
 */
export interface FarmerContextSummary {
  farmerName?: string;
  situation?: string;
  /** One line of soil numbers (profile or uploaded lab report). */
  soilSummary?: string;
  /** Reactive: recent farm-timeline entries, most recent first. Farmer/agent-reported, never engine-verified. */
  recentEvents?: string[];
  /** Proactive: engine-computed upcoming milestones/risk windows from the cultivation calendar. */
  upcomingAlerts?: string[];
}

function formatFarmerContext(context?: FarmerContextSummary): string {
  const hasAny =
    context &&
    (context.farmerName ||
      context.situation ||
      context.soilSummary ||
      (context.recentEvents && context.recentEvents.length > 0) ||
      (context.upcomingAlerts && context.upcomingAlerts.length > 0));
  if (!hasAny) return "";

  const lines: string[] = [];
  if (context.farmerName) lines.push(`Farmer's name: ${context.farmerName}. Greet them by name.`);
  if (context.situation) lines.push(`Current situation: ${context.situation}`);
  if (context.soilSummary) lines.push(`Soil test numbers: ${context.soilSummary}.`);
  if (context.recentEvents && context.recentEvents.length > 0) {
    lines.push(`Recently on this farm (farmer/agent-reported, not verified):\n${context.recentEvents.map((e) => `- ${e}`).join("\n")}`);
  }
  if (context.upcomingAlerts && context.upcomingAlerts.length > 0) {
    lines.push(`Upcoming, per the deterministic calendar (you may state these with confidence):\n${context.upcomingAlerts.map((a) => `- ${a}`).join("\n")}`);
  }
  return `\nWHO YOU ARE TALKING TO\n${lines.join("\n")}\n`;
}

export function buildCropDoctorSystemInstruction(
  cropName: string,
  candidates: PestCandidateSummary[],
  farmerContext?: FarmerContextSummary
): string {
  return `You are the Crop Doctor, a live voice-and-video assistant in Thulir, a crop decision-support app used by smallholder farmers in Tamil Nadu, India.

YOUR ROLE
A farmer has pointed their phone camera at their ${cropName} crop and can hear and see you. Speak briefly, warmly, and in plain language, as if you were standing in the field beside them. You are not a plant doctor and you do not diagnose on your own authority — you MATCH what you see against a fixed, verified list, exactly like a lab technician checking a photo against a reference chart.
${formatFarmerContext(farmerContext)}

THE LIST IS CLOSED
These are the ONLY pests you may match against for this crop:
${formatCandidateList(candidates)}
If what you see does not clearly match one of these, say so plainly and suggest the farmer show it to a local KVK extension officer. Never invent a pest, disease, or issue that is not in this list.

YOU DO NOT DIAGNOSE OR RECOMMEND TREATMENT YOURSELF
Whenever you notice a symptom worth checking, or the farmer asks what's wrong, call the "${CROP_DOCTOR_TOOL_NAME}" tool with what you currently observe and your best-matching id from the list above (or null). WAIT for the tool's result before saying anything about treatment. The tool's response is the ONLY source of treatment guidance you may relay — repeat it faithfully, in your own conversational words, but never add a chemical name, a dose, a brand, or a treatment step that is not in that response.

HOW TO SPEAK
Short sentences. Confirm what you see before naming anything ("I can see some yellowing near the leaf edges — let me check that against what we know..."). If the tool reports no match, say so honestly rather than guessing.

SAFETY
Never invent a pesticide name or dose under any circumstance. For a severe or unclear problem, always recommend the farmer also show it to a local agriculture extension officer.`;
}

/** Tool declaration sent to the model at session setup — a subset-of-OpenAPI JSON schema, per the Live API's function-calling contract. */
export const CROP_DOCTOR_TOOL_DECLARATION: FunctionDeclaration = {
  name: CROP_DOCTOR_TOOL_NAME,
  description:
    "Report what you currently observe on the crop in the live video and check it against the crop's verified pest list. Call this whenever you notice a symptom worth checking, or when the farmer asks what is wrong. You never diagnose or recommend treatment yourself — the app looks up verified guidance from the matched id for you to relay.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      observedSymptoms: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "Symptoms currently visible in the video, in your own words.",
      },
      matchedKnownPestId: {
        type: Type.STRING,
        nullable: true,
        description: "Id of the single best-matching pest from the candidate list given in your system instruction, or null if none match.",
      },
      confidence: { type: Type.STRING, enum: ["high", "medium", "low"] },
    },
    required: ["observedSymptoms", "matchedKnownPestId", "confidence"],
  },
};
