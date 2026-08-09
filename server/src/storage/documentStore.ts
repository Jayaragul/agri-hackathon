/**
 * Document-store abstraction for structured, CONCURRENTLY-WRITTEN data — Firestore when enabled,
 * an in-process fallback otherwise. Same "resolve once at startup, log the decision, never
 * throw into a caller" philosophy as `bucketStore.ts`, but this exists for a reason
 * `bucketStore.ts` structurally cannot solve: `StorageBackend` models one JSON blob per path, so
 * a "shared list" (every marketplace order, every soil report) had to be a single object
 * read-modify-written on every write — two Cloud Run instances doing that concurrently can
 * clobber each other's update. Firestore gives each record its OWN document, so concurrent
 * writers touch different documents and there is nothing to race. `createIfAbsent` additionally
 * gives atomic, race-free idempotent inserts (Firestore's `.create()` fails server-side if the
 * document already exists — no client-side "check then write" gap for a duplicate request to
 * land in).
 *
 * Enabled via `FIRESTORE_ENABLED=true` — deliberately an explicit opt-in, NOT inferred from ADC
 * resolving a project (the way `GcsStorageBackend` infers from `GCS_BUCKET_NAME` being set).
 * Firestore Native mode has to be created once per GCP project
 * (`gcloud firestore databases create --location=... --type=firestore-native`) before any call
 * succeeds; assuming "configured" just because credentials exist would turn a genuinely missing
 * database into a confusing runtime error deep in a request instead of an honest, expected
 * fallback log line at startup — the same reasoning `bucketStore.ts` already documents.
 */

import { Firestore } from "@google-cloud/firestore";

export type WhereOp = "==" | "!=" | "<" | "<=" | ">" | ">=" | "array-contains";

export interface DocumentQuery {
  where?: Array<[field: string, op: WhereOp, value: unknown]>;
  orderByField?: string;
  direction?: "asc" | "desc";
  limit?: number;
}

export interface DocumentBackend {
  /**
   * Atomic create — resolves `false` WITHOUT writing anything if a document with this id
   * already exists, `true` if this call created it. This is the race-free idempotency primitive
   * the marketplace's "don't double-count a retried sync" rule depends on.
   */
  createIfAbsent(collection: string, docId: string, data: Record<string, unknown>): Promise<boolean>;
  /** Upsert — overwrites (merged) whatever was there. Use when there's no idempotency concern (e.g. this process just generated `docId` itself). */
  set(collection: string, docId: string, data: Record<string, unknown>): Promise<void>;
  get<T>(collection: string, docId: string): Promise<T | null>;
  list<T>(collection: string, query?: DocumentQuery): Promise<T[]>;
}

// ---------------------------------------------------------------------------
// In-memory fallback
// ---------------------------------------------------------------------------

/** Local dev / no-Firestore-configured fallback. Data lives only for the process lifetime — same documented tradeoff as `MemoryStorageBackend`. */
export class MemoryDocumentBackend implements DocumentBackend {
  private readonly collections = new Map<string, Map<string, Record<string, unknown>>>();

  private collection(name: string): Map<string, Record<string, unknown>> {
    let coll = this.collections.get(name);
    if (!coll) {
      coll = new Map();
      this.collections.set(name, coll);
    }
    return coll;
  }

  async createIfAbsent(collectionName: string, docId: string, data: Record<string, unknown>): Promise<boolean> {
    const coll = this.collection(collectionName);
    if (coll.has(docId)) return false;
    coll.set(docId, { ...data });
    return true;
  }

  async set(collectionName: string, docId: string, data: Record<string, unknown>): Promise<void> {
    this.collection(collectionName).set(docId, { ...data });
  }

  async get<T>(collectionName: string, docId: string): Promise<T | null> {
    const doc = this.collection(collectionName).get(docId);
    return doc ? (doc as T) : null;
  }

