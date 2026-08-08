/// <reference types="vite/client" />

// Every VITE_* variable this app actually reads (see .env.example for what each one does).
// Declaring these gives real type-checking on the read side — a typo'd key name becomes a
// compile error instead of a silent `undefined` that degrades the whole feature. All optional:
// every reader already treats an absent/empty value as "use the default," per this app's
// "resolve once, degrade gracefully, never throw" convention.
interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY?: string;
  readonly VITE_GEMINI_MODEL?: string;
  readonly VITE_AI_ENABLED?: string;
  readonly VITE_AI_TRANSPORT?: string;
  readonly VITE_AI_TIMEOUT_MS?: string;
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
