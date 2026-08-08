/**
 * Namespaced, TTL-bounded, `localStorage`-backed response cache for the AI harness.
 *
 * TOTALITY CONTRACT: **no method on this class may ever throw.** It runs on the critical path
 * of a farmer-facing offline-first app where storage may be missing (SSR / vitest without
 * jsdom), disabled (Safari private mode), full (QuotaExceededError), or corrupt (a half-written
 * entry, or a value written by an older build). Every one of those is a normal condition that
 * degrades to a cache miss, never to an exception.
 *
 * Storage layout — one flat key per entry:
 *   `<namespace>:<key>`  ->  JSON `{ v: <value>, e: <expiryEpochMs>, t: <storedAtEpochMs> }`
 *
 * The `t` (stored-at) stamp is what makes LRU-ish eviction possible: on a quota error we drop
 * the oldest entries in *our own* namespace and retry once, so a full disk never permanently
 * disables caching and we never touch keys belonging to other parts of the app.
 */

/** Envelope wrapping every cached value. Kept short to minimise storage footprint. */
interface CacheEnvelope<T> {
  /** The cached value. */
  v: T;
  /** Absolute epoch-ms expiry. `now >= e` means stale. */
  e: number;
  /** Absolute epoch-ms write time. Used as the eviction ordering key. */
  t: number;
}

/** Fraction of the namespace evicted when a write hits the storage quota. */
const QUOTA_EVICTION_FRACTION = 0.25;

/** Probe key used to confirm a `Storage` implementation is actually writable. */
const PROBE_KEY = "__krishi_ai_cache_probe__";

/**
 * Resolve a usable `Storage`, or `null`.
 *
 * Presence is not enough — Safari private mode exposes `localStorage` but throws on every
 * `setItem` — so we write and remove a probe key before trusting it.
 */
function resolveDefaultStorage(): Storage | null {
  try {
    const candidate = (globalThis as { localStorage?: Storage }).localStorage;
    if (!candidate || typeof candidate.setItem !== "function") return null;
    candidate.setItem(PROBE_KEY, "1");
    candidate.removeItem(PROBE_KEY);
    return candidate;
  } catch {
    return null;
  }
}

/** Coerce a TTL to a finite, non-negative number. A TTL of 0 disables caching (always stale). */
function normaliseTtl(ttlMs: number): number {
  if (typeof ttlMs !== "number" || !Number.isFinite(ttlMs) || ttlMs < 0) return 0;
  return ttlMs;
}

export class ResponseCache {
  /** Key prefix owning this cache's slice of the shared storage. */
  private readonly prefix: string;
  /** Default lifetime applied to every entry written through `set`. */
  private readonly ttlMs: number;
  /** Resolved backing store, or `null` when storage is unusable (every op becomes a no-op). */
  private readonly storage: Storage | null;

  /**
   * @param namespace Logical partition (e.g. `"krishi-ai"`); becomes the storage key prefix.
   * @param ttlMs Entry lifetime in ms. `0` (or anything invalid) makes every entry instantly stale.
   * @param storage Optional injected `Storage`. Omit to auto-detect `localStorage`; tests can pass
   *   an in-memory stub, or a stub that throws, to exercise the tolerance paths.
   */
  constructor(namespace: string, ttlMs: number, storage?: Storage) {
    const safeNamespace =
      typeof namespace === "string" && namespace.trim().length > 0
        ? namespace.trim()
        : "krishi-ai";
    this.prefix = `${safeNamespace}:`;
    this.ttlMs = normaliseTtl(ttlMs);
    this.storage = storage !== undefined && storage !== null ? storage : resolveDefaultStorage();
  }

  /**
   * Read a fresh value, or `null` for a miss.
   *
   * Returns `null` — never throws — for: no storage, absent key, unparseable JSON, an envelope
   * from an incompatible shape, or an expired entry. Expired and corrupt entries are deleted on
   * sight so a poisoned key cannot linger.
   */
  get<T>(key: string): T | null {
    const storage = this.storage;
    if (!storage) return null;
    const storageKey = this.toStorageKey(key);
    if (storageKey === null) return null;

    try {
      const raw = storage.getItem(storageKey);
      if (typeof raw !== "string" || raw.length === 0) return null;

      const envelope = this.parseEnvelope<T>(raw);
      if (envelope === null) {
        this.removeKey(storageKey);
        return null;
      }
      if (Date.now() >= envelope.e) {
        this.removeKey(storageKey);
        return null;
      }
      return envelope.v;
    } catch {
      return null;
    }
  }

