# Thulir repository guidance

## Architecture

- Keep crop recommendations and financial calculations deterministic, testable, and explainable.
- Keep business calculations in engines or services, not React components.
- Prefer pure TypeScript functions and avoid duplicated formulas.
- AI may assist with document extraction, translation, or explanations, but must not silently replace the deterministic recommendation engine.

## Scope and data integrity

- Keep changes focused on the requested phase and preserve existing routes and user flows.
- Do not present sample data as live data or fabricate agricultural sources, prices, or update dates.
- Preserve accessibility, mobile behavior, and the existing design system unless a redesign is requested.

## Required checks

Before declaring implementation work complete, run:

```text
npm run typecheck
npm test
npm run build
```

For dependency or build-system changes, also verify a clean `npm ci` first.

## Completion report

Report changed files, the purpose of each change, exact checks and results, assumptions, and unresolved issues.