  async list<T>(collectionName: string, query?: DocumentQuery): Promise<T[]> {
    let docs = Array.from(this.collection(collectionName).values());

    for (const [field, op, value] of query?.where ?? []) {
      docs = docs.filter((doc) => matchesWhere(doc[field], op, value));
    }

    if (query?.orderByField) {
      const field = query.orderByField;
      const dir = query.direction === "desc" ? -1 : 1;
      docs = docs.slice().sort((a, b) => {
        const av = a[field] as number | string | undefined;
        const bv = b[field] as number | string | undefined;
        if (av === bv) return 0;
        if (av === undefined) return 1;
        if (bv === undefined) return -1;
        return av < bv ? -1 * dir : 1 * dir;
      });
    }

    if (typeof query?.limit === "number") docs = docs.slice(0, query.limit);
    return docs as T[];
  }
}

function matchesWhere(fieldValue: unknown, op: WhereOp, value: unknown): boolean {
  switch (op) {
    case "==":
      return fieldValue === value;
    case "!=":
      return fieldValue !== value;
    case "<":
      return typeof fieldValue === "number" && typeof value === "number" && fieldValue < value;
    case "<=":
      return typeof fieldValue === "number" && typeof value === "number" && fieldValue <= value;
    case ">":
      return typeof fieldValue === "number" && typeof value === "number" && fieldValue > value;
    case ">=":
      return typeof fieldValue === "number" && typeof value === "number" && fieldValue >= value;
    case "array-contains":
      return Array.isArray(fieldValue) && fieldValue.includes(value);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Firestore backend
// ---------------------------------------------------------------------------

const FIRESTORE_ALREADY_EXISTS_CODE = 6; // google.rpc.Code.ALREADY_EXISTS

function isAlreadyExists(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && (err as { code: unknown }).code === FIRESTORE_ALREADY_EXISTS_CODE;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export class FirestoreDocumentBackend implements DocumentBackend {
  private readonly db: Firestore;

  constructor() {
    this.db = new Firestore();
  }

  async createIfAbsent(collection: string, docId: string, data: Record<string, unknown>): Promise<boolean> {
    try {
      await this.db.collection(collection).doc(docId).create(data);
      return true;
    } catch (err) {
      if (isAlreadyExists(err)) return false;
      throw err;
    }
  }

  async set(collection: string, docId: string, data: Record<string, unknown>): Promise<void> {
    await this.db.collection(collection).doc(docId).set(data, { merge: true });
  }

  async get<T>(collection: string, docId: string): Promise<T | null> {
    const snap = await this.db.collection(collection).doc(docId).get();
    return snap.exists ? (snap.data() as T) : null;
  }

  async list<T>(collection: string, query?: DocumentQuery): Promise<T[]> {
    let q: FirebaseFirestore.Query = this.db.collection(collection);
    for (const [field, op, value] of query?.where ?? []) {
      q = q.where(field, op, value);
    }
    if (query?.orderByField) q = q.orderBy(query.orderByField, query.direction ?? "asc");
    if (typeof query?.limit === "number") q = q.limit(query.limit);

    const snapshot = await q.get();
    return snapshot.docs.map((doc) => doc.data() as T);
  }
}

// ---------------------------------------------------------------------------
// Factory — resolved once at startup
// ---------------------------------------------------------------------------

function isFirestoreEnabled(): boolean {
  const raw = (process.env.FIRESTORE_ENABLED ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

/** Never throws. See the module doc for why this is an explicit opt-in rather than ADC-inferred. */
export function createDocumentBackend(): DocumentBackend {
  if (!isFirestoreEnabled()) {
    console.log("Documents: in-memory fallback (FIRESTORE_ENABLED not set)");
    return new MemoryDocumentBackend();
  }

  try {
    const backend = new FirestoreDocumentBackend();
    console.log("Documents: Google Cloud Firestore");
    return backend;
  } catch (err) {
    console.log(`Documents: in-memory fallback (FIRESTORE_ENABLED=true, but backend construction failed: ${describeError(err)})`);
    return new MemoryDocumentBackend();
  }
}
