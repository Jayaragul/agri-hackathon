# Deploying Thulir to Google Cloud Run

This is a runbook, not a script. Every command below is meant to be run by a human who has
their own GCP project and is authenticated with `gcloud` — nothing here has been executed on
your behalf, and nothing here runs automatically. Read a step before you run it.

The app ships as **one container**: the root `Dockerfile` builds the Vite frontend and the
Express backend (`server/`) together, and the backend serves both the static frontend and its
own `/api/*` routes. You do not need two Cloud Run services.

Persistence (farm-profile snapshots, calendar chat, marketplace orders/listings, soil-report
uploads) is **entirely optional**. With no bucket/Firestore configured, the backend falls back to
in-memory stores and the frontend falls back to `localStorage` — the app is fully functional
either way. Only do the storage steps below if you want data to survive a redeploy, be visible
across multiple Cloud Run instances, or be shared across devices for the same session id. See
`catalog.md`'s "Storage & Persistence Architecture" section for which backend holds what and why.

---

## 0. Prerequisites

- [gcloud CLI](https://cloud.google.com/sdk/docs/install) installed and authenticated:
  ```bash
  gcloud auth login
  ```
- A GCP project with billing enabled. Set it as the active project and keep its id handy:
  ```bash
  export PROJECT_ID="your-gcp-project-id"
  gcloud config set project "$PROJECT_ID"
  ```
- Pick a region close to your users (Coimbatore, India → `asia-south1` is a reasonable default):
  ```bash
  export REGION="asia-south1"
  ```

---

## 1. Enable the APIs you'll use

```bash
gcloud services enable \
  run.googleapis.com \
  storage.googleapis.com \
  firestore.googleapis.com \
  cloudbuild.googleapis.com
```

---

## 2. (Optional) Create the storage bucket

Skip this section entirely if you're fine with the in-memory/localStorage fallback. This bucket
holds session snapshots/chat AND uploaded soil-report photos/PDFs (two prefixes, one bucket).

```bash
export BUCKET_NAME="${PROJECT_ID}-thulir-data"
gsutil mb -l "$REGION" "gs://${BUCKET_NAME}"
```

---

## 2a. (Optional, but see the note below) Create the Firestore database

Skip this section too if you're fine with the in-memory fallback for the marketplace integration
and soil-report metadata. Firestore Native mode has to be created ONCE per GCP project before
any call succeeds — this is why `FIRESTORE_ENABLED` is a separate, explicit flag rather than
something inferred from credentials alone:

```bash
gcloud firestore databases create --location="$REGION" --type=firestore-native
```

If a Firestore database already exists in this project (any app may have created one previously),
this command fails harmlessly — a project gets exactly one default Firestore database. Note also
that the multi-region location choices for Firestore (`nam5`, `eur3`, ...) don't always match a
Cloud Run region 1:1 — pick the Firestore location closest to `$REGION`, they don't have to be
byte-identical.

**Heads up on the first real query**: `GET /api/soil-reports/:sessionId/latest` filters by
`sessionId` and orders by `extractedAt` — Firestore may require a one-time composite index for
that combination. If so, the FIRST call fails with an error that includes a direct console link
to create it; open the link, click "Create Index," wait ~a minute, and it works from then on.
This is expected Firestore behaviour, not a bug — do this once after your first deploy with
`FIRESTORE_ENABLED=true`, ideally before a demo, not during one.

---

## 2b. (Strongly recommended) Get a Gemini key for the SERVER, not the client

If you want live AI answers (rather than the fully-functional offline fallback), get a key from
[Google AI Studio](https://aistudio.google.com/apikey) and set it as `GEMINI_API_KEY` — **not**
`VITE_GEMINI_API_KEY`. The `VITE_` version gets compiled into the public JS bundle anyone can
read in DevTools; `GEMINI_API_KEY` stays server-side, read only by `server/src/routes/aiRoutes.ts`.
This also requires building the frontend with `VITE_AI_TRANSPORT=server` so it calls your own
backend instead of Google directly — see the build args in step 3.

---

## 3. Build and deploy

From the **project root** (where the `Dockerfile` lives — `C:\Users\Lenovo\Downloads\agri hackathon\agri hackathon` locally):

```bash
gcloud run deploy thulir \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars GCS_BUCKET_NAME="${BUCKET_NAME}",FIRESTORE_ENABLED=true,GEMINI_API_KEY="${GEMINI_API_KEY}",SARVAM_API_KEY="${SARVAM_API_KEY}",GOOGLE_WEATHER_API_KEY="${GOOGLE_WEATHER_API_KEY}" \
  --build-env-vars VITE_AI_TRANSPORT=server
```

Notes:
- `--source .` hands your local directory to Cloud Build, which builds the `Dockerfile` and
  pushes the image for you — no separate `docker build`/`docker push` step needed.
- Omit `GCS_BUCKET_NAME=...` entirely if you skipped step 2, and `FIRESTORE_ENABLED=true` if you
  skipped step 2a; the server logs "in-memory fallback" for each on startup and keeps working.
  Omit `GEMINI_API_KEY=...` and `--build-env-vars` too if you're fine with the fully offline
  demo — every feature still works, just without live Gemini answers.
- `VITE_*` variables are baked in at BUILD time (Vite inlines them into the bundle), which is
  why it's a `--build-env-vars` flag here rather than `--set-env-vars` (that only affects the
  running container's environment, too late for a Vite variable).
- `--allow-unauthenticated` makes the demo publicly reachable, appropriate for a hackathon judge
  link. Remove it if you want to gate access behind IAM instead.
- The command prints a `Service URL` when it finishes — that's your live app.

---

## 4. Grant the service account access to what you enabled

Cloud Run uses the project's **default compute service account** unless you configured a
different one (`--service-account` flag — substitute its email for `$RUNTIME_SA` below instead).

```bash
export PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
export RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
```

**If you created a bucket (step 2)**, grant write access to it:

```bash
gsutil iam ch "serviceAccount:${RUNTIME_SA}:roles/storage.objectAdmin" "gs://${BUCKET_NAME}"
```

**If `AGRIDB_BUCKET_NAME` points at a bucket other than `$BUCKET_NAME`** (the FarmConnect
marketplace archive — see `.env.example`), grant the same role there too:

```bash
gsutil iam ch "serviceAccount:${RUNTIME_SA}:roles/storage.objectAdmin" "gs://${AGRIDB_BUCKET_NAME}"
```

**If you created a Firestore database (step 2a)**, grant read/write access at the project level
(Firestore doesn't have a per-database IAM binding the way a bucket does):

```bash
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/datastore.user"
```

Skip whichever step corresponds to a backend you didn't enable.

---

## 5. Verify

```bash
export SERVICE_URL=$(gcloud run services describe thulir --region "$REGION" --format='value(status.url)')
curl "${SERVICE_URL}/healthz"
# -> {"status":"ok"}
```

Open `$SERVICE_URL` in a browser — you should see the Thulir app. If you configured a
bucket, filling in a farm profile and refreshing the page should restore it (check the "Welcome
back" banner on the Farm Profile screen); if you check the bucket in the Cloud Console, you
should see objects appear under `sessions/<some-uuid>/profile.json`. If you also configured
Firestore, uploading a lab-report photo/PDF in Audio Mode should produce a document in the
`soil_reports` collection (Cloud Console → Firestore → Data) and a file under `soil-reports/` in
the bucket — see `.claude/skills/krishi-mitra-storage/SKILL.md` for a CLI way to check this
without opening the console.

---

## 6. Rollback / cleanup

```bash
# Remove the Cloud Run service
gcloud run services delete thulir --region "$REGION"

# Remove the bucket and everything in it (only if you created one)
gsutil rm -r "gs://${BUCKET_NAME}"
```

Firestore has no per-database delete via `gsutil`-style one-liner and a project gets exactly one
default database — if you need to wipe it, delete individual collections from the Cloud Console
(Firestore → Data) or via `gcloud firestore databases delete` (irreversible, asks for
confirmation). Most demo cleanups don't need this — the collections used here
(`marketplace_orders`, `marketplace_listings`, `soil_reports`) hold no cost-relevant data at
hackathon scale.

---

## Redeploying after a code change

Re-run the step 3 command — `gcloud run deploy --source .` rebuilds the image from your current
working directory and deploys the new revision. Cloud Run keeps the previous revision available
for instant rollback via `gcloud run services update-traffic` if the new one misbehaves.
