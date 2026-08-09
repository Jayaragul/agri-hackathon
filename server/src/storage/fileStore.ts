/**
 * Binary-blob storage — the raw bytes of an uploaded soil-report photo/PDF. Deliberately
 * separate from `bucketStore.ts`'s `StorageBackend` (which is JSON-only: `readJson`/`writeJson`
 * serialize through `JSON.parse`/`JSON.stringify`, which corrupts arbitrary binary data). Both
 * backends point at the SAME `GCS_BUCKET_NAME` bucket when configured — just different path
 * prefixes (`sessions/**` for JSON, `soil-reports/**` for files) — one bucket, two access
 * patterns, same as the marketplace's old design reused the session bucket before it moved to
 * Firestore.
 */

import { Storage } from "@google-cloud/storage";

export interface FileBackend {
  writeFile(path: string, data: Buffer, contentType: string): Promise<void>;
  /** `null` if the object doesn't exist — never throws for a missing file, same "absent is a normal state" rule as `StorageBackend.readJson`. */
  readFile(path: string): Promise<Buffer | null>;
}

// ---------------------------------------------------------------------------
// In-memory fallback
// ---------------------------------------------------------------------------

export class MemoryFileBackend implements FileBackend {
  private readonly store = new Map<string, Buffer>();

  async writeFile(path: string, data: Buffer): Promise<void> {
    this.store.set(path, Buffer.from(data));
  }

  async readFile(path: string): Promise<Buffer | null> {
    const buf = this.store.get(path);
    return buf ? Buffer.from(buf) : null;
  }
}

// ---------------------------------------------------------------------------
// Google Cloud Storage backend
// ---------------------------------------------------------------------------

export class GcsFileBackend implements FileBackend {
  private readonly storage: Storage;
  private readonly bucketName: string;

  constructor(bucketName: string) {
    if (!bucketName) throw new Error("GCS_BUCKET_NAME is empty");
    this.bucketName = bucketName;
    this.storage = new Storage();
  }

  async writeFile(path: string, data: Buffer, contentType: string): Promise<void> {
    const file = this.storage.bucket(this.bucketName).file(path);
    await file.save(data, { contentType, resumable: false });
  }

  async readFile(path: string): Promise<Buffer | null> {
    try {
      const file = this.storage.bucket(this.bucketName).file(path);
      const [exists] = await file.exists();
      if (!exists) return null;
      const [contents] = await file.download();
      return contents;
    } catch (err) {
      console.error(`[fileStore] GCS readFile failed for "${path}":`, describeError(err));
      return null;
    }
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---------------------------------------------------------------------------
// Factory — resolved once at startup, mirrors bucketStore.ts's createStorageBackend()
// ---------------------------------------------------------------------------

export function createFileBackend(): FileBackend {
  const bucketName = process.env.GCS_BUCKET_NAME?.trim();

  if (!bucketName) {
    console.log("Files: in-memory fallback (no GCS_BUCKET_NAME set)");
    return new MemoryFileBackend();
  }

  try {
    const backend = new GcsFileBackend(bucketName);
    console.log(`Files: Google Cloud Storage (bucket "${bucketName}")`);
    return backend;
  } catch (err) {
    console.log(`Files: in-memory fallback (GCS_BUCKET_NAME="${bucketName}" set, but backend construction failed: ${describeError(err)})`);
    return new MemoryFileBackend();
  }
}