  /**
   * Write a value under this cache's TTL.
   *
   * Silently does nothing when storage is unusable or the value is not JSON-serialisable
   * (circular refs, BigInt). On a write failure — quota is the expected cause — the oldest
   * quarter of *this namespace's* entries is evicted and the write is retried exactly once.
   * A second failure is swallowed: a cache is an optimisation, never a requirement.
   */
  set<T>(key: string, value: T): void {
    const storage = this.storage;
    if (!storage) return;
    const storageKey = this.toStorageKey(key);
    if (storageKey === null) return;

    let serialised: string;
    try {
      const now = Date.now();
      const envelope: CacheEnvelope<T> = { v: value, e: now + this.ttlMs, t: now };
      serialised = JSON.stringify(envelope);
      if (typeof serialised !== "string") return; // JSON.stringify(undefined) === undefined
    } catch {
      return; // Not serialisable — nothing sensible to store.
    }

    try {
      storage.setItem(storageKey, serialised);
      return;
    } catch {
      // Fall through to evict-and-retry. Assumed quota; harmless if it was something else.
    }

    try {
      this.evictOldest();
      storage.setItem(storageKey, serialised);
    } catch {
      // Give up quietly — the harness will simply re-ask the model next time.
    }
  }

  /** Remove every entry in this namespace. Leaves keys owned by other namespaces untouched. */
  clear(): void {
    try {
      for (const storageKey of this.namespaceKeys()) {
        this.removeKey(storageKey);
      }
    } catch {
      // Ignore — clearing is best-effort.
    }
  }

  /**
   * Number of **fresh** entries in this namespace.
   *
   * Expired and corrupt entries are purged as a side effect, so `size()` doubles as a
   * lazy vacuum. Returns `0` when storage is unusable.
   */
  size(): number {
    try {
      const storage = this.storage;
      if (!storage) return 0;
      const now = Date.now();
      let count = 0;
      for (const storageKey of this.namespaceKeys()) {
        const raw = storage.getItem(storageKey);
        const envelope = typeof raw === "string" ? this.parseEnvelope<unknown>(raw) : null;
        if (envelope === null || now >= envelope.e) {
          this.removeKey(storageKey);
          continue;
        }
        count += 1;
      }
      return count;
    } catch {
      return 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Namespace a caller key, or `null` when the key is unusable. */
  private toStorageKey(key: string): string | null {
    if (typeof key !== "string" || key.length === 0) return null;
    return `${this.prefix}${key}`;
  }

  /** Parse and structurally validate a stored envelope. `null` means corrupt/foreign. */
  private parseEnvelope<T>(raw: string): CacheEnvelope<T> | null {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== "object" || parsed === null) return null;
      const candidate = parsed as { v?: unknown; e?: unknown; t?: unknown };
      if (typeof candidate.e !== "number" || !Number.isFinite(candidate.e)) return null;
      if (typeof candidate.t !== "number" || !Number.isFinite(candidate.t)) return null;
      if (!("v" in candidate)) return null;
      return { v: candidate.v as T, e: candidate.e, t: candidate.t };
    } catch {
      return null;
    }
  }

  /** Snapshot of every storage key owned by this namespace. Snapshotting allows safe mutation. */
  private namespaceKeys(): string[] {
    const storage = this.storage;
    if (!storage) return [];
    const keys: string[] = [];
    try {
      const total = typeof storage.length === "number" ? storage.length : 0;
      for (let i = 0; i < total; i += 1) {
        const storageKey = storage.key(i);
        if (typeof storageKey === "string" && storageKey.indexOf(this.prefix) === 0) {
          keys.push(storageKey);
        }
      }
    } catch {
      return keys;
    }
    return keys;
  }

  /** Delete a single key, swallowing any storage error. */
  private removeKey(storageKey: string): void {
    try {
      this.storage?.removeItem(storageKey);
    } catch {
      // Ignore.
    }
  }

  /**
   * Free space for a retried write: drop everything already expired, then — if nothing was
   * expired — drop the oldest {@link QUOTA_EVICTION_FRACTION} of the namespace (at least one
   * entry), ordered by write time.
   */
  private evictOldest(): void {
    const storage = this.storage;
    if (!storage) return;

    const entries: { key: string; storedAt: number }[] = [];
    const now = Date.now();
    let expiredRemoved = 0;

    for (const storageKey of this.namespaceKeys()) {
      let raw: string | null = null;
      try {
        raw = storage.getItem(storageKey);
      } catch {
        raw = null;
      }
      const envelope = typeof raw === "string" ? this.parseEnvelope<unknown>(raw) : null;
      if (envelope === null || now >= envelope.e) {
        this.removeKey(storageKey);
        expiredRemoved += 1;
        continue;
      }
      entries.push({ key: storageKey, storedAt: envelope.t });
    }

    if (expiredRemoved > 0 || entries.length === 0) return;

    entries.sort((a, b) => a.storedAt - b.storedAt);
    const dropCount = Math.max(1, Math.floor(entries.length * QUOTA_EVICTION_FRACTION));
    for (let i = 0; i < dropCount && i < entries.length; i += 1) {
      this.removeKey(entries[i].key);
    }
  }
}
