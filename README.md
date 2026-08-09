# 🌾 Krishi Mitra

**AI-native decision support for smallholder farmers in Tamil Nadu, India.**

Krishi Mitra helps a beginner farmer decide *what to grow, how to fix their soil, what it will
cost, what could go wrong, and what to do next* — combining a deterministic agronomy engine with
Gemini-powered agents that explain, perceive, and converse, but never decide.

> Built for the **"Solving world hunger using AI"** track — a Google Developer Groups hackathon.

## Contents

- [The problem](#the-problem)
- [The solution](#the-solution)
- [Key features](#key-features)
- [Architecture & the AI boundary](#architecture--the-ai-boundary)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Testing](#testing)
- [Deployment](#deployment)
- [Storage architecture](#storage-architecture)
- [FarmConnect marketplace integration](#farmconnect-marketplace-integration)
- [Known gaps](#known-gaps)
- [Contributing](#contributing)
- [Acknowledgments](#acknowledgments)

## The problem

Smallholder farmers make the highest-stakes decisions in agriculture — what crop to plant, how
much fertilizer to buy, when to sow — with the least reliable information, often relying on
guesswork, a neighbor's advice, or a fertilizer dealer with an incentive to oversell. A wrong
crop choice or a mistimed input purchase can mean a season of debt.

Krishi Mitra is designed specifically for a **first-time, possibly non-literate user** on a
budget Android phone: audio-first, plain language, and honest about what it doesn't know.

## The solution

A pre-sowing wizard scores every viable crop against the farmer's actual soil and land, a
cultivation calendar turns that into a day-by-day plan, and a set of AI agents explain, extract,
and converse around that plan — never replacing it. See
[Architecture & the AI boundary](#architecture--the-ai-boundary) for exactly how that split is
enforced in code, not just in a slide.

## Key features

- 🎙️ **Audio Mode** — the app's default landing screen. A farmer speaks naturally in Tamil or
  English; no wizard, no forms, no reading required to get a first useful answer.
- 🌱 **Crop recommendation wizard** — scores every crop in the dataset against the farmer's soil
  (pH, N/P/K), land size, and region, with a transparent, explainable score breakdown.
- 🧪 **Soil report reading** — photograph or upload a PDF of a Soil Health Card; Gemini extracts
  the numbers, the farmer's own entry is never silently overwritten.
- 📅 **Cultivation calendar** — a deterministic, day-by-day plan from sowing to harvest, with
  proactive pest-risk and weather alerts.
- 💰 **Financial planning** — cost, revenue, and break-even scenarios for the recommended crop.
- 🩺 **Crop Doctor** — a live voice-and-video assistant that matches a photographed pest/disease
  against a fixed, verified reference list — never an open-ended, unverifiable diagnosis.
- 🛒 **FarmConnect marketplace integration** — real consumer demand data (not a guess) feeds
  "what's the demand for my crop" answers, and lets a farmer list produce for sale.
- 🧠 **Long-term memory** — remembers durable facts about a farmer across conversations, via
  mem0, without ever replaying full chat history.

## Architecture & the AI boundary

> **The deterministic engine (`src/engine/**`) DECIDES. Every AI agent only EXPLAINS or
> PERCEIVES.**

No agent output may ever change a suitability score, a crop ranking, a financial figure, a
safety threshold, or a chemical/pesticide dose. Concretely:

- Live market prices fetched via Gemini search grounding are **informational only** and never
  re-enter the financial math.
- Chemical/pesticide/fertilizer dosing comes **only** from the verified dataset, never the model.
- Pest photo identification is **constrained classification** against a crop's known pest list,
  not open-ended diagnosis.
- A soil-report extraction returns `null` rather than guess, and every extracted value stays
  farmer-editable.

Every agent is discoverable at runtime through an in-process **A2A-style orchestrator**
(`src/services/ai/a2a/`), modelled on Google's Agent2Agent protocol shape — one registry, one
call-log, instead of each screen reaching into a different agent directly. Full agent-by-agent
detail lives in [`catalog.md`](catalog.md).

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Zustand, Vitest |
| Backend | Node.js, Express, TypeScript |
| AI | Gemini (`@google/genai`), Antigravity ADK transport, server-side proxy transport |
| Voice | Sarvam AI (speech-to-text + text-to-speech, Tamil/English) |
| Long-term memory | mem0 |
| Structured storage | Google Cloud Firestore |
| File/object storage | Google Cloud Storage |
| Weather | Google Maps Platform Weather API |
| Hosting | Google Cloud Run (single container, Cloud Build) |

## Project structure

```
├── src/                        Frontend (React + TypeScript)
│   ├── engine/                 Deterministic scoring/calendar/proactive-alert engines
│   ├── services/ai/            Agents, tasks, transports, the A2A orchestrator
│   ├── services/marketplace/   FarmConnect integration client
│   ├── services/soilReport/    Soil-report upload/persistence client
│   ├── features/               One folder per screen (voice-mode, crop-doctor, ...)
│   ├── domain/models/          Shared TypeScript types
│   └── data/sample/            Verified crop/pest/correction datasets
├── server/                     Backend (Express + TypeScript)
│   ├── src/routes/             /api/* endpoints
│   ├── src/services/           Gemini/Sarvam/Weather proxies, marketplace demand logic
│   └── src/storage/            GCS (bucketStore/fileStore) + Firestore (documentStore) backends
├── marketplace/                FarmConnect — an independently-deployed vanilla-JS consumer app
├── .claude/skills/              Storage-audit tooling (Python CLI + docs)
├── deploy/DEPLOY.md            Cloud Run deployment runbook
└── catalog.md                  Full agent & skill catalog
```

## Getting started

Requires Node.js 20+.

```bash
# Install frontend + backend dependencies
npm install
npm --prefix server install

# Copy the env template (every variable is optional — the app runs fully offline with none set)
cp .env.example .env

# Run frontend + backend together (recommended — mirrors production's single-origin setup)
npm run dev:full
```

The app opens at `http://localhost:5173` (or the next free port). With no `.env` values set,
every AI feature transparently falls back to a deterministic local answer — a missing key is the
normal path, not an error.

## Environment variables

Every variable is optional; see [`.env.example`](.env.example) for the full, heavily-commented
reference. The ones you'll actually reach for:

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Server-side Gemini key (never sent to the browser) |
| `VITE_AI_TRANSPORT=server` | Routes AI calls through this app's own backend — the production setting |
| `SARVAM_API_KEY` | Powers Audio Mode's speech-to-text/text-to-speech |
| `GOOGLE_WEATHER_API_KEY` | Proactive weather-based alerts |
| `MEM0_API_KEY` | Long-term cross-conversation farmer memory |
| `GCS_BUCKET_NAME` | Session data + uploaded soil-report files (Cloud Storage) |
| `FIRESTORE_ENABLED=true` | Marketplace + soil-report metadata (Firestore) |

## Testing

```bash
npm run typecheck              # frontend
npx vitest run                 # frontend test suite
npm --prefix server run build  # server typecheck + build
npm --prefix server test       # server test suite
```

Both suites are enforced clean before anything merges — deterministic engines, storage backends,
and AI-harness fallback behavior all have direct unit tests, not just end-to-end smoke checks.

## Deployment

Ships as a single container — the root `Dockerfile` builds the Vite frontend and the Express
backend together, so one Cloud Run service serves both:

```bash
gcloud run deploy krishi-mitra \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --env-vars-file deploy-env.yaml \
  --build-env-vars VITE_AI_TRANSPORT=server
```

Full runbook — API enablement, Firestore/bucket setup, IAM grants, rollback — is in
[`deploy/DEPLOY.md`](deploy/DEPLOY.md).

## Storage architecture

Three independently-optional backends, each chosen for what it's actually good at — never
required for the app to run:

- **GCS (JSON blobs)** — session profile + chat threads, one blob per session, no concurrent
  writers to worry about.
- **GCS (binary files)** — original uploaded soil-report photos/PDFs.
- **Firestore** — marketplace orders/listings and soil-report metadata: anything written
  concurrently by more than one caller gets its own document, so two Cloud Run instances syncing
  at once can never clobber each other's write — the actual fix for a real race the earlier
  single-JSON-blob design had.

See `.claude/skills/krishi-mitra-storage/SKILL.md` for the exact layout and an audit CLI.

## FarmConnect marketplace integration

`marketplace/` is a separate, independently-deployed vanilla-JS consumer/farmer app with no
server of its own — Krishi Mitra's backend is the shared seam between the two:

- FarmConnect pushes every new consumer request in, so a farmer's "what's the demand for my
  crop" question gets a real number, not nothing.
- Krishi Mitra pushes a new "let's sell it" listing out, and FarmConnect notifies every consumer
  who had an open request for that crop.

Demand analysis is purely arithmetic (request count, quantity, median price) — no model call, no
AI-originated number ever reaches a farmer's pricing decision.

## Known gaps

Stated plainly rather than left for someone else to discover:

- The soil-report photo/PDF upload only has one entry point today (Audio Mode's "Lab report"
  button) — the pre-sowing wizard has no dedicated upload step of its own yet.
- FarmConnect's own "login" is a phone-number lookup with no password — fine for demo data,
  not a real auth system.
- Marketplace/soil-report data in Firestore is demand-signal data, not a transactional system of
  record — treat it accordingly.

## Contributing

New agents follow a fixed pattern documented at the bottom of [`catalog.md`](catalog.md#how-a-new-agent-gets-added):
write the task, wrap it in an agent class, register it with the A2A orchestrator, document it —
and if the new skill could ever influence a score, ranking, or financial figure, stop: that
decision belongs in `src/engine/`, not the AI layer.

## Acknowledgments

Built for a Google Developer Groups hackathon under the "Solving world hunger using AI" track,
by team **code-sastra**.
