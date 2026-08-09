#!/usr/bin/env python3
"""
krishi_mitra_storage_admin.py — read-side admin/audit tool for Krishi Mitra's cloud persistence:
Firestore (marketplace orders/listings, soil-report extraction metadata) and Cloud Storage
(session snapshots/chat, uploaded soil-report photos/PDFs).

This is a companion to the Node server, not a replacement for it. The running app deliberately
never lists a whole Firestore collection unbounded, nor lists a bucket prefix at all, on any
farmer-facing request path (see server/src/storage/documentStore.ts and fileStore.ts) — those are
jobs a human runs occasionally (export, backup, debugging a deploy), not something the live app
depends on. This script is for that human.

DATA MODEL (must match these files exactly — they are the source of truth, this script mirrors
them, it does not own them):
    server/src/storage/marketplaceTypes.ts   — marketplace_orders / marketplace_listings collections
    server/src/storage/soilReportTypes.ts    — soil_reports collection + soil-reports/ bucket prefix
    server/src/storage/types.ts              — sessions/ bucket prefix (JSON blobs)

AUTH: uses Application Default Credentials via `google.cloud.firestore.Client()` /
`google.cloud.storage.Client()` — the same posture as the Node server (see deploy/DEPLOY.md).
Run `gcloud auth application-default login` once locally; on Cloud Run/Compute this resolves
automatically via the attached service account. This script never reads, generates, or expects a
service-account key JSON file.

USAGE
    pip install -r requirements.txt

    # Firestore reads
    python admin.py orders [--crop tomato] [--limit 20]
    python admin.py listings [--since 2026-08-01] [--limit 20]
    python admin.py demand --crop tomato [--window-days 30]
    python admin.py soil-reports [--session-id abc-123] [--limit 20]
    python admin.py export-collection --collection marketplace_orders --out orders.csv

    # Cloud Storage reads (needs --bucket, or $GCS_BUCKET_NAME)
    python admin.py list-bucket --bucket my-bucket --prefix soil-reports/
    python admin.py download-file --bucket my-bucket --path soil-reports/s1/r1.pdf --out ./r1.pdf

    --bucket can be omitted if GCS_BUCKET_NAME is set in the environment (matches the server's
    own env var). Firestore commands use the default project from `gcloud config` / ADC — pass
    --project to override.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from datetime import datetime, timezone
from statistics import median
from typing import Any

try:
    from google.cloud import firestore, storage
except ImportError:
    print("Missing dependency: run `pip install -r requirements.txt` first.", file=sys.stderr)
    sys.exit(1)


ORDERS_COLLECTION = "marketplace_orders"
LISTINGS_COLLECTION = "marketplace_listings"
SOIL_REPORTS_COLLECTION = "soil_reports"

# Mirrors server/src/services/marketDemand.ts's TIER_THRESHOLDS exactly — keep these two lists in
# sync by hand if either changes; there is no shared source between TypeScript and Python here.
TIER_THRESHOLDS = [("high", 8), ("medium", 3), ("low", 1)]


def resolve_tier(request_count: int) -> str:
    for tier, min_requests in TIER_THRESHOLDS:
        if request_count >= min_requests:
            return tier
    return "no-data"


def most_common_unit(orders: list[dict[str, Any]]) -> str | None:
    counts: dict[str, int] = {}
    for o in orders:
        unit = o.get("unit")
        if not unit:
            continue
        counts[unit] = counts.get(unit, 0) + 1
    return max(counts.items(), key=lambda kv: kv[1])[0] if counts else None


def analyze_market_demand(crop_name: str, orders: list[dict[str, Any]], window_days: int = 30) -> dict[str, Any]:
    """Mirrors server/src/services/marketDemand.ts's analyzeMarketDemand() exactly."""
    now = datetime.now(timezone.utc).timestamp() * 1000
    cutoff = now - window_days * 24 * 60 * 60 * 1000
    recent = [o for o in orders if isinstance(o.get("requestedAt"), (int, float)) and o["requestedAt"] >= cutoff]

    total_qty = sum(o.get("quantity", 0) for o in recent if isinstance(o.get("quantity"), (int, float)))
    prices = [o["price"] for o in recent if isinstance(o.get("price"), (int, float)) and o["price"] > 0]

    return {
        "cropName": crop_name,
        "windowDays": window_days,
        "requestCount": len(recent),
        "totalQuantityRequested": total_qty,
        "unit": most_common_unit(recent),
        "suggestedPricePerUnit": median(prices) if prices else None,
        "demandTier": resolve_tier(len(recent)),
    }


def matches_crop(product_name: str, needle: str) -> bool:
    hay = product_name.strip().lower()
    needle = needle.strip().lower()
    return needle in hay or hay in needle


def parse_since(value: str) -> float:
    try:
        return float(value)
    except ValueError:
        pass
    return datetime.fromisoformat(value).replace(tzinfo=timezone.utc).timestamp() * 1000


def resolve_bucket_name(cli_value: str | None) -> str:
    bucket = cli_value or os.environ.get("GCS_BUCKET_NAME", "").strip()
    if not bucket:
        print("No bucket given. Pass --bucket, or set GCS_BUCKET_NAME (matches the server's own env var).", file=sys.stderr)
        sys.exit(1)
    return bucket


# ---------------------------------------------------------------------------
# Firestore commands
# ---------------------------------------------------------------------------

def cmd_orders(db: "firestore.Client", args: argparse.Namespace) -> None:
    docs = [d.to_dict() for d in db.collection(ORDERS_COLLECTION).order_by("syncedAt", direction=firestore.Query.DESCENDING).limit(args.limit or 1000).stream()]
    if args.crop:
        docs = [o for o in docs if matches_crop(o.get("productName", ""), args.crop)]
    print(json.dumps(docs, indent=2, default=str))
    print(f"\n{len(docs)} order(s) shown.", file=sys.stderr)


