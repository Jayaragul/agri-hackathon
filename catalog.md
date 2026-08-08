# Krishi Mitra — Agent & Skill Catalog

This is the map of every autonomous agent in Krishi Mitra: what it is, what it can do, what
model powers it, and — most importantly — where it sits relative to the app's one
non-negotiable architectural rule:

> **The deterministic engine (`src/engine/**`) DECIDES. Every agent listed below only
> EXPLAINS or PERCEIVES.** No agent output may change a suitability score, a crop ranking, a
> financial figure, a safety threshold, or a chemical/pesticide dose. See
> `src/services/ai/runtime/AiHarness.ts` for how that boundary is enforced structurally.

Every agent below is discoverable at runtime through the **A2A-style orchestrator**
(`src/services/ai/a2a/`) — an in-process registry of `AgentCard`s and callable `Skill`s
modelled on Google's Agent2Agent protocol shape (cards advertise skills; skills are dispatched
as lifecycle-tracked tasks: `submitted → working → completed | failed`). It is **not** a
spec-compliant A2A HTTP server — there is no JSON-RPC endpoint or wire transport — this is an
in-process registry, not a network protocol, regardless of whether `server/` (see "Server-side
Gemini proxy" below) is deployed alongside it. What it does give you: one place
(`getA2AOrchestrator().dispatch(skillId, input)`) to discover and call any agent's skill, and
one place (`orchestrator.listTaskLog()`) to see every call's full lifecycle, instead of each UI
component reaching into a different agent directly.

---

## Agent roster

| Agent | Boundary | Model | Skills | Status |
|---|---|---|---|---|
| [Agronomist Explainer](#agronomist-explainer-agent) | Explains | `gemini-3.6-flash` | `explain-recommendation` | Live |
| [Soil Report Extractor](#soil-report-extractor-agent) | Perceives | `gemini-3.6-flash` | `extract-soil-report` | Live |
| [Pest Diagnostician](#pest-diagnostician-agent) | Perceives | `gemini-3.6-flash` | `identify-pest` | Live |
| [Market Intelligence](#market-intelligence-agent) | Perceives | `gemini-3.6-flash` | `market-price` | Live |
| [Calendar Query](#calendar-query-agent) | Explains | `gemini-3.6-flash` | `answer-calendar-question` | Live |
| [General Farm Advisor](#general-farm-advisor-agent) | Explains | `gemini-3.6-flash` | `answer-farm-question` | Live |
| [Cultivation Calendar Engine](#cultivation-calendar-engine) | **Decides** (deterministic, not an AI agent) | — | day-by-day plan generation | Live |
| [Digital Twin Simulation Engine](#digital-twin-simulation-engine) | **Decides** (deterministic, not an AI agent) | — | field growth/health simulation | Live |
| [Voice Interaction Agent](#voice-interaction-agent) | Explains (reads results back), routes commands | Browser Web Speech API | `listen`, `speak`, command routing | Live (default impl) · pluggable |

Every "Live" agent above runs with **no API key required** — `AiHarness` guarantees a
deterministic, schema-shaped fallback for every task, so the app is feature-complete offline.
An API key upgrades answers from `local` to `gemini` source; it never unlocks new capability.

---

## Agronomist Explainer Agent

- **Class**: `AgronomistExplainerAgent extends AntigravityAdkAgent` — `src/services/ai/agents/AgronomistExplainerAgent.ts`
- **Role**: Senior Agricultural Extension Officer & Decision Explainer
- **Boundary**: **Explains only.** Rewords a `RecommendationResult` the engine already scored; never re-scores or re-ranks.
- **Model**: `gemini-3.6-flash`
- **A2A card id**: `agronomist-explainer`

### Skill: `explain-recommendation`
- **Input**: `{ result: RecommendationResult, profile: FarmProfile }`
- **Output** (`ExplanationOutputSchema`): `{ headline, whyThisCrop[], risks[], nextActions[], plainLanguageSummary }`
- **Task**: `createExplainRecommendationTask()` — `src/services/ai/tasks/explainRecommendationTask.ts`
- **Fallback**: `LocalTemplateExplanationProvider` — a deterministic template, not a stub apology. The farmer gets the full explanation offline, just flagged `degraded` in the trace panel.
- **Tools**: none.

---

## Soil Report Extractor Agent

- **Class**: `SoilReportExtractorAgent` — `src/services/ai/agents/SoilReportExtractorAgent.ts`
- **Role**: Multimodal Document Intelligence Specialist
- **Boundary**: **Perceives only.** Reads four numbers off a photo; every value is nullable and farmer-editable. This is the single highest-risk task in the app (its output feeds back into `FarmProfile`), so "I can't read this" must always be expressible — the prompt explicitly forbids guessing.
- **Model**: `gemini-3.6-flash`, temperature `0.1`
- **A2A card id**: `soil-report-extractor`

### Skill: `extract-soil-report`
- **Input**: `{ image: InlineImage }` (photo of an Indian Soil Health Card or lab report)
- **Output** (`SoilReportExtractionSchema`): `{ ph, nitrogenKgPerAcre, phosphorusKgPerAcre, potassiumKgPerAcre, documentRecognised, confidence, warnings[] }` — every numeric field nullable
- **Task**: `createExtractSoilReportTask()` — `src/services/ai/tasks/extractSoilReportTask.ts`
- **Fallback**: all-null extraction with `documentRecognised: false` — there is no offline OCR, so the honest degradation is "type it in yourself," never a guess.
- **Tools**: none.

---

## Pest Diagnostician Agent

- **Class**: `PestDiagnosticianAgent` — `src/services/ai/agents/PestDiagnosticianAgent.ts`
- **Role**: Multimodal Crop Protection & Pest Diagnostician
- **Boundary**: **Perceives only**, and constrained even within that: this is closed-set classification against the crop's own verified pest list (`src/data/sample/pests.ts`), not open-ended diagnosis. The model selects an id or answers null; it never produces treatment or dosage text — that is looked up from the dataset afterward.
- **Model**: `gemini-3.6-flash`, temperature `0.1`
- **A2A card id**: `pest-diagnostician`

### Skill: `identify-pest`
- **Input**: `{ image: InlineImage, crop: Crop, candidates: PestRisk[] }`
- **Output** (`PestIdentificationSchema`): `{ matchedKnownPestId, matchedPestName, confidence, observedSymptoms[], imageIsPlant, reasoning }`
- **Task**: `createIdentifyPestTask()` — `src/services/ai/tasks/identifyPestTask.ts`
- **Fallback**: "no match, low confidence" — never a best guess.
- **Tools**: none.

---

## Market Intelligence Agent

- **Class**: `MarketIntelligenceAgent` — `src/services/ai/agents/MarketIntelligenceAgent.ts`
- **Role**: Agricultural Market & Commodity Price Specialist
- **Boundary**: **Perceives only**, and advisory-only even then: the live price it finds is shown beside the engine's own dataset price for context. It never reaches `financialEngine`, so a live quote can never change a cost, profit, ROI or break-even figure.
- **Model**: `gemini-3.6-flash`, temperature `0.1`
- **A2A card id**: `market-intelligence`
- **Tools**: `google_search` — Google Search grounding (`useSearchGrounding: true`); the only agent with `toolCalling: true` on its card, since search grounding and JSON response mode are mutually exclusive on this provider (the output is parsed defensively from plain text instead).

### Skill: `market-price`
- **Input**: `{ crop: Crop, region: string }`
- **Output** (`MarketPriceSchema`): `{ pricePerKg, currency, marketName, asOf, confidence, sourceUrls[] }`
- **Task**: `createMarketPriceTask()` — `src/services/ai/tasks/marketPriceTask.ts`
- **Fallback**: the crop's static `marketPricePerKg` from the dataset, explicitly labelled `"Dataset average - not a live market quote"` at `confidence: "low"`.

---

## Calendar Query Agent

- **Class**: `CalendarQueryAgent` — `src/services/ai/agents/CalendarQueryAgent.ts`
- **Role**: Field Extension Officer for Day-Specific Calendar Questions
- **Boundary**: **Explains only, and closed-set even then.** Answers a farmer's free-text question about ONE day of the deterministic Cultivation Calendar (below), using only that day's already-computed phase/tasks/risks. The prompt forbids inventing a fertiliser, dose, chemical, or date not present in the supplied day data, and `citedFacts` must be copied verbatim from it — the UI renders those as tags so a farmer (or a judge) can see exactly which facts backed the answer.
- **Model**: `gemini-3.6-flash`, temperature `0.2`
- **A2A card id**: `calendar-query`

### Skill: `answer-calendar-question`
- **Input**: `{ crop: Crop, day: CalendarDay, question: string }`
- **Output** (`CalendarAnswerSchema`): `{ answer, citedFacts[] }`
- **Task**: `createAnswerCalendarQuestionTask()` — `src/services/ai/tasks/answerCalendarQuestionTask.ts`
- **Fallback**: cannot address the literal free-text question (that needs the model), so it degrades honestly — it reads back exactly what the engine already knows about that day, rather than pretending to answer something it can't.
- **Tools**: none.

---

## General Farm Advisor Agent

- **Class**: `GeneralFarmAdvisorAgent` — `src/services/ai/agents/GeneralFarmAdvisorAgent.ts`
- **Role**: General Farming Q&A Advisor
- **Boundary**: **Explains only, open-ended in scope but closed in what it may assert about THIS farm.** Unlike Calendar Query (closed to one day's facts), a farmer may ask about anything in general agronomy practice — the model may draw on its own knowledge for general topics, but the supplied farm context is DATA, not instructions, and it may never invent a farm-specific fact (a soil reading, a price, a recommendation) beyond what was supplied.
- **Model**: `gemini-3.6-flash`, temperature `0.2`
- **A2A card id**: `general-farm-advisor`
- **Grounding**: `src/services/advisor/farmKnowledgeBase.ts` — deterministic keyword-match retrieval over the verified local knowledge base (`src/data/wiki-kb.json`, general agronomy Q&A entries, distinct from the per-crop pest/correction datasets). The top matches are surfaced to the model as "prefer these when relevant" context on every live call — the same entries a farmer gets offline are what a live Gemini answer is anchored to.
- **UI**: `src/features/farm-advisor/FarmAdvisor.tsx`, reachable from the "Ask Advisor" header button from anywhere in the app (not gated behind the pre-sowing wizard). Chat history persists per session via `services/storage`.
- **Provenance**: the feature concept and the server-side-key security pattern below were adapted from a sibling hackathon project, "Thulir" (`Build-with-AI-Code-for-Communities/hunger-team-012-code-sastra`), which forked from the same shared starter template as this project. The implementation here is native to this codebase's `AiHarness`/A2A/testing conventions, not a copy-paste.

### Skill: `answer-farm-question`
- **Input**: `{ question: string, profile: FarmProfile | null, crop: Crop | null, topRecommendation: RecommendationResult | null }`
- **Output** (`FarmAdvisorAnswerSchema`): `{ answer, topics[], confidence }`
- **Task**: `createAnswerFarmQuestionTask()` — `src/services/ai/tasks/answerFarmQuestionTask.ts`
- **Fallback**: `buildLocalFarmAnswer()` — the same knowledge-base-grounded, always-available answer the app gives with zero API key. A live call only ever upgrades wording/personalisation, never unlocks the feature.
- **Tools**: none.

---

## Cultivation Calendar Engine

- **Location**: `src/engine/cropCalendarEngine.ts` (deterministic) + `src/features/crop-calendar/CropCalendar.tsx` (UI)
- **Boundary**: **Decides.** Not an AI agent — a pure function from `FarmProfile` + `Crop` + `RecommendationResult` + `SoilGapAnalysisResult` + `PestRisk[]` to a day-by-day plan. Every task/risk attached to a day is copied verbatim from data an engine already computed; phase boundaries (soil-prep → germination → vegetative → flowering → maturation → harvest-window) are generic phenological proportions of `crop.durationDays`, stated as such rather than presented as crop-specific science.
- **What it does**: anchors a sowing date to the 1st of the farmer's chosen sowing month (rolled to next year if that month has already started), then renders a real month-grid calendar from soil-prep through harvest, color-coded by phase, with milestone markers and pest-risk flags during the vulnerable growth window.
- **Why it's the AI's ground truth**: this closed set of per-day facts is exactly what `CalendarQueryAgent` is allowed to reference — the engine decides what's true about a day, the agent only explains it in response to a question.
- **Tests**: `src/tests/cropCalendarEngine.test.ts` — determinism, prep-day placement, phase transitions, pest-risk windowing, harvest milestone.

---

## Digital Twin Simulation Engine

- **Location**: `src/engine/digitalTwin/` (deterministic) + `src/features/digital-twin/` (UI) + `src/state/digitalTwinStore.ts`
- **Boundary**: **Decides.** This is NOT an AI agent — it is pure, seeded, deterministic simulation math (growth stage, health/excellence score, sensor readouts) ported from the FieldWatch prototype. It is documented here because it completes the product story (pre-sowing decision support → post-sowing field monitoring) and because keeping it deterministic, next to the AI agents that only explain/perceive, is the same architectural bet applied twice.
- **What it does**: given a selected field/area (12 branches, 38 fields across Coimbatore district), simulates crop growth stage, health/excellence score, sensor readings, and a pixel-art field visualization over time. Yield and health are computed, never predicted by a model. Ported modules: `growthModel.ts`, `healthModel.ts`, `lifecycleModel.ts`, `simulateField.ts`.
- **State**: `src/state/digitalTwinStore.ts` — selected area/field, a preview day/season scrubber, an "advance 1 day" tick, and the engine-computed snapshot.
- **Entry point**: `import DigitalTwinFeature, { digitalTwinNavInfo } from 'src/features/digital-twin'` — self-routes internally (area select → dashboard), so wiring it into the app shell is just rendering the component behind a nav toggle (see `App.tsx`'s "Digital Twin" header button).
- **Ported from**: `github.com/Jayasuryamahadevan/vv2.0` ("FieldWatch") — note the real, working code there is the pixel-art growth/health dashboard, not the CesiumJS 3D-globe app its own README describes (that code doesn't exist in the source repo).
- **AI touchpoints**: none in the simulation path. A future skill could let the Agronomist Explainer narrate a field's current health trend in plain language, the same "engine decides, AI explains" pattern used everywhere else — not implemented yet.
- **Tests**: `src/tests/digitalTwin.test.ts` — 34 tests covering growth/health/lifecycle math and sample-data integrity.

---

## Voice Interaction Agent

- **Location**: `src/services/voice/`
- **Interface**: `VoiceAgentPort` (`src/services/voice/types.ts`) — `isSupported()`, `start(onTranscript, onError)`, `stop()`, `speak(text)`. Mirrors the `AiTransport` pattern in `services/ai/contracts/aiTypes.ts`: one interface, swappable implementations, resolved through a single lazy-singleton factory (`getVoiceAgent()` in `services/voice/index.ts`).
- **Default implementation**: `WebSpeechVoiceAgent` — the browser's own `SpeechRecognition` + `speechSynthesis` APIs. Zero dependencies, zero backend, works today in Chrome/Edge (desktop and Android). Falls back to `NullVoiceAgent` (mic hidden) where the browser doesn't support it (Firefox, Safari at time of writing).
- **Boundary**: **Explains and routes, never decides.** `VoiceCommandBus.parseVoiceIntent()` is pure keyword matching (not a model call) into a closed set of intents (`load_demo`, `go_to_stage`, `go_back`, `read_top_recommendation`, `unrecognized`). `executeVoiceIntent()` calls the exact same `farmStore` actions and the exact same navigation guards a manual button click would — a voice command cannot jump ahead of a step the farmer hasn't unlocked, and it cannot alter a score.
- **Planned integration**: a teammate is building a dedicated voice agent. It becomes a second `VoiceAgentPort` implementation; swapping `services/voice/index.ts`'s factory is the only change needed — `VoiceCommandBus` and `VoiceControlWidget` (`src/features/voice-control/VoiceControlWidget.tsx`) do not change.
- **UI**: floating mic button, bottom-left of the app shell. Shows the live transcript and the spoken reply as text too, so it degrades gracefully for a farmer without headphones and stays screenshot/demo-friendly for judges.

---

## A2A orchestration layer (tool-calling & discovery)

- **Location**: `src/services/ai/a2a/`
- **`types.ts`**: `A2AAgentCard`, `A2ASkill`, `A2AToolCard` — the discovery shapes above are literal instances of these types.
- **`zodToJsonSchema.ts`**: mirrors this codebase's zod schemas (object/string/number/boolean/enum/array/optional/nullable/default) into JSON-Schema-shaped objects, used both for each skill's `outputSchema` (mirroring `aiSchemas.ts`) and for each tool's `parameters` (mirroring `AdkAgentTool.parameters`) — the same shape a model's native function-calling API expects.
- **`registry.ts`** (`A2AOrchestrator`): `register()`, `listAgentCards()`, `getAgentCard(id)`, `findSkill(id)`, `dispatch(skillId, input)`, `listTaskLog()`. `dispatch()` is the one call site every UI feature should route an agent call through — it is what makes every call in this catalog uniformly discoverable and logged.
- **`agentRegistrations.ts`**: binds the six production agents above to the harness tasks that already implement them — no new AI behaviour, only discoverability.
- **`createDefaultOrchestrator.ts`**: `getA2AOrchestrator()` / `resetA2AOrchestrator()` — lazy singleton, same pattern as `getAiHarness()`.

Tests: `src/tests/a2aOrchestrator.test.ts`, `src/tests/antigravityAdk.test.ts`.

### Full request/response/tool-call/reasoning logging

Every `AiCallRecord` in `HarnessTelemetry` (surfaced live in the AI Trace panel, bottom-right of
the app — click a row to expand it) now carries:
- **`request`** — the exact system + user prompt (images reduced to count/mime-type, never
  inlined), built even on a cache hit or a gated/offline call, so you can see what would have
  been asked even when nothing was actually sent.
- **`response`** — the raw transport text (when a live attempt was made) and the parsed data
  actually returned to the caller, whether that came from a live model call, a cache replay, or
  the deterministic fallback.
- **`toolCalls`** — every tool invocation observed, today limited to `google_search` (Market
  Intelligence's search grounding), each with its grounding URLs.
- **`notes`** — the harness's full reasoning trail in order: cache hits, retry/backoff
  decisions, the single repair round, and the final fallback reason.

This makes every one of the six agents' calls fully auditable from one place with zero extra
instrumentation per agent — it's a property of `AiHarness.run()` itself. Tests:
`src/tests/aiHarnessTelemetry.test.ts`.

---

## Server-side Gemini proxy (secure transport)

Every transport above (`AntigravityAdkTransport`, `GeminiSdkTransport`, `GeminiRestTransport`)
reads a `VITE_GEMINI_API_KEY` — which Vite inlines into the public JS bundle at build time.
Fine for a quick local demo; not something you want in a real deployment.

- **`ServerProxyTransport`** (`src/services/ai/transport/ServerProxyTransport.ts`) is a fourth
  `AiTransport` implementation that calls this app's OWN backend instead of Google directly.
  Selected via `VITE_AI_TRANSPORT=server` in `harnessConfig.ts` — the only mode that needs **no
  client-side key at all**; `isAiConfigured()` and `HarnessConfig.enabled` both treat "server
  transport selected" as sufficient, independent of `VITE_GEMINI_API_KEY`.
- **`server/src/routes/aiRoutes.ts`** exposes `POST /api/ai/generate` (and `GET /api/ai/status`),
  reading `GEMINI_API_KEY` (no `VITE_` prefix) from the server's own environment — this value
  never reaches the browser. `server/src/services/geminiProxy.ts` walks the same model chain the
  frontend already resolved, extracts grounding URLs, and classifies failures identically to
  `GeminiRestTransport`, so swapping transports is invisible to `AiHarness` — same retry/repair/
  fallback behaviour either way.
- **Recommended posture**: local dev and quick demos use any client-direct transport (`adk` is
  the default); a real deployment sets `VITE_AI_TRANSPORT=server` at build time and
  `GEMINI_API_KEY` on the server — see `deploy/DEPLOY.md` step 2b.

Tests: `src/tests/serverProxyTransport.test.ts` (frontend), `server/src/services/geminiProxy.test.ts` (backend).

---

## How a new agent gets added

1. Write the task (`buildPrompt`, `schema`, `fallback`, `cacheKey`) under `src/services/ai/tasks/`, same as the four above.
2. Wrap it in an `AntigravityAdkAgent` subclass under `src/services/ai/agents/` for name/role/model metadata.
3. Register an `A2AAgentRegistration` in `src/services/ai/a2a/agentRegistrations.ts`, with the skill's `run()` calling `getAiHarness().run(createYourTask(), input)` — never a shortcut around the harness.
4. Add a row to the roster table and a section to this file.
5. If the new skill can influence a score, ranking, financial figure or dose: stop. That decision belongs in `src/engine/`, not here.
