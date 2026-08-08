# Thulir

Thulir is an explainable agricultural decision-support application. Crop recommendations, soil corrections, and financial calculations remain deterministic; Google Gemini provides a grounded natural-language advisory layer.

## Local setup

```text
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Set `GEMINI_API_KEY` in `.env.local` before starting the server. The key is read only by the local API middleware or deployed serverless API route and must never use a `VITE_` prefix.

Optional configuration:

```text
GEMINI_MODEL=gemini-3.6-flash
```

Without a configured key, the advisor clearly displays its verified local-knowledge fallback.
