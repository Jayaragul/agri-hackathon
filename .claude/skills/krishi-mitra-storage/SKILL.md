---
name: krishi-mitra-storage
description: Audit, export, or debug Krishi Mitra's cloud persistence — Firestore (marketplace orders/listings, soil-report metadata) and Cloud Storage (session data, uploaded soil-report files). Use after a deploy to confirm data is actually persisting, or to pull data for the pitch deck.
---

# Krishi Mitra storage

Krishi Mitra persists through three independently-optional backends — see `catalog.md`'s
"Storage & Persistence Architecture" section for the full design rationale. This skill is about
auditing the CLOUD side of that (Firestore + GCS bucket), not about writing app code.

## Architecture summary

| Backend | Holds | Enabled by |
|---|---|---|
| GCS bucket, `sessions/**` | Farm profile snapshots, calendar/advisor chat (JSON blobs) | `GCS_BUCKET_NAME` |
| GCS bucket, `soil-reports/**` | Original uploaded soil-report photos/PDFs (binary) | Same `GCS_BUCKET_NAME` |
| Firestore, `marketplace_orders` / `marketplace_listings` | FarmConnect marketplace demand signal | `FIRESTORE_ENABLED=true` |
| Firestore, `soil_reports` | Extracted soil readings (ph, N/P/K, confidence) + a pointer to the file above | Same `FIRESTORE_ENABLED=true` |

The source of truth for exact shapes is code, not this file: `server/src/storage/marketplaceTypes.ts`,
`server/src/storage/soilReportTypes.ts`, `server/src/storage/types.ts`. If this skill and that code
ever disagree, the code wins.

**Why Firestore for some things and GCS-JSON for others**: anything written concurrently by more
than one caller (marketplace orders arrive from an independent app; soil-report metadata could
in principle be queried across a farmer's whole history) gets its own Firestore document — no
shared blob to race on a concurrent write. Anything that's one blob owned by one session
(a farm profile, a chat thread) stays on GCS as JSON — no benefit to a document store there.
Binary bytes (the file itself) never go in either JSON-shaped store; they're `FileBackend`
objects on GCS, with a `filePath` pointer stored in Firestore alongside the metadata.

**The Node server never lists a Firestore collection unbounded, nor lists a bucket prefix at
all**, on any farmer-facing request path — by design (see `documentStore.ts`/`fileStore.ts`
headers). Anything that needs to enumerate records — export, backup, "how many soil reports
total," "did this deploy actually persist" — goes through the Python tool below.

## When to use the Python tool (`scripts/admin.py`)

- Confirming a Cloud Run deploy is actually persisting (not silently running on the in-memory
  fallback because `GCS_BUCKET_NAME`/`FIRESTORE_ENABLED` was never set — see `deploy/DEPLOY.md`).
- Pulling real marketplace demand/soil-report data for a demo, pitch deck, or judge Q&A.
- Debugging "why doesn't my crop show demand" or "where did my uploaded PDF go" — read the raw
  Firestore documents / bucket objects directly instead of only trusting the live API response.
- Taking a point-in-time export before a risky change.

Do NOT reach for it to make either feature "work" day-to-day — the running server already
reads/writes both backends itself. This tool is for a human looking at the data.

## Setup

```bash
cd .claude/skills/krishi-mitra-storage/scripts
pip install -r requirements.txt
gcloud auth application-default login   # once, if not already authenticated locally
```

No service-account key file is used or expected — Application Default Credentials only, same
posture as the Node server: resolved automatically on Cloud Run via the attached service account,
or via the `gcloud auth application-default login` session locally.

## Commands

```bash
# Firestore — marketplace
python admin.py orders --crop tomato --limit 20
python admin.py listings --since 2026-08-01
python admin.py demand --crop tomato --window-days 30

# Firestore — soil reports
python admin.py soil-reports --session-id abc-123-def
python admin.py export-collection --collection soil_reports --out soil_reports.csv

# Cloud Storage — the raw files/blobs (needs --bucket or $GCS_BUCKET_NAME)
python admin.py list-bucket --bucket my-bucket --prefix soil-reports/
python admin.py download-file --bucket my-bucket --path soil-reports/abc-123/r1.pdf --out ./r1.pdf
```

Firestore commands use the default project from `gcloud config`/ADC; pass `--project` to target
a different one explicitly.

## Verifying after a deploy

```bash
export SERVICE_URL=$(gcloud run services describe krishi-mitra --region "$REGION" --format='value(status.url)')

# Smoke-test the marketplace sync path
curl -s -X POST "$SERVICE_URL/api/marketplace/orders/sync" \
  -H 'Content-Type: application/json' \
  -d '{"orders":[{"externalId":"smoke-test-1","productName":"Tomato","quantity":1,"unit":"kg","price":10,"requestedAt":'"$(date +%s000)"'}]}'

python admin.py orders --crop Tomato --limit 1
```

If the order shows up via the Python tool, the deploy is genuinely persisting to Firestore — not
silently running on the in-memory fallback (which answers the API call identically but loses
everything on the next restart, and is invisible to a second Cloud Run instance).

## Known operational notes

- **Firestore composite index**: `GET /api/soil-reports/:sessionId/latest` filters by `sessionId`
  and orders by `extractedAt`. The first real query against a fresh Firestore database may need a
  one-time composite index — Firestore's error message includes a direct console link to create
  it. Do this once right after enabling Firestore (`deploy/DEPLOY.md` step 2a), not mid-demo.
- **Multi-instance safety**: marketplace writes are now per-document (`createIfAbsent`), so
  concurrent Cloud Run instances no longer race on a shared index the way the old GCS-blob design
  did — this was the actual limitation that motivated moving off `bucketStore.ts` for this data.
- **Nothing here is a payments/inventory system of record.** Marketplace data is demand-signal
  data for a farmer's own decision-making, not a transactional ledger — treat exports accordingly.
