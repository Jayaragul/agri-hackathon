# HARNESS PLAN: Krishi Mitra MVP

## Existing Project Assessment
- **Tech Stack**: React 18, TypeScript, Vite, Zustand, Zod, Pure CSS (`globals.css`), Vitest, PWA.
- **Current State**: The UI works end-to-end for a basic workflow (Farm Profile -> Recommendations -> Soil Corrections -> Financials -> Pest Risk -> Action Plan). The architecture isolates state in `zustand` and logic in `engine/`. CSS uses a Minimalist Modern design. The `recommendationEngine` tests pass.
- **Structural Alignment**: The current structure (`components/`, `engine/`, `state/`, `data/`) is close but needs refactoring towards the target architecture (`app/`, `domain/`, `engine/`, `application/`, `data/`, `features/`, `services/`, `i18n/`, `styles/`, `tests/`).
- **PWA Status**: `vite-plugin-pwa` is configured, but robust caching/offline testing strategies must be ensured.
- **Data Status**: We are using CSV files/JSONs but the prompt strictly mandates well-structured datasets for crops, soils, corrections, and pests with explicit validation.
- **Engine Status**: `recommendationEngine.ts` exists. We need `nutrientAnalysis.ts`, `soilGapAnalysis.ts`, `financialEngine.ts`, `pestRiskEngine.ts`, `confidenceEngine.ts`, and `decisionTraceBuilder.ts`. Currently, some of these calculations are bundled or missing complete mathematical robustness.

## Missing Features & Targets
1. **Repository Structure**: Restructure into `domain/`, `engine/`, `application/`, `features/`, `services/`, etc.
2. **Confidence Engine**: Separate suitability score from confidence metric.
3. **Decision Trace**: Implement a formal `DecisionTraceEntry` system to power the "Why This Crop" and "Why Not This Crop" explanations.
4. **Soil Gap Analysis Engine**: Calculate biological (first) and chemical (fallback) solutions based on explicit NPK deficits, compute wait times, and handle conflicting sowing windows.
5. **Financial Engine**: Three scenarios (Conservative, Expected, Optimistic). Ensure safe division by zero and explicit warning for negative profits.
6. **Local AI Explanation Provider**: Offline-first explanation generator based purely on the `DecisionTrace`.
7. **Gemini Adapter**: An optional adapter overlaying the local explanation provider.
8. **Printable Action Plan**: A print-optimized summary of all engines.
9. **Extensive Testing**: We need comprehensive Vitest coverage for all new engines and React Testing Library coverage for the workflow.

## Implementation Phases
- **Phase 1 — Repository audit**: (Complete) Evaluated current structure.
- **Phase 2 — Domain contracts**: Define Models, Zod schemas, Scoring constants, and Safety thresholds in `src/domain/`.
- **Phase 3 — Data layer**: Establish validated sample repositories in `src/data/sample/`.
- **Phase 4 — Domain engines**: Implement Nutrient analysis, Confidence, Decision Trace, Soil-gap analysis, and Financial scenarios in `src/engine/`.
- **Phase 5 — Engine testing**: Implement and pass all Vitest suites for the engines.
- **Phase 6 — Application workflow**: Update `src/state/farmStore.ts` and create `src/application/` use cases.
- **Phase 7 — Interface**: Refactor UI into `src/features/` and build the dynamic explanation views, comparison view, and printable Action Plan.
- **Phase 8 — Offline PWA**: Verify `manifest.json` and service worker caching strategies.
- **Phase 9 — AI abstraction**: Implement `LocalTemplateExplanationProvider` and `GeminiExplanationProvider` in `src/services/explanation/`.
- **Phase 10 — Final validation**: Typecheck, lint, test, build, and offline verification.

## Technical Risks
- **Refactoring Breakage**: Moving files to the new domain-driven structure might break imports. TypeScript's strict checks will mitigate this.
- **Engine Complexity**: Scoring logic (0-100 normalized) must never output NaN or Infinity. Zod schemas must strictly block bad state before it hits the engines.
- **PWA Offline**: Ensuring service workers cache data effectively without blocking updates.

## Acceptance Criteria
- Top-three recommendations are ranked (0-100 normalized).
- Decision trace powers "Why this crop" and "Why not this crop".
- Soil gaps calculate exact wait times and prioritize biological fixes.
- Three financial scenarios correctly apply variance and subtract soil correction costs.
- The UI completes the Golden Workflow entirely offline.
- Test coverage hits all major pure functions.
- The repository structure maps exactly to the provided blueprint.
