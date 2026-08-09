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
| [Crop Doctor (Live)](#crop-doctor-live-agent) | Perceives (constrained), live video+audio | `gemini-2.5-flash-native-audio-preview` | `reportPestObservation` (client-resolved tool) | Live — needs `GEMINI_API_KEY` on the server |
| [Audio Mode](#audio-mode--onboarding) | Explains (reuses General Farm Advisor's skill) | Sarvam AI (`saaras:v3` STT, `bulbul:v3` TTS) + `gemini-3.6-flash` | speech turns over `answer-farm-question` | Live — needs `SARVAM_API_KEY` on the server |
| [Cultivation Calendar Engine](#cultivation-calendar-engine) | **Decides** (deterministic, not an AI agent) | — | day-by-day plan generation | Live |
| [Farm Timeline — Proactive & Reactive](#farm-timeline--proactive--reactive-shared-context) | **Decides** (proactive, deterministic) **/ records** (reactive) — not an AI agent | — | forward-looking alerts + a shared farm event log | Live |
| [Weather-based Proactive Alerts](#weather-based-proactive-alerts) | **Decides** (deterministic thresholds) — not an AI agent | — | rain/wind/heat/storm warnings from Google Weather API | Live — needs `GOOGLE_WEATHER_API_KEY` on the server |
| [Digital Twin Simulation Engine](#digital-twin-simulation-engine) | **Decides** (deterministic, not an AI agent) | — | field growth/health simulation | Live |
| [Voice Interaction Agent](#voice-interaction-agent) | Explains (reads results back), routes commands | Browser Web Speech API | `listen`, `speak`, command routing | Live (default impl) · pluggable |
| [Long-term Memory](#long-term-memory-mem0) | Supporting layer, not itself an agent | mem0 (hosted) | `record`, `recall` | Optional — needs `MEM0_API_KEY` |

Every "Live" agent above except Crop Doctor runs with **no API key required** — `AiHarness`
guarantees a deterministic, schema-shaped fallback for every task, so the app is
feature-complete offline. An API key upgrades answers from `local` to `gemini` source; it never
unlocks new capability. Crop Doctor is the one exception: a live video call has no offline
equivalent, so it requires a configured backend (see its section below).

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
- **Input**: `{ crop: Crop, day: CalendarDay, question: string, memories?: string[] }`
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
- **Input**: `{ question: string, profile: FarmProfile | null, crop: Crop | null, topRecommendation: RecommendationResult | null, memories?: string[], farmerName?: string | null, declaredSituation?: string | null, recentEvents?: string[], upcomingAlerts?: string[] }` — the last two come from the [Farm Timeline](#farm-timeline--proactive--reactive-shared-context) via `farmContext.ts`.
- **Output** (`FarmAdvisorAnswerSchema`): `{ answer, topics[], confidence }`
- **Task**: `createAnswerFarmQuestionTask()` — `src/services/ai/tasks/answerFarmQuestionTask.ts`
- **Fallback**: `buildLocalFarmAnswer()` — the same knowledge-base-grounded, always-available answer the app gives with zero API key. A live call only ever upgrades wording/personalisation, never unlocks the feature. The fallback ignores `memories`, `recentEvents`, and `upcomingAlerts` entirely — it only ever uses `profile`/`crop`/`topRecommendation`, the same deterministic inputs it has always used.
- **Tools**: none.

---

## Crop Doctor (Live) Agent

- **Location**: `src/services/ai/live/` (frontend) + `server/src/services/liveTokenService.ts` + `server/src/services/cropDoctorConfig.ts` (backend) + `src/features/crop-doctor/CropDoctor.tsx` (UI)
- **What it is**: a live video-and-voice call — the farmer points their camera at a crop and talks naturally; Crop Doctor watches, listens, and speaks back with native audio. Built on the [Gemini Live API](https://ai.google.dev/gemini-api/docs/live-api) (bidirectional WebSocket streaming), not the request/response `AiHarness` path every other agent uses — a live call has no meaningful "cache" or "single retry" concept.
- **Boundary**: **Perceives, under the same closed-set constraint as [Pest Diagnostician](#pest-diagnostician-agent) — video is a faster perception channel into the identical pipeline, not a new, less-constrained one.** The model may only match against the crop's own verified pest list, and it may never state a treatment itself; treatment text always comes from `sample/pests.ts`, resolved client-side.
- **Security — no client-exposed key**: the browser never sees `GEMINI_API_KEY`. `POST /api/live/token` (`server/src/routes/liveRoutes.ts`) mints a short-lived, single-use [ephemeral token](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens) server-side, with the Crop Doctor system instruction and tool declaration **locked into the token itself** (`liveConnectConstraints`) — the farmer's browser cannot override the persona or the tool contract even if it tried. The browser then connects DIRECTLY to Google's Live API using that token; this server never relays the audio/video stream itself.
- **The tool loop** (`reportPestObservation`):
  1. At token-mint time, the server embeds the crop's verified candidate pest list (names + symptoms only, never treatment text) into the system instruction (`buildCropDoctorSystemInstruction` in `cropDoctorConfig.ts`).
  2. During the call, whenever the model notices something worth checking, it calls `reportPestObservation({ observedSymptoms, matchedKnownPestId, confidence })`.
  3. The frontend's `pestToolResolver.ts` — the safety-critical piece, unit tested in isolation — rejects any id not in the candidate list (exactly like `PestIdentificationService.enforceClosedSet`), and on a real match returns the verified `biologicalControl` / `chemicalControl` / `economicThreshold` from the dataset.
  4. That result is sent back via `session.sendToolResponse()`; the model relays it in its own words over native audio. It never receives treatment text except through this resolved response.
- **Session management**: `CropDoctorSession` (`src/services/ai/live/CropDoctorSession.ts`) owns camera/mic capture (canvas-snapshot JPEG frames at ~1.5s intervals, mic downsampled to 16kHz PCM16 via `audioUtils.ts`), playback of the model's 24kHz PCM audio output, and live transcript events (`inputAudioTranscription` / `outputAudioTranscription`).
- **UI**: `src/features/crop-doctor/CropDoctor.tsx`, reachable from the "Crop Doctor" header button. Requires a crop already selected (uses that crop's verified pest list as the closed set) — shown a guard message otherwise, same pattern as the Cultivation Calendar.
- **No offline fallback, by design**: unlike every other agent, there is no deterministic local answer for "watch this live video" — the feature requires a deployed backend with `GEMINI_API_KEY` set. With no backend, the "Start Live Visit" button surfaces a clear error rather than pretending to work.
- **Tests**: `src/tests/cropDoctorLive.test.ts` (tool resolution + PCM/base64 audio conversion, both pure and fully unit tested), `server/src/services/liveTokenService.test.ts` (system-instruction construction + missing-key error path). The live WebSocket connection itself, and real camera/microphone capture, cannot be exercised in an automated/headless environment and were verified structurally (typecheck, error-path behavior in a real browser with camera access denied) rather than end-to-end against Google's servers.
- **Farmer context — the full shared snapshot, not just a name**: `createLiveToken()` accepts an optional `farmerContext: { farmerName?, situation?, soilSummary?, recentEvents?, upcomingAlerts? }`, folded into the system instruction (`buildCropDoctorSystemInstruction`'s `formatFarmerContext`) so Video Mode knows the same soil numbers, recent farm events, and upcoming calendar predictions every other agent does — not just a name and a one-line situation. Assembled by `services/context/farmContext.ts` — see [Farm Timeline](#farm-timeline--proactive--reactive-shared-context) for where `recentEvents`/`upcomingAlerts` come from, and [Audio Mode & Onboarding](#audio-mode--onboarding) below for the identity/situation half. Mirrored by hand between `src/services/ai/live/ephemeralToken.ts` (frontend) and `server/src/services/cropDoctorConfig.ts` (backend) — there is no shared module across that boundary, and `server/src/routes/liveRoutes.ts`'s zod schema must accept every field the frontend sends or it is silently stripped before `createLiveToken()` ever sees it.

---

## Audio Mode & Onboarding

- **What it is**: the app's first-run flow (`src/features/onboarding/OnboardingGate.tsx`) plus a conversational voice mode (`src/features/voice-mode/VoiceMode.tsx`) built on Sarvam AI. On a farmer's first-ever visit — gated on a dedicated `farmStore.onboardingComplete` flag (`services/identity/farmerIdentity.ts`'s `isOnboardingComplete()`/`markOnboardingComplete()`), kept deliberately separate from the farmer's name so setting the name doesn't itself unmount the gate before the mode-choice screen ever shows — the app asks for their name (by voice, with a mic-denied/no-key text fallback and a confirm-or-edit step, since raw STT transcripts can include filler words), then offers two primary modes:
  - **Audio Mode**: conversational voice, powered by Sarvam AI's `saaras:v3` speech-to-text and `bulbul:v3` text-to-speech.
  - **Video Mode**: routes straight into [Crop Doctor (Live)](#crop-doctor-live-agent) — reframed here as the second primary mode rather than a secondary feature, with no separate implementation.
  - Both modes stay reachable afterward from the header ("Audio Mode" / "Crop Doctor" buttons) — onboarding is a first-run nudge, not a lock.
- **Audio Mode is a speech layer, not a second brain**: unlike Team 012's `voice` branch reference implementation (which this was adapted from, not copied — it called Gemini directly from the browser with a client-exposed key and re-implemented farm-question answering from scratch), Audio Mode's "brain" is the SAME [`answer-farm-question`](#skill-answer-farm-question) A2A skill the typed Farm Advisor calls. That means one prompt to maintain, one place mem0 memory is wired in, one harness log, one safety boundary — Sarvam only supplies ears and a voice on top of infrastructure that already existed.
- **Security — no client-exposed key**: Sarvam has no ephemeral-token/direct-connect mode like Gemini Live, so `SARVAM_API_KEY` stays server-side and every speech turn is proxied through `server/src/routes/voiceRoutes.ts` / `server/src/services/sarvamProxy.ts` (`POST /api/voice/speech-to-text`, `POST /api/voice/text-to-speech`, `GET /api/voice/status`) — the same trust boundary as `/api/ai/generate`, just for audio.
- **Recording — real WAV, not a relabeled container**: `src/services/voice/AudioRecorder.ts` captures raw PCM directly via the Web Audio API (the same technique `CropDoctorSession.ts` uses for its mic pipeline) and `wavEncoder.ts` wraps it in a genuine 16kHz mono PCM16 WAV file. This was a deliberate correction, confirmed against the live API: Sarvam's `/speech-to-text` validates the declared content-type against a strict allowlist that does NOT include `audio/webm` — the only format a browser's `MediaRecorder` can produce on most platforms — and an early version of this code that reported the recorder's honest `audio/webm` mime type was rejected with `HTTP 400: Invalid file type`. The reference implementation avoided that specific error by mislabeling its webm/opus blob as `audio/wav`, which only avoids the validation error, not the underlying mismatch between declared and actual bytes. Also keeps the reference's voice-activity-detection idea: recording auto-stops after ~2s of silence following detected speech.
- **Speaking a long answer — chunked under Sarvam's per-call limit**: `src/services/voice/speak.ts` is the one place both `VoiceMode` and `OnboardingGate` call to speak text aloud, instead of hitting `sarvamClient.synthesizeSpeech()` directly. Confirmed against the live API: a single `inputs[0]` over 500 characters is rejected with `HTTP 400: String should have at most 500 characters` — and the knowledge-base-grounded fallback answers (`buildLocalFarmAnswer`) are written for on-screen reading, not speech, so they routinely run past that. `ttsChunking.ts`'s `chunkTextForTts()` greedily packs sentences into ≤500-character pieces (pure and unit tested, including a hard-slice fallback for a run-on sentence with no punctuation at all); `speak()` plays each resulting clip back-to-back.
- **Speaking never masks a correct answer**: `speak()` never throws — a synthesis failure on one chunk just stops playback there, since the answer is already computed, stored, and on screen by the time narration starts. `VoiceMode.askQuestion()` deliberately keeps the answer-generation step (dispatch/storage/memory, which CAN legitimately fail and must surface as an error) in a separate try block from the speaking step, so a TTS hiccup can never make a correct answer look like it failed.
- **Speaking never hangs the UI**: `playOnce()` inside `speak.ts` races each clip's `ended`/`error` event against a 45-second safety-net timeout, so a single stalled `<audio>` element (bad clip, a browser tab frozen in the background, whatever) can never leave the mic permanently disabled on "speaking…". Verified with fake timers (`src/tests/speak.test.ts`) since real audio-element event timing isn't controllable in a test environment.
- **The context-assembly layer**: `src/services/context/farmContext.ts`'s `getFarmContextSnapshot()` is the one place that reads "who is this farmer, what crop, what situation" from `farmStore` — used by Audio Mode, the typed Farm Advisor, and Crop Doctor's live-token request, so every agent personalises consistently instead of each screen deriving context its own way.
- **Identity**: `src/services/identity/farmerIdentity.ts` — the farmer's name, `localStorage`-scoped to this device (mirrors `services/session/sessionId.ts`), read once into `farmStore.farmerName` and persisted through `setFarmerName()`.
- **Closing the real "no farm context" gap — `declaredSituation`**: `farmStore.profile`/`selectedCrop` only ever get set by walking the pre-sowing wizard, but Audio Mode is the app's default landing screen (see "Front door" below) — a farmer who only ever uses Audio Mode would otherwise get generic, knowledge-base-only answers forever, exactly contradicting the point of the context-assembly layer above. `useVoiceConversation.ts`'s `askQuestion()` opportunistically captures the first sufficiently substantial thing a farmer says (≥15 characters, ≥3 words — long enough to filter out "hi"/"hello") as `farmerIdentity.ts`'s `declaredSituation`, verbatim, once, `localStorage`-persisted like the farmer's name. Never treated as engine-verified (per [[krishi-mitra-ai-boundary]]): `answerFarmQuestionPrompt.ts` surfaces it under its own clearly-labelled "What the farmer has told us directly" section, informational only, identical in spirit to how mem0 memories are framed, and real `profile`/`crop` facts always win if both exist (`farmContext.ts`'s `summariseSituation()` only falls back to it when nothing else is known). Read by `FarmAdvisor.tsx` too, and automatically by Crop Doctor's live-token request through `summariseSituation()` — share it once in Audio Mode, every mode benefits, with zero additional wiring per surface.
- **Proactive and reactive, at the front door**: since Audio Mode is where most farmers land, it is also where the [Farm Timeline](#farm-timeline--proactive--reactive-shared-context) is most visible. Proactive: the greeting mentions the single nearest upcoming calendar alert when one exists ("Heads up — aphid risk begins in 3 days"). Reactive: every substantial thing a farmer says is logged as a timeline event (same heuristic as `declaredSituation`), and the quiet "Lab report" icon button (top-right) lets a farmer photograph a soil test and get real pH/N/P/K grounding without ever opening the profile wizard — `useVoiceConversation.ts`'s `uploadLabReport()` calls the same `extract-soil-report` skill the wizard would, storing the result via `services/identity/labReport.ts`.
- **The orb**: one dominant, tappable element (`.voice-orb-wrap` in `globals.css`) carries the mic, the idle/listening/thinking/speaking state, and the visual center of the screen — no separate waveform or boxed status card. Its glow shifts through the app's own Google-brand colors per state (blue→green idle, red→amber recording, blue→violet thinking, green→blue speaking) rather than an unrelated accent, so Audio Mode still reads as the same product as the rest of the app. Deliberately minimal chrome throughout: text-only mode tabs (no pill), a borderless compose input (a hairline, not a card, with the send button fading in only once there's something to send), and inline single-line status/error text instead of stacked alert panels.
- **Type-to-ask compose bar**: the bottom input is a real text field, not just a status caption — typing and pressing send (or Enter) submits the question through the exact same `askQuestion()` path speech does, so a farmer who'd rather type than talk gets the identical dispatch, memory, and spoken-aloud answer.
- **Front door**: `farmStore`'s default `stage` is `'audio-mode'` — opening Krishi Mitra lands directly in Audio Mode, not the profile wizard. The wizard, Digital Twin, and Crop Doctor remain one header tap away.
- **Graceful degradation**: no `SARVAM_API_KEY` → `/api/voice/*` return 503, `OnboardingGate` shows a text-only name field, and `VoiceMode` shows a small inline note pointing to the typed "Ask Advisor" (same brain, no voice) while its own compose bar keeps working. No farmer is ever blocked by a missing key.
- **Running locally — one command, not two**: `npm run dev:full` (root `package.json`, via `concurrently`) starts the Vite dev server AND `server/`'s Express backend together — this is what `.claude/launch.json` runs. Running plain `npm run dev` starts only the frontend half; every `/api/*` call then depends on the backend also running separately (`cd server && npm run dev`), and `vite.config.ts`'s dev proxy is deliberately configured with an `error` handler so a refused connection there (backend not started) degrades to the same clean `503` this app's own "not configured" responses already use, rather than an unhandled-looking raw `500`.
- **Architecture — hooks own the logic, components only render**: `VoiceMode.tsx` and `OnboardingGate.tsx` are both thin views over `useVoiceConversation.ts` and `useOnboarding.ts` respectively. Each hook owns its full state machine, side effects (voice-status check, history load, the silence-detection listener), and every service call (dispatch, storage, memory, recording); the component it backs only decides how that state renders. Splitting it this way is what makes the conversation logic independently unit-testable — `useVoiceConversation.test.ts` (10 tests) and `useOnboarding.test.ts` (7 tests) exercise the full mic lifecycle, error paths, and dispatch wiring via `@testing-library/react`'s `renderHook`, with `AudioRecorder`/`sarvamClient`/`speak`/the A2A orchestrator all mocked at the module boundary — none of it requires mounting the DOM tree the view renders into. The one thing deliberately left in the component rather than the hook: `OnboardingGate`'s GSAP entrance animation, since driving a ref-based DOM animation is a view concern, not conversation logic.
- **Tests**: `src/tests/useVoiceConversation.test.ts` (including reactive timeline logging and `uploadLabReport`'s success/error paths), `src/tests/useOnboarding.test.ts` (see architecture note above), `src/tests/audioModeOnboarding.test.ts` (identity persistence, lab report persistence, context assembly, prompt personalisation, Sarvam client error-surfacing), `src/tests/proactiveEngine.test.ts` and `src/tests/farmTimeline.test.ts` (see [Farm Timeline](#farm-timeline--proactive--reactive-shared-context)), `src/tests/ttsChunking.test.ts` (chunk-size invariants, sentence-boundary splitting, hard-slice fallback), `src/tests/speak.test.ts` (sequential chunk playback, the timeout safety net via fake timers, never-throws-on-synthesis-failure), `src/tests/wavEncoder.test.ts` (WAV header correctness), `server/src/services/sarvamProxy.test.ts` (STT/TTS request shape, auth header, error mapping).

---

## Long-term Memory (mem0)

- **Location**: `server/src/services/memoryService.ts` (backend) + `src/services/memory/memoryClient.ts` (frontend)
- **What it is**: a semantic memory layer via [mem0](https://mem0.ai), storing durable FACTS extracted across every conversation a farmer has ever had with any agent ("grows tomatoes on 2 acres in Coimbatore," "already tried neem oil for aphids last season") — distinct from `services/storage`'s per-thread chat transcripts, which keep the full text of one conversation. A new conversation can be personalised without replaying the entire history.
- **Boundary**: **Explains/personalises only, and explicitly non-authoritative.** Recalled memories are injected into the [General Farm Advisor](#general-farm-advisor-agent) and [Calendar Query](#calendar-query-agent) prompts under a clearly labelled "What we remember about this farmer" section, with an explicit instruction that the current farm context always wins on conflict, and — for Calendar Query specifically — memories are never eligible for `citedFacts`, which stays day-data-only.
- **Graceful degradation**: same "resolve once, never throw" discipline as `bucketStore.ts` and `geminiProxy.ts`. With no `MEM0_API_KEY`, `getMemoryBackend()` resolves to a `NullMemoryBackend` and every recall/record call is a safe no-op — every feature works identically, just without cross-conversation personalisation. A network failure against a configured mem0 account degrades the same way rather than breaking the calling agent's answer.
- **Wiring**: `FarmAdvisor.tsx` and `CropCalendar.tsx` both call `recallMemories(question)` before dispatching, pass the result as `memories` in the skill input, and call `recordMemory()` for both the farmer's question and the agent's answer afterward (fire-and-forget, never blocking the UI).
- **Routes**: `POST /api/sessions/:sessionId/memory` (record one turn), `GET /api/sessions/:sessionId/memory?query=...&limit=` (recall).
- **Tests**: `server/src/services/memoryService.test.ts`, `src/tests/memoryIntegration.test.ts`.

---

## Cultivation Calendar Engine

- **Location**: `src/engine/cropCalendarEngine.ts` (deterministic) + `src/features/crop-calendar/CropCalendar.tsx` (UI)
- **Boundary**: **Decides.** Not an AI agent — a pure function from `FarmProfile` + `Crop` + `RecommendationResult` + `SoilGapAnalysisResult` + `PestRisk[]` to a day-by-day plan. Every task/risk attached to a day is copied verbatim from data an engine already computed; phase boundaries (soil-prep → germination → vegetative → flowering → maturation → harvest-window) are generic phenological proportions of `crop.durationDays`, stated as such rather than presented as crop-specific science.
- **What it does**: anchors a sowing date to the 1st of the farmer's chosen sowing month (rolled to next year if that month has already started), then renders a real month-grid calendar from soil-prep through harvest, color-coded by phase, with milestone markers and pest-risk flags during the vulnerable growth window.
- **Why it's the AI's ground truth**: this closed set of per-day facts is exactly what `CalendarQueryAgent` is allowed to reference — the engine decides what's true about a day, the agent only explains it in response to a question.
- **Tests**: `src/tests/cropCalendarEngine.test.ts` — determinism, prep-day placement, phase transitions, pest-risk windowing, harvest milestone.

---

## Farm Timeline — Proactive & Reactive shared context

- **Location**: `src/engine/proactiveEngine.ts` (deterministic, proactive) + `src/engine/currentCropCalendar.ts` (shared plan builder) + `src/services/timeline/farmTimeline.ts` (persistence, reactive) + `src/services/identity/labReport.ts` (soil numbers independent of the wizard) + `src/services/context/farmContext.ts` (assembly, read by every agent/mode).
- **Boundary**: **Decides** (proactive half, deterministic) **/ records** (reactive half) — neither is an AI agent, and neither originates a fact an agent may treat as more authoritative than what it actually says. See [[krishi-mitra-ai-boundary]].
- **What it closes**: every agent previously only knew a farmer's *identity* (name, `declaredSituation`) and *static* facts (`profile`, top recommendation) — nothing about what had actually happened on the farm, and nothing forward-looking outside the Cultivation Calendar screen itself, which is gated behind the pre-sowing wizard and invisible to an audio-only farmer (Audio Mode is the app's default landing screen). This is the shared, timestamped record every mode now reads and writes through the same `farmContext.ts` snapshot — "carefully managed shared memory," not a parallel context system per agent.

### Proactive: `engine/proactiveEngine.ts`
- **Decides, deterministically — not an AI agent.** `buildProactiveAlerts(plan, referenceDate, options?)` walks the SAME `CropCalendarPlan` the Cultivation Calendar Engine already computes and returns milestones plus newly-opening pest-risk windows within the next 7 days (configurable via `lookAheadDays`). Every alert is copied verbatim from a day the engine already scored — nothing here is predicted by a model. A risk already open before `referenceDate` is never repeated; only the day it first opens is surfaced.
- **One plan, two call sites, never two answers**: `engine/currentCropCalendar.ts#deriveCurrentCropCalendarPlan(profile, crop, recommendation)` is the one place that wires soil-gap analysis + the crop's pest list + `cropCalendarEngine.ts` together. Both `CropCalendar.tsx` and `farmContext.ts` call it, so the calendar screen and every agent's "upcoming" context can never disagree about what today's plan actually is.
- **Never persisted.** Unlike the reactive half below, this is recomputed on every `getFarmContextSnapshot()` call — "today" moves, so a stored proactive alert would silently go stale.
- **Where it surfaces**: the Cultivation Calendar's new "Farm Journal" card (upcoming, next 7 days), the Audio Mode greeting ("Heads up — aphid risk begins in 3 days for your groundnut"), and every `answer-farm-question` / Crop Doctor Live prompt as an engine-grounded (not farmer-reported) context section.
- **Tests**: `src/tests/proactiveEngine.test.ts` — window boundaries, dedup of an already-open risk, a custom look-ahead window, ordering, empty-plan safety.

### Reactive: `services/timeline/farmTimeline.ts`
- **Records, never decides.** `logTimelineEvent()` appends one `FarmTimelineEvent` (`localStorage`-persisted, capped at the most recent 40, device-scoped exactly like `farmerIdentity.ts`) whenever something actually happens:
  - A farmer's substantial statement in Audio Mode (`useVoiceConversation.ts`'s `askQuestion()`) — the same ≥15-character/≥3-word heuristic that already gates `declaredSituation` capture, reused rather than reinvented.
  - A farmer's quick note typed into the Cultivation Calendar's Farm Journal card.
  - An engine-verified pest match confirmed live in Crop Doctor (`CropDoctor.tsx`'s `onPestResolved`) — logged only when `matched: true`; a non-match is not itself an event worth remembering.
  - A successful lab report upload (below).
- **Non-authoritative, exactly like `declaredSituation` and mem0 memories.** Every prompt that surfaces recent events labels them "farmer/agent-reported, not verified" — the current farm context always wins on conflict.
- **Tests**: `src/tests/farmTimeline.test.ts` — persistence, most-recent-first ordering, the 40-event cap dropping the oldest first, corrupt/malformed localStorage handled without throwing.

### Lab report grounding: `services/identity/labReport.ts`
- Closes a real "built but unused" gap: the [Soil Report Extractor](#soil-report-extractor-agent) agent and its `extract-soil-report` skill existed with zero UI wired to it anywhere in the app — a farmer could never actually trigger it. `useVoiceConversation.ts`'s new `uploadLabReport(file)` calls that SAME skill through the A2A orchestrator, but stores the reading independently of the wizard's `FarmProfile` (`services/identity/labReport.ts`, `localStorage`-scoped like `farmerIdentity.ts`), so an audio-only farmer who never walks the wizard still gets real pH/N/P/K grounding instead of the model guessing — "logged in, give details, and just speak," with no wizard required in between.
- A successful upload logs a `lab-report` timeline event with the readings taken; an unrecognised document surfaces the model's own warning text (e.g. "too blurry") rather than a generic failure.
- **UI**: a quiet icon-only "Lab report" button, top-right of the Audio Mode screen — deliberately not competing with the orb.
- **Scope note**: `FarmProfileForm.tsx` does not pre-fill from a stored lab report — kept out of scope to avoid ever silently overwriting a farmer's own typed entry with an old photo's reading.
- **Tests**: the `labReport (services/identity)` block in `src/tests/audioModeOnboarding.test.ts` — persistence, corrupt-data safety, and that `farmContext.ts` prefers the wizard profile's numbers over an uploaded lab report whenever both exist.

### How every agent sees it
`services/context/farmContext.ts`'s `FarmContextSnapshot` gained three fields — `recentEvents` (last 5, reactive), `upcomingAlerts` (next 7 days, proactive), `labReport` — assembled once and read identically by `answer-farm-question` ([General Farm Advisor](#general-farm-advisor-agent), used by both the typed Advisor and Audio Mode) and [Crop Doctor Live](#crop-doctor-live-agent)'s system instruction. One assembly point, every consumer — the same discipline `declaredSituation` established, now extended rather than duplicated.

**Distinguishing the app's "memory" layers** — easy to conflate, deliberately different jobs:

| Layer | What it holds | Persisted? | Authoritative? |
|---|---|---|---|
| `declaredSituation` | One opportunistic, one-shot sentence | Yes (localStorage) | No — informational fallback only |
| Farm Timeline (`farmTimeline.ts`) | A growing, timestamped log of discrete events | Yes (localStorage, capped at 40) | No — farmer/agent-reported |
| Proactive alerts (`proactiveEngine.ts`) | What the calendar predicts next | No — recomputed fresh every call | Yes — engine-computed, same tier as the recommendation itself |
| Weather alerts (`weatherRules.ts`) | What the forecast predicts next | No — fetched + recomputed fresh every call | Yes — engine-computed, same tier as `proactiveEngine.ts` |
| mem0 (`memoryClient.ts`) | Semantic facts extracted across ALL past conversations | Yes (mem0's own hosted store) | No — informational, current context always wins |

---

## Weather-based proactive alerts

- **Location**: `server/src/services/weatherProxy.ts` (server-side API call) + `server/src/routes/weatherRoutes.ts` (proxy routes) + `src/services/weather/weatherClient.ts` (frontend client) + `src/engine/weatherRules.ts` (deterministic thresholds) + `src/services/weather/weatherContext.ts` (glue, used by every consumer).
- **Boundary**: **Decides**, deterministically — not an AI agent, and structurally identical in spirit to [Farm Timeline](#farm-timeline--proactive--reactive-shared-context)'s proactive half: a forecast day either crosses a fixed threshold or it doesn't. No model ever sees raw weather data and decides what it means; `weatherRules.ts` decides, agents only relay the resulting `FarmTimelineEvent` the same way they relay a calendar milestone.
- **Data source**: [Google Maps Platform's Weather API](https://developers.google.com/maps/documentation/weather) (`forecast/days:lookup`) — generally available since June 2025, India is within the supported region set, metric units requested explicitly. `GOOGLE_WEATHER_API_KEY` is read server-side only, same trust boundary as `GEMINI_API_KEY`/`SARVAM_API_KEY`; the browser never sees it.
- **Location resolution is a closed set, not free-form geocoding**: the frontend sends a `region` name (one of the four `FarmProfileForm.tsx` already offers — Coimbatore, Pollachi, Tiruppur, Mettupalayam); `weatherProxy.ts`'s `REGION_COORDINATES` resolves that to lat/lng server-side. A request can never spend this app's paid API quota on an arbitrary global coordinate — the same closed-set discipline this app already applies to crops and pests.
- **The four alert rules** (`engine/weatherRules.ts`), each a plain, documented threshold an agronomist would recognise:
  - **Heavy rain** — ≥70% probability AND ≥10mm expected: postpone spraying/fertiliser/harvest that day.
  - **High wind** — ≥20 km/h: avoid spraying due to drift risk.
  - **Heat stress** — ≥38°C forecast high: increase irrigation, avoid midday fieldwork.
  - **Thunderstorms** — ≥50% probability: avoid fieldwork, postpone spraying.
  
  A single day can raise more than one alert (e.g. hot AND windy); nothing is deduplicated across days the way `proactiveEngine.ts` dedupes a continuously-open pest-risk window, since each day's forecast is independent.
- **Merged into the SAME `upcomingAlerts` list the calendar's proactive alerts already populate** — `services/weather/weatherContext.ts#getWeatherProactiveAlerts(region)` returns `FarmTimelineEvent[]`, and every consumer concatenates it with `farmContext.ts`'s calendar-derived `upcomingAlerts` before use, rather than threading a separate "weather" field through every prompt/UI surface that already understands this shape. Wired into:
  - **Audio Mode** (`useVoiceConversation.ts`) — both the front-door greeting's "Heads up" line and every `answer-farm-question` dispatch.
  - **The typed Advisor** (`FarmAdvisor.tsx`) — every dispatch.
  - **Crop Doctor Live** (`CropDoctor.tsx`) — folded into the same `upcomingAlerts` sent to `buildCropDoctorSystemInstruction`.
  - **The Cultivation Calendar's Farm Journal** (`CropCalendar.tsx`) — merged into the "Upcoming · predicted" list shown alongside calendar milestones. Unlike the calendar's own alerts (a `useMemo`, since the plan is already in memory), this is a `useEffect` + `useState` fetch, since a live network call can't live inside a synchronous memo.
- **Graceful degradation, thoroughly**: no key configured, an unknown/missing region, or any network failure all resolve to `[]` at every layer (`weatherClient.ts`, `weatherContext.ts`) — nothing ever throws into a caller, and every proactive-alert surface simply falls back to showing only the calendar's own alerts, exactly as it did before this feature existed.
- **Tests**: `server/src/services/weatherProxy.test.ts` (region validation, request shape, response mapping, HTTP and in-body error handling), `src/tests/weatherRules.test.ts` (every threshold, null-safety, multi-alert days, sort order), `src/tests/weatherContext.test.ts` (no-region short-circuit, degrade-to-`[]` on rejection).

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
- **Relationship to Audio Mode**: this widget is command-and-control (navigate, read back a number) via free browser speech recognition; it is intentionally NOT the conversational voice experience. That is [Audio Mode](#audio-mode--onboarding) — a separate, Sarvam-AI-powered feature with its own recording/STT/TTS pipeline, since open-ended farming Q&A needs a real model in the loop, not keyword matching. The two coexist: this widget for fast navigation from anywhere, Audio Mode for actually talking through a question.
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

### A `VITE_*` env variable that silently read as empty — how, and the actual fix

For a stretch of this project's development, `VITE_AI_TRANSPORT=server` was correctly set in
`.env`, `server/` correctly held a real `GEMINI_API_KEY`, and the app STILL ran in "offline mode"
— every answer came from the deterministic local fallback, `AiTracePanel` showed `OFFLINE` /
`no transport`, and no error appeared anywhere. The cause: `harnessConfig.ts` (and four other
files reading `VITE_API_BASE_URL` — `services/memory/memoryClient.ts`,
`services/storage/index.ts`, `services/voice/sarvamClient.ts`, `services/ai/live/ephemeralToken.ts`)
all read `import.meta.env` through an indirection:

```ts
// Looked completely reasonable. Silently resolved to nothing under Vite's dev-mode
// client injection, with no thrown error anywhere.
const meta = import.meta as unknown as { env?: Record<string, unknown> };
const metaEnv = meta ? meta.env : undefined;
```

instead of the direct literal form:

```ts
const metaEnv = import.meta.env;
```

Confirmed empirically (fetching the module fresh with cache disabled, comparing both forms
side by side in the same file): Vite's dev server only reliably populates `import.meta.env` for
a module when a literal `import.meta.env` (or `import.meta.env.KEY`) expression appears
somewhere in that module's own source for it to recognise. Access it only through a renamed
local variable, and `import.meta` at runtime is a bare `{ url: string }` — no thrown error, no
warning, just an object with the property silently absent, which is exactly the shape
`resolveEnvSource`'s own defensive `if (metaEnv && typeof metaEnv === "object")` guard was
written to treat as "not configured." A correct fallback design faithfully executing on a false
premise, with the harness's own "never throw, degrade gracefully" philosophy actively working
against diagnosing it — this failed exactly the way it was built to fail safe.

Two real fixes landed, not one workaround:
1. **The actual bug**: rewrote every one of those five files to read `import.meta.env` directly
   (see the comment on `resolveEnvSource` in `harnessConfig.ts`).
2. **Why it typechecked despite being wrong**: no `src/vite-env.d.ts` existed, so
   `import.meta.env` had no real type and every reader needed an `as unknown as {...}` cast to
   compile at all — which is exactly the shape of the broken indirection. Added
   `src/vite-env.d.ts` with `/// <reference types="vite/client" />` plus an explicit
   `ImportMetaEnv` augmentation listing every `VITE_*` variable this app actually reads, so
   direct `import.meta.env.VITE_X` access both typechecks cleanly AND catches a typo'd variable
   name as a compile error instead of a silent `undefined`.

`vite.config.ts` also pins `envDir` explicitly to its own directory — a legitimate defensive
addition made while chasing this bug, but NOT what actually fixed it (`process.cwd()` was
already correct throughout); kept because it costs nothing and removes a real class of future
"which directory is `.env` loaded from" failure modes.

---

## Storage & Persistence Architecture

Krishi Mitra persists through THREE independent, individually-optional backends, resolved once
at server startup (`server/src/index.ts`'s `main()`) and injected into whichever routes need
them — never re-evaluated per request, and never required for the app to run:

| Backend | Module | Used for | Enabled by | Local/unconfigured fallback |
|---|---|---|---|---|
| Object storage (JSON blobs) | `storage/bucketStore.ts` — `StorageBackend` | Session profile + chat threads (`sessions/{sessionId}/...`) | `GCS_BUCKET_NAME` | In-process `Map`, lost on restart |
| Object storage (binary files) | `storage/fileStore.ts` — `FileBackend` | Original uploaded soil-report photos/PDFs (`soil-reports/{sessionId}/{reportId}.{ext}`) | Same `GCS_BUCKET_NAME`, different prefix, same bucket | In-process `Map<string, Buffer>`, lost on restart |
| Document store | `storage/documentStore.ts` — `DocumentBackend` | Marketplace orders/listings, soil-report extraction metadata — anything queried or written concurrently by more than one caller | `FIRESTORE_ENABLED=true` | In-process nested `Map`, lost on restart |

**Why three, not one.** Cloud Storage's `StorageBackend` models exactly one JSON blob per path —
perfect for "this session's profile," terrible for "the shared list of every marketplace order,"
because a shared list means every write is a read-modify-write of the SAME object, and two Cloud
Run instances doing that concurrently can clobber each other's update (this was a real, documented
limitation of the marketplace store's first design). Firestore's `DocumentBackend` gives every
record — one order, one listing, one soil-report reading — its OWN document: concurrent writers
touch different documents, so there is nothing to race, and `createIfAbsent()` makes an idempotent
insert atomic at the database level rather than a client-side check-then-write gap. Binary file
bytes never belong in either JSON-shaped abstraction, hence `FileBackend`.

**Choosing where new data goes**: ask "does more than one process ever write to the SAME record
concurrently, or does anything need to query across many records?" — yes → `DocumentBackend`
(Firestore). "Is this one blob written by one session, read back later by the same session?" —
yes → `StorageBackend` (GCS JSON). "Is this raw binary (a photo, a PDF, audio)?" — `FileBackend`
(GCS binary), and record any structured metadata about it (who uploaded it, what was extracted)
in `DocumentBackend` alongside a `filePath` pointer, never inline as base64 in a document.

**Enabling in production** (`deploy/DEPLOY.md` has the full runbook): `GCS_BUCKET_NAME` for the
bucket (shared by both object-storage backends), `FIRESTORE_ENABLED=true` PLUS a one-time
`gcloud firestore databases create --location=... --type=firestore-native` per GCP project
(Firestore Native mode isn't auto-provisioned the way a bucket is — hence the explicit opt-in
flag rather than inferring "configured" from ADC alone, mirroring `GcsStorageBackend`'s own
reasoning for why it doesn't infer from "some GCP credential exists" either).

**Auditing/exporting data outside the running app**: `.claude/skills/krishi-mitra-storage/` — a
Claude Code skill + Python CLI covering both Firestore collections and the GCS soil-report
bucket, for the things the Node server deliberately never does itself (bulk export, backup,
listing every record) — see that skill's `SKILL.md` for commands.

---

## FarmConnect Marketplace Integration

- **Location**: `server/src/services/marketplaceStore.ts` + `server/src/storage/marketplaceTypes.ts` (backend, Firestore-backed) + `server/src/routes/marketplaceRoutes.ts` (API) + `server/src/services/marketDemand.ts` (deterministic analysis) + `src/services/marketplace/marketplaceClient.ts` (Krishi Mitra's frontend client) + `marketplace/` (FarmConnect — the independently-deployed, plain-JS consumer/farmer app; no server of its own).
- **What it is**: the shared backend seam between two separate apps. FarmConnect's `marketplace/js/bridge.js` pushes every new consumer request here (`POST /api/marketplace/orders/sync`), which is what lets a farmer ask Krishi Mitra "what's the demand for my crop" and get a REAL number back instead of nothing. Krishi Mitra pushes the other direction (`POST /api/marketplace/listings`) when a farmer says "let's sell it," and FarmConnect's bridge polls `GET /api/marketplace/listings/new` to turn each into a local consumer notification.
- **Boundary**: **Perceives only.** `marketDemand.ts`'s `analyzeMarketDemand()` is a pure function over the raw synced orders — request count, total quantity, most-common unit, and a **median** suggested price, purely arithmetic, no model call. See [[krishi-mitra-ai-boundary]]: this is exactly the kind of number a farmer-facing tool must never let an LLM originate or adjust.
- **Persistence**: `DocumentBackend` (`server/src/storage/documentStore.ts`) — Firestore when `FIRESTORE_ENABLED=true`, an in-process fallback otherwise, resolved once at startup and passed into `createMarketplaceRoutes(documents)`. Two collections (source of truth: `marketplaceTypes.ts`):

  ```
  marketplace_orders    document id = externalId — atomic createIfAbsent() makes a retried sync race-free
  marketplace_listings  document id = server-generated uuid
  ```

  Each document IS the permanent record (unlike the earlier GCS-blob design's "bounded index vs.
  unbounded dated record" split — that distinction no longer exists, since Firestore doesn't
  require a single shared blob per collection). `MarketplaceStore` is stateless between calls —
  every method queries the collection directly rather than trusting a long-lived in-memory cache
  — so demand numbers and the bridge's poll stay correct across a Cloud Run restart AND across
  multiple concurrently-running instances, with no read-modify-write race on a shared array left
  to lose (this is the actual fix for the limitation the previous GCS-backed design documented
  here; see the git history of this file if you want the old design for reference).
- **Input hygiene**: `externalId` (FarmConnect's own order id) is used directly as this order's Firestore document id, so `marketplaceRoutes.ts` restricts it to `^[A-Za-z0-9_-]{1,100}$` — the same "reject path-breaking characters at the boundary" discipline `sessionRoutes.ts` already applies to `sessionId`.
- **User data note**: FarmConnect itself has no server or auth — `marketplace/js/store.js` keeps every user (name, phone number, role) and "login" (phone-number lookup, no password) in the browser's own `localStorage`. Only `consumerId`/`consumerName` cross the bridge into Firestore, as part of a synced order. This is demo-scope by design, not a real auth system — never store anything in FarmConnect beyond what a hackathon demo needs.
- **Auditing the data**: see the `krishi-mitra-storage` Claude Code skill (`.claude/skills/krishi-mitra-storage/SKILL.md`) — its Python CLI queries these Firestore collections directly for export/backup/debugging, the one thing the Node server deliberately never does itself (no bucket/collection-wide "list" call on any farmer-facing request path).
- **Tests**: `server/src/services/marketplaceStore.test.ts` (idempotent sync — including a concurrent-double-sync race test — fuzzy crop matching, listing queries — using the same `MemoryDocumentBackend` a real Firestore-less deploy falls back to), `server/src/services/marketDemand.test.ts` (pure demand arithmetic), `server/src/storage/documentStore.test.ts` (the backend abstraction itself).

---

## Soil Report Upload & Persistence

- **Location**: `src/services/ai/providers/GeminiSoilReportExtractor.ts` + `src/services/ai/tasks/extractSoilReportTask.ts` (extraction — unchanged, pre-existing) + `src/features/voice-mode/useVoiceConversation.ts`'s `uploadLabReport` (the ONE UI entry point for this today, in Audio Mode) + `src/services/soilReport/soilReportClient.ts` (new persistence client) + `server/src/routes/soilReportRoutes.ts` + `server/src/storage/soilReportTypes.ts` (new backend persistence).
- **What it is**: a farmer photographs (or uploads a PDF of) their Soil Health Card from Audio Mode's "Lab report" button. `GeminiSoilReportExtractor` reads it via the SAME `extract-soil-report` A2A skill/harness every other AI call in this app goes through — nothing new was built for the extraction itself, since it already worked correctly and already routes through `ServerProxyTransport`/`server/src/routes/aiRoutes.ts` in a production deploy (`VITE_AI_TRANSPORT=server`). What was missing, and is what this section documents: **the original file and the extracted reading were never durably stored anywhere** — only an ephemeral `localStorage` copy of the reading on one device, and the file itself was discarded after the request.
- **Boundary**: **Perceives only**, unchanged — see [[krishi-mitra-ai-boundary]] and `GeminiSoilReportExtractor.ts`'s own header (`toPartialProfile` independently re-validates every field; a rejected value is omitted, never clamped or guessed, so a farmer's own entry is never silently overwritten). This section adds durability, not a new AI capability, and never lets a persisted reading skip the same validation a fresh one gets — `server/src/storage/soilReportTypes.ts`'s `SoilReportExtractionSchema` re-validates the shape the client sends, the same "never trust the network, even your own frontend" posture `sessionRoutes.ts` already applies.
- **File types**: `image/jpeg`, `image/png`, `image/webp`, `image/heic`, and now **`application/pdf`** — many state agri departments issue the Soil Health Card as a downloadable PDF rather than a physical printout, and Gemini's `inlineData` part accepts a PDF exactly like an image. The upload button's `accept` attribute and `GeminiSoilReportExtractor.ts`'s allow-list were both extended together; anything outside this list is coerced to `image/jpeg` (unchanged fallback behaviour) rather than rejected client-side.
- **Persistence, split across both backends by what each is good at**:
  - The ORIGINAL file → `FileBackend` (`storage/fileStore.ts`) at `soil-reports/{sessionId}/{reportId}.{ext}` — binary, occasionally re-examined by a human, never queried.
  - The EXTRACTED structured reading (`ph`, N/P/K, confidence, warnings, provenance) → `DocumentBackend`'s `soil_reports` collection, keyed by a server-generated `reportId`, queryable by `sessionId` — this is what makes "give me this farmer's latest reading" a real query instead of "hope the right browser still has it in `localStorage`."
  - `POST /api/soil-reports` does both writes in one call (client sends the file bytes it already has plus the extraction result it already computed — no second Gemini call, no duplicated prompt/schema on the server). `GET /api/soil-reports/:sessionId/latest` reads the newest one back.
- **Cross-device restore**: on mount, `useVoiceConversation` checks `services/identity/labReport.ts`'s local copy first; only if THIS device has never captured one does it call `getLatestSoilReport(sessionId)` — so a farmer who uploaded from one phone and opens the app on another (same anonymous `sessionId`, since that's `localStorage`-scoped per device too — genuinely cross-device restore requires the farmer to still be on session ids that happen to match, which today means the same browser profile; a real account system would be the next step here, not something this pass added) sees their reading rather than nothing. Never overwrites an existing local reading.
- **Size limit**: 10MB decoded (`MAX_FILE_BYTES` in `soilReportRoutes.ts`) — generous for a phone photo or a multi-page scanned PDF. The server's JSON body limit was raised from 5MB to 15MB (`index.ts`) to give the base64-inflated (~4/3) request room to arrive before that check runs.
- **Never blocks the visible feature**: `persistSoilReport()` is fire-and-forget from `uploadLabReport` — the farmer's reading is already applied to `labReport` state before the persistence call is even made, so a Firestore/GCS outage degrades to "not durably saved yet," never to "the upload failed," mirroring `marketplaceClient.ts`'s posture exactly.
- **Tests**: `server/src/storage/fileStore.test.ts` (binary round-trip fidelity), `server/src/storage/documentStore.test.ts` (query semantics the routes depend on). No new frontend UI was built beyond extending the existing Audio Mode upload button — the wizard's own dedicated soil-report step referenced in `GeminiSoilReportExtractor.ts`'s comments remains unbuilt; see "Known gaps" below.

**Known gap, stated plainly**: this is still the ONLY upload entry point in the app (Audio Mode's
"Lab report" button) — the pre-sowing wizard has no dedicated soil-report upload step of its own,
despite `toPartialProfile`'s existence implying one was planned. A farmer who never opens Audio
Mode still has no way to photograph a Soil Health Card. Fixing that is a UI task for the wizard,
not a storage task, and out of scope for this pass.

---

## How a new agent gets added

1. Write the task (`buildPrompt`, `schema`, `fallback`, `cacheKey`) under `src/services/ai/tasks/`, same as the four above.
2. Wrap it in an `AntigravityAdkAgent` subclass under `src/services/ai/agents/` for name/role/model metadata.
3. Register an `A2AAgentRegistration` in `src/services/ai/a2a/agentRegistrations.ts`, with the skill's `run()` calling `getAiHarness().run(createYourTask(), input)` — never a shortcut around the harness.
4. Add a row to the roster table and a section to this file.
5. If the new skill can influence a score, ranking, financial figure or dose: stop. That decision belongs in `src/engine/`, not here.
