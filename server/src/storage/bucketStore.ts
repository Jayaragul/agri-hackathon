/**
 * `createStorageBackend()` — resolves ONCE at server startup which persistence backend the
 * process will use for its entire lifetime, and logs the decision clearly to stdout.
 *
 * This mirrors the exact philosophy of `selectTransport()` / `AiHarness` on the frontend
 * (`src/services/ai/transport/selectTransport.ts`, `src/services/ai/runtime/AiHarness.ts`):
 * every external dependency is optional, nothing here ever throws into a request handler, and
 * an absent/broken dependency degrades to a deterministic local alternative rather than
 * crashing the process. No key/bucket configured is a normal, fully-supported state — not an
 * error — so a developer running locally with zero GCP credentials gets a fully working API
 * backed by an in-memory store.
 */

import { Storage } from "@google-cloud/storage";

export interface StorageBackend {
  readJson<T>(path: string): Promise<T | null>;
  writeJson<T>(path: string, data: T): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory fallback
// ---------------------------------------------------------------------------

/**
 * Fallback backend used whenever GCS isn't configured or isn't reachable. Data lives only for
 * the lifetime of the process (lost on redeploy/restart) — acceptable for a hackathon demo's
 * "works with zero cloud dependencies" story. The frontend may additionally keep its own
 * localStorage copy as a client-side fallback; that is out of scope for this server.
 */
export class MemoryStorageBackend implements StorageBackend {
  private readonly store = new Map<string, string>();

  async readJson<T>(path: string): Promise<T | null> {
    const raw = this.store.get(path);
    if (raw === undefined) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // Corrupt in-memory entry should never crash a request; treat as absent.
      return null;
    }
  }

  async writeJson<T>(path: string, data: T): Promise<void> {
    this.store.set(path, JSON.stringify(data));
  }
}

// ---------------------------------------------------------------------------
// Google Cloud Storage backend
// ---------------------------------------------------------------------------

/**
 * Backed by `process.env.GCS_BUCKET_NAME`. Uses Application Default Credentials (the standard
 * approach on Cloud Run — no key file needed when the service's runtime service account has
 * bucket access; see `deploy/DEPLOY.md`).
 */
export class GcsStorageBackend implements StorageBackend {
  private readonly storage: Storage;
  private readonly bucketName: string;

  constructor(bucketName: string) {
    if (!bucketName) throw new Error("GCS_BUCKET_NAME is empty");
    this.bucketName = bucketName;
    this.storage = new Storage();
  }

  async readJson<T>(path: string): Promise<T | null> {
    try {
      const file = this.storage.bucket(this.bucketName).file(path);
      const [exists] = await file.exists();
      if (!exists) return null;
      const [contents] = await file.download();
      const text = contents.toString("utf-8");
      if (text.length === 0) return null;
      return JSON.parse(text) as T;
    } catch (err) {
      // A missing object, transient network blip, or malformed JSON must all resolve to "no
      // data" for the caller, never throw into a request handler.
      console.error(`[storage] GCS readJson failed for "${path}":`, describeError(err));
      return null;
    }
  }

  async writeJson<T>(path: string, data: T): Promise<void> {
    const file = this.storage.bucket(this.bucketName).file(path);
    await file.save(JSON.stringify(data, null, 2), {
      contentType: "application/json",
      resumable: false,
    });
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---------------------------------------------------------------------------
// Factory — resolved once at startup
// ---------------------------------------------------------------------------

/**
 * Decide the storage backend for this process's entire lifetime.
 *
 * - No `GCS_BUCKET_NAME` set                -> in-memory, logged as expected local behaviour.
 * - `GCS_BUCKET_NAME` set but construction
 *   fails (bad credentials, SDK error, ...) -> in-memory, logged as a fallback from a failure.
 * - `GCS_BUCKET_NAME` set and construction
 *   succeeds                                -> GCS. (Construction does not verify bucket access;
 *   a permissions problem surfaces per-request as a caught error, same "degrade, never crash"
 *   rule the route handlers already apply.)
 *
 * Never throws.
 */
export function createStorageBackend(): StorageBackend {
  const bucketName = process.env.GCS_BUCKET_NAME?.trim();

  if (!bucketName) {
    console.log("Storage: in-memory fallback (no GCS_BUCKET_NAME or credentials found)");
    return new MemoryStorageBackend();
  }

  try {
    const backend = new GcsStorageBackend(bucketName);
    console.log(`Storage: Google Cloud Storage (bucket "${bucketName}")`);
    return backend;
  } catch (err) {
    console.log(
      `Storage: in-memory fallback (GCS_BUCKET_NAME="${bucketName}" set, but backend construction failed: ${describeError(
        err
      )})`
    );
    return new MemoryStorageBackend();
  }
}