def cmd_listings(db: "firestore.Client", args: argparse.Namespace) -> None:
    query = db.collection(LISTINGS_COLLECTION)
    if args.since:
        query = query.where("createdAt", ">", parse_since(args.since))
    docs = [d.to_dict() for d in query.order_by("createdAt", direction=firestore.Query.DESCENDING).limit(args.limit or 1000).stream()]
    print(json.dumps(docs, indent=2, default=str))
    print(f"\n{len(docs)} listing(s) shown.", file=sys.stderr)


def cmd_demand(db: "firestore.Client", args: argparse.Namespace) -> None:
    docs = [d.to_dict() for d in db.collection(ORDERS_COLLECTION).limit(5000).stream()]
    matching = [o for o in docs if matches_crop(o.get("productName", ""), args.crop)]
    print(json.dumps(analyze_market_demand(args.crop, matching, args.window_days), indent=2))


def cmd_soil_reports(db: "firestore.Client", args: argparse.Namespace) -> None:
    query = db.collection(SOIL_REPORTS_COLLECTION)
    if args.session_id:
        query = query.where("sessionId", "==", args.session_id)
    docs = [d.to_dict() for d in query.order_by("extractedAt", direction=firestore.Query.DESCENDING).limit(args.limit or 100).stream()]
    print(json.dumps(docs, indent=2, default=str))
    print(f"\n{len(docs)} soil report(s) shown.", file=sys.stderr)
    if docs:
        print("Original files are in the bucket at the `filePath` shown above — fetch with `download-file`.", file=sys.stderr)


def cmd_export_collection(db: "firestore.Client", args: argparse.Namespace) -> None:
    docs = [d.to_dict() for d in db.collection(args.collection).stream()]
    if not docs:
        print(f"Collection '{args.collection}' is empty — nothing to export.", file=sys.stderr)
        return
    fieldnames = sorted({key for doc in docs for key in doc.keys()})
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(docs)
    print(f"Exported {len(docs)} document(s) from '{args.collection}' to {args.out}", file=sys.stderr)


# ---------------------------------------------------------------------------
# Cloud Storage commands
# ---------------------------------------------------------------------------

def cmd_list_bucket(bucket: "storage.Bucket", args: argparse.Namespace) -> None:
    count = 0
    for blob in bucket.list_blobs(prefix=args.prefix or ""):
        print(f"{blob.name}\t{blob.size} bytes\t{blob.updated}")
        count += 1
    print(f"\n{count} object(s) under prefix '{args.prefix or '(root)'}'.", file=sys.stderr)


def cmd_download_file(bucket: "storage.Bucket", args: argparse.Namespace) -> None:
    blob = bucket.blob(args.path)
    if not blob.exists():
        print(f"No object at '{args.path}'.", file=sys.stderr)
        sys.exit(1)
    blob.download_to_filename(args.out)
    print(f"Downloaded '{args.path}' to {args.out}", file=sys.stderr)


# ---------------------------------------------------------------------------
# CLI wiring
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--project", help="GCP project id (default: gcloud/ADC default project)")
    parser.add_argument("--bucket", help="GCS bucket name, for bucket subcommands (default: $GCS_BUCKET_NAME)")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("orders", help="List marketplace orders (Firestore)")
    p.add_argument("--crop", help="Filter by crop name (fuzzy, case-insensitive)")
    p.add_argument("--limit", type=int, default=50)
    p.set_defaults(func=cmd_orders, kind="firestore")

    p = sub.add_parser("listings", help="List marketplace listings (Firestore)")
    p.add_argument("--since", help="ISO date or epoch-ms — only listings created after this")
    p.add_argument("--limit", type=int, default=50)
    p.set_defaults(func=cmd_listings, kind="firestore")

    p = sub.add_parser("demand", help="Recompute demand for one crop (mirrors /api/marketplace/demand)")
    p.add_argument("--crop", required=True)
    p.add_argument("--window-days", type=int, default=30)
    p.set_defaults(func=cmd_demand, kind="firestore")

    p = sub.add_parser("soil-reports", help="List soil-report extractions (Firestore)")
    p.add_argument("--session-id", help="Filter to one farmer's session")
    p.add_argument("--limit", type=int, default=50)
    p.set_defaults(func=cmd_soil_reports, kind="firestore")

    p = sub.add_parser("export-collection", help="Export any Firestore collection to CSV")
    p.add_argument("--collection", required=True, choices=[ORDERS_COLLECTION, LISTINGS_COLLECTION, SOIL_REPORTS_COLLECTION])
    p.add_argument("--out", required=True)
    p.set_defaults(func=cmd_export_collection, kind="firestore")

    p = sub.add_parser("list-bucket", help="List objects in the GCS bucket under a prefix")
    p.add_argument("--prefix", default="", help='e.g. "soil-reports/" or "sessions/"')
    p.set_defaults(func=cmd_list_bucket, kind="bucket")

    p = sub.add_parser("download-file", help="Download one object from the bucket")
    p.add_argument("--path", required=True, help="Full object path, e.g. soil-reports/s1/r1.pdf")
    p.add_argument("--out", required=True)
    p.set_defaults(func=cmd_download_file, kind="bucket")

    args = parser.parse_args()

    if args.kind == "firestore":
        db = firestore.Client(project=args.project) if args.project else firestore.Client()
        args.func(db, args)
    else:
        bucket_name = resolve_bucket_name(args.bucket)
        client = storage.Client(project=args.project) if args.project else storage.Client()
        args.func(client.bucket(bucket_name), args)


if __name__ == "__main__":
    main()
